#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { loadConfig } from "./config.js";
import { Permissions } from "./permissions.js";
import { OllamaProvider } from "./provider.js";
import { Agent } from "./agent.js";
import { loadState, saveState } from "./state.js";
import { openTunnel, closeTunnel } from "./ssh.js";
import {
  ask,
  banner,
  c,
  closeRl,
  confirm,
  EOF,
  printError,
  printInfo,
  selectFromMenu,
  startSpinner,
  stopSpinner,
} from "./ui.js";
import type { AgentConfig, Provider } from "./types.js";

const HELP = `
${c.bold("commands")}
  /help           show this help
  /model [name]   switch the model — interactive picker, or pass a name
  /models         list the models installed in Ollama
  /reset          clear the conversation history
  /paths          show the sandboxed root directories
  /exit           quit (Ctrl-C also works)

Anything else is sent to the model as a request.
`;

/** Run a fallible setup step; on failure, print and exit cleanly. */
function orExit<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    printError((e as Error).message);
    return process.exit(1);
  }
}

function cleanup(): void {
  closeTunnel();
  closeRl();
}

/** Ask the user to trust the launch directory the first time it is used. */
async function ensureTrusted(dir: string): Promise<void> {
  const state = loadState();
  if (state.trustedDirs.includes(dir)) return;

  console.log();
  console.log(c.yellow("  ⚠  New directory"));
  console.log("  Pretzel Porter can read, edit, and run shell commands in:");
  console.log(`     ${c.bold(dir)}`);
  console.log(c.dim("  Only trust a directory whose contents you recognise."));
  console.log();
  if (!(await confirm("  Trust this directory?"))) {
    printError("Directory not trusted — exiting.");
    cleanup();
    process.exit(0);
  }
  state.trustedDirs.push(dir);
  saveState(state);
  printInfo("  trusted — it won't ask again for this directory.\n");
}

/** Models that can chat (drop embedding-only models from the picker). */
async function usableModels(provider: Provider): Promise<string[]> {
  const all = await provider.listModels();
  const chat = all.filter((m) => !/embed/i.test(m));
  return chat.length ? chat : all;
}

/** Pick the startup model; prompts only when more than one is installed. */
async function chooseModel(provider: Provider, cfg: AgentConfig): Promise<string> {
  let models: string[];
  try {
    models = await usableModels(provider);
  } catch {
    return cfg.model; // listing failed — keep the configured model
  }
  if (models.length === 0) return cfg.model;

  const state = loadState();
  const preferred = [state.lastModel, cfg.model].find((m) => m && models.includes(m));
  const defaultIdx = preferred ? models.indexOf(preferred) : 0;

  if (models.length === 1) return models[0]!;
  const idx = await selectFromMenu("Select a model:", models, defaultIdx);
  return models[idx]!;
}

/** Handle `/model` and `/model <name>` — switches the model mid-session. */
async function switchModel(provider: Provider, cfg: AgentConfig, arg: string): Promise<void> {
  let models: string[];
  try {
    models = await usableModels(provider);
  } catch (e) {
    printError((e as Error).message);
    return;
  }
  if (models.length === 0) {
    printError("no models installed in Ollama.");
    return;
  }

  let chosen: string;
  if (arg) {
    const lc = arg.toLowerCase();
    // exact → case-insensitive exact → prefix → substring
    const match =
      models.find((m) => m === arg) ??
      models.find((m) => m.toLowerCase() === lc) ??
      models.find((m) => m.toLowerCase().startsWith(lc)) ??
      models.find((m) => m.toLowerCase().includes(lc));
    if (!match) {
      printError(`no installed model matches "${arg}" — try /models to list them.`);
      return;
    }
    chosen = match;
  } else {
    const defaultIdx = Math.max(0, models.indexOf(cfg.model));
    chosen = models[await selectFromMenu("Switch model:", models, defaultIdx)]!;
  }

  if (chosen === cfg.model) {
    printInfo(`already using ${chosen}.\n`);
    return;
  }
  cfg.model = chosen; // provider + agent share this object, so the swap is live
  const state = loadState();
  state.lastModel = chosen;
  saveState(state);
  printInfo(`model switched to ${c.bold(chosen)} — applies from your next message.\n`);
}

async function main(): Promise<void> {
  const cfg = orExit(loadConfig);
  const cwd = realpathSync(process.cwd());

  await ensureTrusted(cwd);

  // Optional: route Ollama through an SSH tunnel to a self-hosted box.
  if (cfg.ssh.enabled) {
    startSpinner(`opening SSH tunnel to ${cfg.ssh.host}`);
    try {
      cfg.baseUrl = await openTunnel(cfg.ssh);
    } catch (e) {
      stopSpinner();
      printError((e as Error).message);
      cleanup();
      process.exit(1);
    }
    stopSpinner();
    printInfo(`  ssh tunnel up — Ollama via ${cfg.baseUrl}\n`);
  }

  const provider = new OllamaProvider(cfg);

  startSpinner("connecting to Ollama");
  try {
    await provider.healthCheck();
  } catch (e) {
    stopSpinner();
    printError((e as Error).message);
    cleanup();
    process.exit(1);
  }
  stopSpinner();

  cfg.model = await chooseModel(provider, cfg);
  const state = loadState();
  state.lastModel = cfg.model;
  saveState(state);

  const permissions = orExit(() => new Permissions([cwd, ...cfg.allowedPaths], cwd));
  const agent = new Agent(cfg, provider, permissions);
  banner(cfg.model, permissions.roots(), cfg.rag.enabled);

  process.on("SIGINT", () => {
    console.log(c.dim("\nbye."));
    cleanup();
    process.exit(0);
  });

  for (;;) {
    const raw = await ask(c.cyan("you ▸ "));
    if (raw === EOF) break;
    const input = raw.trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const parts = input.slice(1).split(/\s+/);
      const cmd = (parts[0] ?? "").toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "exit" || cmd === "quit") break;
      else if (cmd === "help") printInfo(HELP);
      else if (cmd === "reset") {
        agent.reset();
        printInfo("conversation cleared.\n");
      } else if (cmd === "paths") {
        printInfo("sandboxed roots:\n  " + permissions.roots().join("\n  ") + "\n");
      } else if (cmd === "models") {
        try {
          printInfo("installed models:\n  " + (await provider.listModels()).join("\n  ") + "\n");
        } catch (e) {
          printError((e as Error).message);
        }
      } else if (cmd === "model") {
        await switchModel(provider, cfg, arg);
      } else {
        printError(`unknown command "${input}". Try /help.`);
      }
      continue;
    }

    await agent.run(input);
  }

  console.log(c.dim("bye."));
  cleanup();
}

main().catch((e) => {
  stopSpinner();
  printError(`fatal: ${(e as Error).stack ?? e}`);
  cleanup();
  process.exit(1);
});
