#!/usr/bin/env node
import { realpathSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";
import { loadConfig } from "./config.js";
import { Permissions } from "./permissions.js";
import { OllamaProvider } from "./provider.js";
import { Agent } from "./agent.js";
import { autonomy } from "./autonomy.js";
import { loadState, saveState } from "./state.js";
import { openTunnel, closeTunnel } from "./ssh.js";
import { buildRepoMap } from "./repomap.js";
import { initProjectMemory } from "./projectMemory.js";
import { allNotes, forget } from "./memory.js";
import { renderTodos } from "./todos.js";
import { loadCustomCommands, expandCommand } from "./commands.js";
import { connectMcpServers, type McpClient } from "./mcp.js";
import {
  ask,
  banner,
  c,
  closeRl,
  confirm,
  EOF,
  onShiftTab,
  printError,
  printInfo,
  selectFromMenu,
  setCompleter,
  startSpinner,
  stopSpinner,
} from "./ui.js";
import type { AgentConfig, Provider } from "./types.js";

const HELP = `
${c.bold("commands")}
  /help           show this help
  /model [name]   switch the model — interactive picker, or pass a name
  /models         list the models installed in Ollama
  /compact        summarise older turns to reclaim context space
  /context        show context-window usage
  /undo           revert the last file change
  /redo           re-apply the last reverted change
  /map            print a structural map of the project
  /files          list pinned context files ( /files clear  to empty )
  /add <path>     pin a file or directory into every prompt
  /add-dir <path> pin a directory into every prompt
  /drop <path>    unpin a file or directory
  /memory         list long-term memory ( /memory forget <id> )
  /todos          show the agent's current task list
  /init           create a starter PRETZEL.md project-memory file
  /reload         reload PRETZEL.md into context
  /reset          clear the conversation history
  /paths          show the sandboxed root directories
  /exit           quit (Ctrl-C also works)

${c.bold("keys")}
  Shift-Tab       toggle autonomous mode (auto-approve every action)
  Ctrl-C          cancel the current response — or quit at an empty prompt
  Tab             complete a command or file path
  trailing \\      continue input on the next line

Mention a file inline with ${c.bold("@path")} to attach it for one turn.
Anything else is sent to the model as a request.
`;

const COMMANDS = [
  "/help",
  "/model",
  "/models",
  "/compact",
  "/context",
  "/undo",
  "/redo",
  "/map",
  "/files",
  "/add",
  "/add-dir",
  "/drop",
  "/memory",
  "/todos",
  "/init",
  "/reload",
  "/reset",
  "/paths",
  "/exit",
];

/** Run a fallible setup step; on failure, print and exit cleanly. */
function orExit<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    printError((e as Error).message);
    return process.exit(1);
  }
}

/** MCP server connections — closed on exit. */
let mcpClients: McpClient[] = [];

function cleanup(): void {
  for (const client of mcpClients) client.close();
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

/** Shorten an absolute path with a leading ~ for display. */
function tildeify(p: string): string {
  const home = homedir();
  return p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

/** Tab-completion candidates for a path fragment, relative to `base`. */
function completePath(token: string, base: string): string[] {
  const at = token.startsWith("@");
  const frag = at ? token.slice(1) : token;
  const slash = frag.lastIndexOf("/");
  const dirPart = slash >= 0 ? frag.slice(0, slash + 1) : "";
  const namePart = slash >= 0 ? frag.slice(slash + 1) : frag;

  let dir = dirPart || ".";
  if (dir.startsWith("~")) dir = homedir() + dir.slice(1);
  const abs = isAbsolute(dir) ? dir : resolve(base, dir);

  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const showHidden = namePart.startsWith(".");
  return entries
    .filter((e) => e.startsWith(namePart) && (showHidden || !e.startsWith(".")))
    .slice(0, 50)
    .map((e) => {
      const full = (at ? "@" : "") + dirPart + e;
      try {
        return statSync(resolve(abs, e)).isDirectory() ? full + "/" : full;
      } catch {
        return full;
      }
    });
}

/** Read one user message, supporting multi-line input via a trailing backslash. */
async function readUserInput(): Promise<string> {
  let acc = "";
  let prompt = c.cyan("you ▸ ");
  for (;;) {
    const line = await ask(prompt);
    if (line === EOF) return EOF;
    if (line.endsWith("\\")) {
      acc += line.slice(0, -1) + "\n";
      prompt = c.cyan("   ┄ ");
      continue;
    }
    return acc + line;
  }
}

async function main(): Promise<void> {
  const cfg = orExit(loadConfig);
  const cwd = realpathSync(process.cwd());

  await ensureTrusted(cwd);

  // Choose the backend: local Ollama, or the SSH-tunnelled remote one.
  // The picker only appears when an SSH target is configured (ssh.enabled).
  let backendLabel = "local";
  if (cfg.ssh.enabled) {
    const sshTarget = cfg.ssh.mode === "gcloud" ? cfg.ssh.gcloud.instance : cfg.ssh.host;
    const choice = await selectFromMenu(
      "Which Ollama backend?",
      ["Local  (this machine)", `Cloud  (${sshTarget} via SSH)`],
      0,
    );
    if (choice === 1) {
      startSpinner(`opening SSH tunnel to ${sshTarget}`);
      try {
        cfg.baseUrl = await openTunnel(cfg.ssh);
      } catch (e) {
        stopSpinner();
        printError((e as Error).message);
        cleanup();
        process.exit(1);
      }
      stopSpinner();
      backendLabel = "cloud";
      printInfo(`  ssh tunnel up — Ollama via ${cfg.baseUrl}\n`);
    }
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

  const permissions = orExit(
    () => new Permissions([cwd, ...cfg.allowedPaths], cwd, cfg.readOnlyPaths),
  );

  // Connect any configured MCP servers; their tools join the registry.
  let mcpTools: import("./types.js").Tool[] = [];
  const mcpNames = Object.keys(cfg.mcpServers);
  if (mcpNames.length > 0) {
    startSpinner(`connecting to ${mcpNames.length} MCP server(s)`);
    const result = await connectMcpServers(cfg.mcpServers);
    stopSpinner();
    mcpClients = result.clients;
    mcpTools = result.tools;
    for (const err of result.errors) printError(`MCP ${err}`);
    if (mcpTools.length > 0) {
      printInfo(`  ${mcpTools.length} MCP tool(s) from ${mcpClients.length} server(s)\n`);
    }
  }

  const agent = new Agent(cfg, provider, permissions, mcpTools);
  const customCommands = loadCustomCommands();
  banner(cfg.model, permissions.roots(), cfg.rag.enabled);

  // Warn if the chosen model can't use tools — it will be chat-only.
  const caps = await provider.capabilities(cfg.model);
  if (caps && !caps.has("tools")) {
    printInfo(
      c.yellow(`  note: ${cfg.model} has no tool-calling capability — `) +
        c.yellow("file tools and RAG are disabled; chat only.\n"),
    );
  }

  // Tab completion: slash-commands (built-in + custom) first, then file paths.
  const allCommands = [...COMMANDS, ...[...customCommands.keys()].map((n) => "/" + n)];
  setCompleter((line) => {
    if (line.startsWith("/") && !line.includes(" ")) {
      return [allCommands.filter((cmd) => cmd.startsWith(line)), line];
    }
    const token = line.split(/\s+/).pop() ?? "";
    if (!token) return [[], line];
    return [completePath(token, cwd), token];
  });

  // Shift-Tab flips autonomous mode — bypasses every confirmation.
  onShiftTab(() => {
    const on = autonomy.toggle();
    process.stdout.write(
      "\n" +
        (on
          ? c.yellow("⚡ autonomous mode ON — every write/shell action is auto-approved")
          : c.green("✓ autonomous mode OFF — confirmations restored")) +
        "\n",
    );
  });

  // Ctrl-C cancels an in-flight response; at an idle prompt it quits.
  process.on("SIGINT", () => {
    if (agent.running) {
      agent.cancel();
      return;
    }
    console.log(c.dim("\nbye."));
    cleanup();
    process.exit(0);
  });

  /** The dim status line shown above each prompt. */
  const statusLine = (): string => {
    const { pct } = agent.contextUsage();
    const pctRound = Math.min(999, Math.round(pct * 100));
    const ctxColor = pctRound >= 95 ? c.red : pctRound >= 80 ? c.yellow : c.dim;
    const model = cfg.model.length > 30 ? cfg.model.slice(0, 29) + "…" : cfg.model;
    const sep = c.dim(" · ");
    let line =
      c.dim(model) +
      sep +
      c.dim(backendLabel) +
      sep +
      ctxColor(`ctx ${pctRound}%`) +
      sep +
      c.dim(tildeify(cwd));
    if (autonomy.enabled) line += sep + c.yellow("⚡ autonomous");
    return line;
  };

  for (;;) {
    console.log(statusLine());
    const raw = await readUserInput();
    if (raw === EOF) break;
    const input = raw.trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const parts = input.slice(1).split(/\s+/);
      const cmd = (parts[0] ?? "").toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "exit" || cmd === "quit") break;
      else if (cmd === "help") {
        printInfo(HELP);
        if (customCommands.size) {
          printInfo(
            "custom commands (~/.pretzel-porter/commands/):\n" +
              [...customCommands.values()]
                .map((cc) => `  /${cc.name}  ${c.dim(cc.description)}`)
                .join("\n") +
              "\n",
          );
        }
      } else if (cmd === "reset") {
        agent.reset();
        printInfo("conversation cleared.\n");
      } else if (cmd === "paths") {
        const ro = permissions.readOnlyRoots();
        let txt = "sandboxed roots (read / write):\n  " + permissions.roots().join("\n  ");
        if (ro.length) txt += "\nread-only reference roots:\n  " + ro.join("\n  ");
        printInfo(txt + "\n");
      } else if (cmd === "models") {
        try {
          printInfo("installed models:\n  " + (await provider.listModels()).join("\n  ") + "\n");
        } catch (e) {
          printError((e as Error).message);
        }
      } else if (cmd === "model") {
        await switchModel(provider, cfg, arg);
      } else if (cmd === "compact") {
        printInfo((await agent.compact("manual")) + "\n");
      } else if (cmd === "context") {
        const { tokens, pct } = agent.contextUsage();
        const barLen = 24;
        const filled = Math.max(0, Math.min(barLen, Math.round(pct * barLen)));
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
        printInfo(
          `context: ${tokens} / ${cfg.numCtx} tokens (${Math.round(pct * 100)}%)\n` +
            `  ${bar}\n`,
        );
      } else if (cmd === "undo") {
        printInfo(agent.performUndo() + "\n");
      } else if (cmd === "redo") {
        printInfo(agent.performRedo() + "\n");
      } else if (cmd === "map") {
        printInfo(buildRepoMap(cwd) + "\n");
      } else if (cmd === "files") {
        if (arg.toLowerCase() === "clear") {
          agent.fileContext.clear();
          printInfo("context files cleared.\n");
        } else {
          const pinned = agent.fileContext.list();
          printInfo(
            pinned.length
              ? "pinned context:\n  " + pinned.join("\n  ") + "\n"
              : "no files pinned — use /add <path> or mention @path inline.\n",
          );
        }
      } else if (cmd === "add" || cmd === "add-dir") {
        if (!arg) printError(`usage: /${cmd} <path>`);
        else printInfo(agent.fileContext.add(arg) + "\n");
      } else if (cmd === "drop") {
        if (!arg) printError("usage: /drop <path>");
        else printInfo(agent.fileContext.drop(arg) + "\n");
      } else if (cmd === "memory") {
        const sub = arg.split(/\s+/);
        if (sub[0]?.toLowerCase() === "forget" && sub[1]) {
          printInfo((forget(sub[1]) ? `forgot note ${sub[1]}` : `no note with id ${sub[1]}`) + "\n");
        } else {
          const notes = allNotes();
          printInfo(
            notes.length
              ? `long-term memory — ${notes.length} note(s):\n` +
                  notes
                    .map((n) => `  ${c.dim(n.id)}  [${n.ts.slice(0, 10)}] ${n.text}`)
                    .join("\n") +
                  "\n"
              : "long-term memory is empty.\n",
          );
        }
      } else if (cmd === "init") {
        printInfo(initProjectMemory(cwd) + "\n");
      } else if (cmd === "reload") {
        agent.reloadContext();
        printInfo("project memory reloaded into context.\n");
      } else if (cmd === "todos") {
        printInfo(renderTodos() + "\n");
      } else if (customCommands.has(cmd)) {
        await agent.run(expandCommand(customCommands.get(cmd)!, arg));
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
