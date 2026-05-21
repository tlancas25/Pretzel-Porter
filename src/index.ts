#!/usr/bin/env node
import { realpathSync, readdirSync, statSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
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
  meterBar,
  onEscape,
  onShiftTab,
  printError,
  printInfo,
  printTiming,
  rule,
  selectFromMenu,
  setCompleter,
  setQuiet,
  setTheme,
  startSpinner,
  stopSpinner,
} from "./ui.js";
import { planMode } from "./planmode.js";
import { gitDiff, isGitRepo } from "./git.js";
import { listJobs, getJob, killAllJobs } from "./jobs.js";
import { airgap } from "./airgap.js";
import { setAudit, AUDIT_FILE } from "./audit.js";
import { newSessionId, saveSession, loadSession, listSessions } from "./session.js";
import { readPortMem } from "./portmem.js";
import { GUTTER, clearScreen } from "./canvas.js";
import { VERSION } from "./version.js";
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
  /plan           toggle plan mode — read-only investigation, no changes
  /diff           show the git working-tree diff
  /commit [msg]   commit changes (model writes the message if omitted)
  /jobs           list background jobs ( /jobs <id> for output )
  /resume [id]    resume a saved session ( interactive picker if no id )
  /sessions       list saved sessions
  /rules          list permission rules ( /rules clear  resets learned )
  /airgap         toggle air-gap mode — disable all network tools
  /doctor         run diagnostics (Ollama, model, RAG, git)
  /status         show the current session status
  /init           create a starter PRETZEL.md project-memory file
  /reload         reload PRETZEL.md into context
  /portmem        show this directory's working memory (portmem.md)
  /reset          clear the conversation history
  /paths          show the sandboxed root directories
  /exit           quit (Ctrl-C also works)

${c.bold("keys")}
  Shift-Tab       toggle autonomous mode (auto-approve every action)
  Esc             stop the current response (e.g. mid-thinking)
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
  "/plan",
  "/diff",
  "/commit",
  "/jobs",
  "/resume",
  "/sessions",
  "/rules",
  "/airgap",
  "/doctor",
  "/status",
  "/init",
  "/reload",
  "/portmem",
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
  killAllJobs();
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
async function readUserInput(status?: string): Promise<string> {
  // Each turn opens with a dim rule and the status line, then the prompt.
  if (process.stdout.isTTY) {
    console.log();
    console.log(GUTTER + rule());
    if (status) console.log(GUTTER + status);
  }
  let acc = "";
  let prompt = GUTTER + c.cyan("❯ ");
  for (;;) {
    const line = await ask(prompt);
    if (line === EOF) return EOF;
    if (line.endsWith("\\")) {
      acc += line.slice(0, -1) + "\n";
      prompt = GUTTER + c.dim("❯ ");
      continue;
    }
    return acc + line;
  }
}

/** Whether an executable is on the PATH (for /doctor). */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [cmd], (err) => resolve(!err));
  });
}

/**
 * Headless mode (`pport -p "task"`): run one task non-interactively, stream the
 * answer to stdout, and exit. For scripting and automation. Tool actions are
 * auto-approved (it runs unattended) and the thinking trace is suppressed.
 */
async function runHeadless(promptArg: string): Promise<void> {
  let prompt = promptArg;
  if (!prompt && !process.stdin.isTTY) {
    try {
      prompt = readFileSync(0, "utf8").trim();
    } catch {
      // no stdin available
    }
  }
  if (!prompt) {
    console.error('pport -p: no task given — pass text after -p, or pipe it via stdin.');
    process.exit(2);
  }

  setQuiet(true);
  const cfg = orExit(loadConfig);
  setTheme(cfg.theme);
  airgap.set(cfg.airgap);
  setAudit(cfg.auditLog);
  cfg.hideThinking = true;
  cfg.autoApprove = { read: true, write: true, shell: true }; // unattended
  cfg.model = loadState().lastModel || cfg.model;
  const cwd = realpathSync(process.cwd());

  // Cloud is the daily driver — use it headless too when SSH is configured.
  if (cfg.ssh.enabled) {
    try {
      cfg.baseUrl = await openTunnel(cfg.ssh);
    } catch (e) {
      console.error(`pport -p: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const provider = new OllamaProvider(cfg);
  try {
    await provider.healthCheck();
  } catch (e) {
    console.error(`pport -p: ${(e as Error).message}`);
    closeTunnel();
    process.exit(1);
  }

  const permissions = orExit(
    () => new Permissions([cwd, ...cfg.allowedPaths], cwd, cfg.readOnlyPaths),
  );
  const agent = new Agent(cfg, provider, permissions, []);
  await agent.run(prompt);
  process.stdout.write("\n");
  closeTunnel();
  process.exit(agent.answer ? 0 : 1);
}

async function main(): Promise<void> {
  // CLI flags handled before anything else, so they work even if config is broken.
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`Pretzel Porter v${VERSION}`);
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      `Pretzel Porter v${VERSION} — a private local terminal agent\n\n` +
        "Usage:\n" +
        "  pport               run interactively in the current directory\n" +
        "  sudo pport          run as root (to reach root-owned files)\n" +
        '  pport -p "task"     run one task headless, print the result, exit\n' +
        "  echo task | pport -p   same, taking the task from stdin\n" +
        "  pport --version     print the version\n\n" +
        "Inside the session, type /help for commands.\n" +
        "To upgrade: from the cloned repo, ./install.sh --update",
    );
    process.exit(0);
  }

  // Headless mode: run one task non-interactively and exit (for scripting).
  const pIdx = args.findIndex((a) => a === "-p" || a === "--print");
  if (pIdx !== -1) {
    await runHeadless(args.slice(pIdx + 1).join(" ").trim());
    return; // runHeadless always calls process.exit
  }

  const cfg = orExit(loadConfig);
  setTheme(cfg.theme);
  airgap.set(cfg.airgap);
  setAudit(cfg.auditLog);
  const cwd = realpathSync(process.cwd());

  await ensureTrusted(cwd);

  // Choose the backend: local Ollama, or the SSH-tunnelled remote one.
  // The picker only appears when an SSH target is configured (ssh.enabled).
  let backendLabel = "local";
  if (cfg.ssh.enabled) {
    const sshTarget = cfg.ssh.mode === "gcloud" ? cfg.ssh.gcloud.instance : cfg.ssh.host;
    // Cloud is the daily driver; local is the backup. The picker still always
    // shows — the operator picks per session — but Cloud is pre-selected.
    const choice = await selectFromMenu(
      "Which Ollama backend?",
      ["Local  (this machine — backup)", `Cloud  (${sshTarget} via SSH)`],
      1,
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
  let sessionId = newSessionId();

  // A status line shown above each prompt — model, backend, context, modes.
  const statusLine = (): string => {
    const { pct } = agent.contextUsage();
    const pctRound = Math.min(999, Math.round(pct * 100));
    const ctxColor = pctRound >= 95 ? c.red : pctRound >= 80 ? c.yellow : c.green;
    const model = cfg.model.length > 28 ? cfg.model.slice(0, 27) + "…" : cfg.model;
    const sep = c.dim("  ·  ");
    const segments = [
      `${c.cyan("▸")} ${c.bold(model)}`,
      c.dim(backendLabel),
      `${ctxColor(meterBar(pct))} ${ctxColor(`${pctRound}%`)}`,
      c.dim(tildeify(cwd)),
    ];
    const modes: string[] = [];
    if (planMode.active) modes.push(c.blue("plan"));
    if (airgap.enabled) modes.push(c.green("air-gapped"));
    if (autonomy.enabled) modes.push(c.yellow("⚡ autonomous"));
    let line = segments.join(sep);
    if (modes.length > 0) line += sep + modes.join(" ");
    return line;
  };
  clearScreen(); // a clean slate so the banner starts at the top of the screen

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

  // Escape cancels an in-flight response (handy mid-"thinking"); a no-op when idle.
  onEscape(() => {
    if (agent.running) agent.cancel();
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

  // Run one model turn, timing it and persisting the session afterwards.
  const runTurn = async (text: string): Promise<void> => {
    const started = Date.now();
    await agent.run(text);
    printTiming((Date.now() - started) / 1000);
    saveSession(sessionId, agent.exportMessages());
  };

  for (;;) {
    const raw = await readUserInput(statusLine());
    if (raw === EOF) break;
    const input = raw.trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const parts = input.slice(1).split(/\s+/);
      const cmd = (parts[0] ?? "").toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "exit" || cmd === "quit") break;
      else if (cmd === "help") {
        printInfo(rule());
        printInfo(HELP.trim());
        if (customCommands.size) {
          printInfo(
            "\ncustom commands (~/.pretzel-porter/commands/):\n" +
              [...customCommands.values()]
                .map((cc) => `  /${cc.name}  ${c.dim(cc.description)}`)
                .join("\n"),
          );
        }
        printInfo(rule() + "\n");
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
        printInfo(
          `context: ${tokens} / ${cfg.numCtx} tokens (${Math.round(pct * 100)}%)\n` +
            `  ${meterBar(pct, 24)}\n`,
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
        printInfo("project + working memory reloaded into context.\n");
      } else if (cmd === "portmem") {
        const mem = readPortMem(cwd);
        printInfo((mem || "portmem.md is empty — it fills in as you work here.") + "\n");
      } else if (cmd === "todos") {
        printInfo(renderTodos() + "\n");
      } else if (cmd === "plan") {
        const on = planMode.toggle();
        printInfo(
          (on
            ? "plan mode ON — read-only investigation; the agent will not change anything."
            : "plan mode OFF — the agent can make changes again.") + "\n",
        );
      } else if (cmd === "diff") {
        const d = await gitDiff(cwd);
        printInfo((d || "(no working-tree changes)") + "\n");
      } else if (cmd === "commit") {
        printInfo((await agent.gitCommit(arg)) + "\n");
      } else if (cmd === "jobs") {
        if (arg) {
          const job = getJob(arg);
          printInfo(
            (job
              ? `${job.id} [${job.status}]  ${job.command}\n${job.output.trim() || "(no output)"}`
              : `no job with id "${arg}"`) + "\n",
          );
        } else {
          const jobs = listJobs();
          printInfo(
            (jobs.length
              ? "background jobs:\n" +
                jobs.map((j) => `  ${j.id}  [${j.status}]  ${j.command}`).join("\n")
              : "no background jobs.") + "\n",
          );
        }
      } else if (cmd === "airgap") {
        const on = airgap.toggle();
        printInfo(
          (on
            ? "air-gap mode ON — web_fetch and web_search are disabled."
            : "air-gap mode OFF — network tools are enabled.") + "\n",
        );
      } else if (cmd === "rules") {
        if (arg.toLowerCase() === "clear") {
          printInfo(`cleared ${agent.rules.clearLearned()} learned rule(s).\n`);
        } else {
          const { configured, learned } = agent.rules.list();
          const fmt = (r: { action: string; tool: string; pattern?: string }): string =>
            `  ${r.action.padEnd(5)} ${r.tool}${r.pattern ? "  ·  " + r.pattern : ""}`;
          let txt = "permission rules:";
          txt += "\n configured:\n" + (configured.length ? configured.map(fmt).join("\n") : "  (none)");
          txt += "\n learned:\n" + (learned.length ? learned.map(fmt).join("\n") : "  (none)");
          printInfo(txt + "\n");
        }
      } else if (cmd === "sessions") {
        const sessions = listSessions();
        printInfo(
          (sessions.length
            ? "saved sessions:\n" +
              sessions
                .map((s) => `  ${s.id}  (${s.turns} turn${s.turns === 1 ? "" : "s"})  ${s.preview}`)
                .join("\n")
            : "no saved sessions yet.") + "\n",
        );
      } else if (cmd === "resume") {
        const sessions = listSessions();
        if (sessions.length === 0) {
          printError("no saved sessions to resume.");
        } else {
          let pick = arg
            ? sessions.find((s) => s.id === arg || s.id.startsWith(arg))
            : undefined;
          if (!arg) {
            const idx = await selectFromMenu(
              "Resume which session?",
              sessions.map((s) => `${s.id}  ${s.preview}`),
              0,
            );
            pick = sessions[idx];
          }
          const loaded = pick ? loadSession(pick.id) : null;
          if (!loaded) {
            printError(arg ? `no session matching "${arg}".` : "could not load that session.");
          } else {
            agent.importMessages(loaded.messages);
            sessionId = loaded.id;
            printInfo(`resumed session ${loaded.id} (${loaded.turns} turns).\n`);
          }
        }
      } else if (cmd === "doctor") {
        const lines: string[] = ["diagnostics:"];
        try {
          await provider.healthCheck();
          lines.push(`  ${c.green("✓")} Ollama reachable (${cfg.baseUrl})`);
        } catch (e) {
          lines.push(`  ${c.red("✗")} Ollama: ${(e as Error).message}`);
        }
        try {
          const models = await provider.listModels();
          const has = models.includes(cfg.model);
          lines.push(
            `  ${has ? c.green("✓") : c.yellow("?")} model ${cfg.model}${has ? "" : " (not installed)"}`,
          );
        } catch {
          lines.push(`  ${c.yellow("?")} could not list models`);
        }
        if (cfg.rag.enabled) {
          const ok = await commandExists(cfg.rag.command);
          lines.push(
            `  ${ok ? c.green("✓") : c.yellow("?")} RAG CLI "${cfg.rag.command}"${ok ? "" : " not on PATH"}`,
          );
        }
        lines.push(
          `  ${(await isGitRepo(cwd)) ? c.green("✓") + " git repository" : c.dim("– not a git repository")}`,
        );
        lines.push(`  ${c.dim("MCP tools:")} ${mcpTools.length}`);
        printInfo(lines.join("\n") + "\n");
      } else if (cmd === "status") {
        const usage = agent.contextUsage();
        const modes = [
          planMode.active ? "plan" : null,
          autonomy.enabled ? "autonomous" : null,
          airgap.enabled ? "air-gapped" : null,
        ].filter(Boolean);
        printInfo(
          [
            "status:",
            `  model      ${cfg.model}${cfg.plannerModel ? ` (planner: ${cfg.plannerModel})` : ""}`,
            `  backend    ${backendLabel}`,
            `  context    ${usage.tokens} / ${cfg.numCtx} tokens (${Math.round(usage.pct * 100)}%)`,
            `  session    ${sessionId}`,
            `  modes      ${modes.length ? modes.join(", ") : "normal"}`,
            `  audit log  ${cfg.auditLog ? AUDIT_FILE : "off"}`,
            `  sandbox    ${permissions.roots().join(", ")}`,
          ].join("\n") + "\n",
        );
      } else if (customCommands.has(cmd)) {
        await runTurn(expandCommand(customCommands.get(cmd)!, arg));
      } else {
        printError(`unknown command "${input}". Try /help.`);
      }
      continue;
    }

    await runTurn(input);
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
