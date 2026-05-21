import type {
  AgentConfig,
  ChatDelta,
  Message,
  Provider,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult,
} from "./types.js";
import { readFileSync } from "node:fs";
import type { Permissions } from "./permissions.js";
import { buildToolRegistry, type ToolRegistry } from "./tools/index.js";
import { autonomy } from "./autonomy.js";
import { planMode } from "./planmode.js";
import { UndoStore } from "./undo.js";
import { FileContext } from "./context.js";
import { loadProjectMemory } from "./projectMemory.js";
import { loadPortMem, appendPortMem } from "./portmem.js";
import { runHooks } from "./hooks.js";
import { isGitRepo, gitDiff, gitCommitAll } from "./git.js";
import { PermissionRules } from "./rules.js";
import { audit } from "./audit.js";
import { validateArgs } from "./validate.js";
import { resolveToolName, repairArgs } from "./repair.js";
import { workspaceTree } from "./workspace.js";
import {
  c,
  confirmToolUse,
  createStreamRenderer,
  printDiff,
  printError,
  printInfo,
  printToolCall,
  printToolResult,
  startSpinner,
  stopSpinner,
} from "./ui.js";

/** Image file extensions attached to a turn as input for a vision model. */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function systemPrompt(
  roots: string[],
  readOnlyRoots: string[],
  workspace: string,
  ragEnabled: boolean,
  projectMemory: string,
  workingMemory: string,
): string {
  return [
    "You are Pretzel Porter — an autonomous coding-and-ops agent that runs",
    "entirely on the operator's own machine. Nothing leaves this computer; that",
    "privacy is the point. You are trusted with real, sensitive work: code,",
    "security engagements, finances, private documents.",
    "",
    "You work by taking a tool action, observing the result, and continuing",
    "until the task is done — then reporting back. Your tools read, search,",
    "edit, write, and list files, map the project (repo_map), run shell",
    "commands, and track a task list (todo_write). You may touch paths inside",
    "this sandbox:",
    ...roots.map((r) => `  - ${r}`),
    ...(readOnlyRoots.length
      ? [
          "",
          "Read-only — you may read these but never modify them:",
          ...readOnlyRoots.map((r) => `  - ${r}`),
        ]
      : []),
    "",
    "Workspace layout — the primary sandbox root exactly as it is right now:",
    "",
    workspace,
    "",
    "Use this tree. Do not guess paths and do not assume the root directory is",
    "all there is — what you need is often inside a subdirectory. It tells you",
    "what already exists; still read a file before you edit it.",
    "",
    ...(ragEnabled
      ? [
          "search_docs runs semantic search over an indexed knowledge base — use",
          "it when an answer may already live in existing documents.",
          "",
        ]
      : []),
    "How to work:",
    "- Facts come from tools. If you have not read it, you do not know it —",
    "  never invent file contents, paths, errors, or numbers. Do not assume a",
    "  path or file exists; use list_dir to check.",
    "- Orient before acting: on an unfamiliar project run repo_map or list_dir",
    "  first. Always read a file before you edit it.",
    "- For bulk data — many files, large logs, big JSON dumps — do not read it",
    "  all into context. Run code against it instead (a sandboxed-exec tool if",
    "  one is available, otherwise run_shell with grep/awk/jq) and read back",
    "  only the summary you need. Raw data in context is wasted space.",
    "- This machine is a Kali Linux security workstation. run_shell reaches its",
    "  full installed toolkit — recon, scanning, enumeration, exploitation, and",
    "  reporting tools. For an authorised security engagement, use them directly:",
    "  pick the right tool, run it, read the output, then chain the next step.",
    "- Scans and fuzzing take minutes, not seconds. When you expect a slow",
    "  command, pass a generous `timeout` (seconds) to run_shell — e.g. 600 for",
    "  an nmap service scan over many hosts — or use run_background and poll",
    "  job_status. Do not let a long scan die on the default timeout.",
    "- A finding must be grounded in evidence. Before you state a conclusion —",
    "  a vulnerability, a clean result, a fact about the target — point to the",
    "  specific tool output or file content that shows it. Never conclude from",
    "  a summary or an assumption; if you have not verified it, say so and",
    "  verify. In security work a false positive and a false negative each",
    "  carry real cost — do not guess to look finished.",
    "- Move in concrete steps: think briefly, take ONE clear action, look at the",
    "  result, decide the next. If unsure, take a small step to find out (read,",
    "  list, grep) — never speculate in circles or re-reason the same point.",
    "  Once you have enough to act, act.",
    "- Use edit_file for small changes, write_file to create or fully replace.",
    "- For a task with several steps, use todo_write to plan and track it.",
    "- Write and shell actions need operator approval; if something is",
    "  destructive or ambiguous, say so plainly first.",
    "- A turn may arrive with attached file contents already included — use",
    "  them; do not re-read those files.",
    "- Do not announce a next step and then stop. If you say you will read,",
    "  check, search, or run something, include that tool call in the SAME",
    "  response. Ending a turn with no tool call hands control back to the",
    "  operator — do that only when the task is complete or you are genuinely",
    "  blocked, never just to narrate intent or to ask for permission you have.",
    "- Stop when the task is genuinely done. Do not continue for its own sake.",
    "",
    "How to respond:",
    "- Be concise. The operator wants the result, not narration. Do not restate",
    "  the request, do not explain what you are about to do, do not pad.",
    "- Lead with the answer. A few sentences is usually enough; use a short list",
    "  only when it genuinely helps.",
    "- For anything quantitative — finances, counts, findings — show the numbers",
    "  and how you derived them.",
    "- If something failed or you could not do it, say so directly and why.",
    "  Never claim an action worked when it did not.",
    ...(projectMemory
      ? [
          "",
          "──────────── Project memory (loaded from PRETZEL.md) ────────────",
          projectMemory,
          "─────────────────────────────────────────────────────────────────",
        ]
      : []),
    ...(workingMemory
      ? [
          "",
          "──────────── Working memory (recent activity, portmem.md) ────────────",
          workingMemory,
          "This is what you were doing in earlier sessions in this directory.",
          "Continue from here. portmem.md is updated automatically each turn.",
          "──────────────────────────────────────────────────────────────────────",
        ]
      : []),
  ].join("\n");
}

/** Fraction of the context window at which a turn auto-compacts. */
const AUTO_COMPACT_AT = 0.8;
/** Messages kept verbatim at the tail when compacting. */
const COMPACT_KEEP = 2;

/** Drives the think → call tools → observe loop for one conversation. */
export class Agent {
  private readonly messages: Message[];
  private readonly ctx: ToolContext;
  private readonly tools: ToolRegistry;
  /** In-session file snapshots powering /undo and /redo. */
  readonly undo = new UndoStore();
  /** Files and directories pinned into every turn (+ @mention expansion). */
  readonly fileContext: FileContext;
  /** Wildcard allow/ask/deny permission rules. */
  readonly rules: PermissionRules;

  private controller: AbortController | null = null;
  private _running = false;
  /** Auto-compaction is attempted at most once per user turn. */
  private autoCompactedThisTurn = false;
  /** The final answer text of the last turn — read back by a parent agent. */
  private lastAnswer = "";
  /** Tool names executed during the current turn — for the portmem.md log. */
  private turnTools: string[] = [];
  /** Per-turn count of identical tool-call signatures — for loop detection. */
  private turnCallCounts = new Map<string, number>();

  constructor(
    private readonly cfg: AgentConfig,
    private readonly provider: Provider,
    private readonly permissions: Permissions,
    private readonly extraTools: Tool[] = [],
    /** True for a spawned sub-agent: it skips hooks and cannot nest further. */
    private readonly isSubagent = false,
  ) {
    this.tools = buildToolRegistry(cfg, extraTools);
    this.ctx = {
      permissions,
      cwd: permissions.primaryRoot(),
      shellTimeoutMs: cfg.shellTimeoutMs,
      maxReadBytes: cfg.maxReadBytes,
      ragCommand: cfg.rag.command,
      ragDefaultK: cfg.rag.defaultK,
      // Only a top-level agent can spawn sub-agents — this keeps depth at one.
      subagent: isSubagent ? undefined : (prompt) => this.spawnSubagent(prompt),
    };
    this.fileContext = new FileContext(permissions);
    this.rules = new PermissionRules(cfg.permissionRules);
    this.messages = [{ role: "system", content: this.buildSystemPrompt() }];
  }

  /** Export the conversation for session persistence. */
  exportMessages(): Message[] {
    return [...this.messages];
  }

  /** Replace the conversation with a saved one (used by /resume). */
  importMessages(messages: Message[]): void {
    if (messages.length === 0) return;
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /** Collect base64 images from @path mentions of image files. */
  private collectImages(input: string): string[] {
    const images: string[] = [];
    const re = /(?:^|\s)@([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      if (!IMAGE_RE.test(m[1]!)) continue;
      try {
        images.push(readFileSync(this.permissions.resolveWithin(m[1]!)).toString("base64"));
      } catch {
        // unreadable or out of sandbox — skip
      }
    }
    return images;
  }

  /** Run a prompt in a fresh sub-agent and return its final answer. */
  private async spawnSubagent(prompt: string): Promise<string> {
    printInfo(c.dim("  ↳ sub-agent started"));
    const sub = new Agent(this.cfg, this.provider, this.permissions, this.extraTools, true);
    await sub.run(prompt);
    printInfo(c.dim("  ↳ sub-agent finished"));
    return sub.lastAnswer || "(the sub-agent produced no final answer)";
  }

  private buildSystemPrompt(): string {
    return systemPrompt(
      this.permissions.roots(),
      this.permissions.readOnlyRoots(),
      workspaceTree(this.permissions.primaryRoot()),
      this.cfg.rag.enabled,
      loadProjectMemory(this.permissions.primaryRoot()),
      this.cfg.portMem ? loadPortMem(this.permissions.primaryRoot()) : "",
    );
  }

  /** Reload PRETZEL.md into the system prompt (after /init or an edit). */
  reloadContext(): void {
    this.messages[0] = { role: "system", content: this.buildSystemPrompt() };
  }

  /** Forget the conversation, keep the system prompt. */
  reset(): void {
    this.messages.length = 1;
  }

  /** True while a generation is in flight. */
  get running(): boolean {
    return this._running;
  }

  /** The final answer of the most recent turn (empty if it produced none). */
  get answer(): string {
    return this.lastAnswer;
  }

  /** Abort the in-flight generation (Ctrl-C). No-op when idle. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Rough token estimate of the current context (≈ 4 chars per token). */
  estimateTokens(): number {
    let chars = 0;
    for (const m of this.messages) {
      chars += m.content.length + (m.thinking?.length ?? 0);
      if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
      chars += 8; // per-message framing overhead
    }
    return Math.ceil(chars / 4);
  }

  /** Context-window usage, for the status-line meter. */
  contextUsage(): { tokens: number; pct: number } {
    const tokens = this.estimateTokens();
    return { tokens, pct: tokens / this.cfg.numCtx };
  }

  /** Revert the last file mutation. Returns a status line for the operator. */
  performUndo(): string {
    const label = this.undo.undo();
    return label ? `Reverted: ${label}` : "Nothing to undo.";
  }

  /** Re-apply the last reverted mutation. */
  performRedo(): string {
    const label = this.undo.redo();
    return label ? `Re-applied: ${label}` : "Nothing to redo.";
  }

  /**
   * Commit the working tree. With no message, the model writes one from the
   * diff. Returns a status line for the operator.
   */
  async gitCommit(message: string): Promise<string> {
    const cwd = this.ctx.cwd;
    if (!(await isGitRepo(cwd))) return "Not a git repository.";
    let msg = message.trim();
    if (!msg) {
      const diff = `${await gitDiff(cwd, true)}\n${await gitDiff(cwd, false)}`.trim();
      if (!diff) return "Nothing to commit — working tree clean.";
      startSpinner("writing commit message");
      try {
        const resp = await this.provider.chat(
          [
            {
              role: "system",
              content:
                "Write a concise one-line git commit message (imperative mood, " +
                "under 72 characters) for this diff. Output only the message.",
            },
            { role: "user", content: "Diff:\n" + diff.slice(0, 12_000) },
          ],
          [],
        );
        msg = (resp.content.trim().split("\n")[0] ?? "")
          .replace(/^["'`]+|["'`]+$/g, "")
          .trim();
      } catch (e) {
        stopSpinner();
        return `Could not generate a commit message: ${(e as Error).message}`;
      }
      stopSpinner();
      if (!msg) msg = "update";
    }
    const result = await gitCommitAll(cwd, msg);
    return result.ok ? `Committed: ${msg}` : `Commit failed: ${result.output}`;
  }

  /** Run one user turn to completion (final answer or step limit). */
  async run(userInput: string): Promise<void> {
    if (!this.isSubagent) {
      const submit = await runHooks(
        "UserPromptSubmit",
        this.cfg.hooks.UserPromptSubmit,
        { prompt: userInput },
        this.ctx.cwd,
      );
      for (const line of submit.output) printInfo(c.dim(`  [hook] ${line}`));
      if (submit.blocked) {
        printError("A UserPromptSubmit hook blocked this prompt.");
        return;
      }
    }

    // In plan mode the request is wrapped so the model investigates only.
    const request = planMode.active
      ? "[PLAN MODE — read-only. Investigate with read-only tools, then present a " +
        "clear step-by-step plan. Do not modify files or run shell commands.]\n\n" +
        userInput
      : userInput;

    // Pinned files and @mentions are attached ahead of the request itself.
    const attached = this.fileContext.build(userInput);
    const content = attached ? `${attached}\n\n[User request]\n${request}` : request;
    const images = this.collectImages(userInput);
    this.messages.push({
      role: "user",
      content,
      images: images.length ? images : undefined,
    });
    this.lastAnswer = "";
    this.turnTools = [];
    this.turnCallCounts.clear();
    this.controller = new AbortController();
    this._running = true;
    this.autoCompactedThisTurn = false;
    try {
      await this.loop(this.controller.signal);
    } finally {
      this._running = false;
      this.controller = null;
    }

    if (!this.isSubagent) {
      const stop = await runHooks("Stop", this.cfg.hooks.Stop, { prompt: userInput }, this.ctx.cwd);
      for (const line of stop.output) printInfo(c.dim(`  [hook] ${line}`));
      // Record the turn in the directory's working memory (portmem.md) —
      // only when explicitly enabled (see AgentConfig.portMem).
      if (this.cfg.portMem) {
        appendPortMem(this.ctx.cwd, {
          request: userInput,
          tools: this.turnTools,
          outcome: this.lastAnswer,
        });
      }
    }
  }

  private async loop(signal: AbortSignal): Promise<void> {
    let autoContinues = 0;
    for (let step = 0; step < this.cfg.maxSteps; step++) {
      if (signal.aborted) return;

      // Keep the conversation inside the context window.
      if (!this.autoCompactedThisTurn && this.contextUsage().pct > AUTO_COMPACT_AT) {
        this.autoCompactedThisTurn = true;
        printInfo("  " + (await this.compact("auto")) + "\n");
      }

      startSpinner("thinking");
      const render = createStreamRenderer();
      let sawDelta = false;
      // Safety net: if generation degenerates into a repetition loop, abort it.
      let streamText = "";
      let loopHit = false;
      const onDelta = (d: ChatDelta): void => {
        if (!sawDelta) {
          stopSpinner();
          sawDelta = true;
        }
        streamText += (d.thinking ?? "") + (d.content ?? "");
        if (!loopHit && streamText.length > 1200 && isRepetitionLoop(streamText)) {
          loopHit = true;
          this.controller?.abort();
        }
        if (d.thinking && !this.cfg.hideThinking) render.thinking(d.thinking);
        if (d.content) render.content(d.content);
      };

      // Plan mode can route planning through a dedicated planner model.
      const model =
        planMode.active && this.cfg.plannerModel ? this.cfg.plannerModel : undefined;

      let resp;
      try {
        resp = await this.provider.chat(this.messages, this.tools.schemas, {
          signal,
          onDelta,
          model,
        });
      } catch (e) {
        stopSpinner();
        render.end();
        const msg = (e as Error).message;
        if (loopHit) {
          printError(
            "The model fell into a repetition loop — stopped it. Try /reset, then rephrase.",
          );
        } else if (msg === "__ABORTED__" || signal.aborted) {
          printInfo("  (cancelled)\n");
        } else {
          printError(msg);
        }
        return;
      }
      stopSpinner();
      render.end();

      this.messages.push({
        role: "assistant",
        content: resp.content,
        thinking: resp.thinking,
        tool_calls: resp.toolCalls.length ? resp.toolCalls : undefined,
      });

      if (resp.toolCalls.length === 0) {
        const text = resp.content.trim();
        if (text) this.lastAnswer = text;
        // Autonomous mode: a weak model often narrates a next step and ends the
        // turn instead of taking it. When it clearly intends to continue, nudge
        // it on rather than handing control back — that is what autonomous means.
        if (autonomy.enabled && autoContinues < 3 && looksUnfinished(text)) {
          autoContinues++;
          printInfo(c.dim("  ⚡ autonomous — continuing"));
          this.messages.push({
            role: "user",
            content:
              "Continue. You described a next step but did not take it — do it " +
              "now by calling the tool. Autonomous mode is on; you already have " +
              "approval. Stop only when the task is complete or you hit a real " +
              "blocker — and if you are blocked, say so explicitly.",
          });
          continue;
        }
        if (!text) printError("The model returned an empty response.");
        return;
      }

      autoContinues = 0; // a tool call ran — real progress was made
      for (const call of resp.toolCalls) {
        if (signal.aborted) return;
        const result = await this.execTool(call);
        this.messages.push({ role: "tool", content: result.output, tool_name: call.name });
      }
    }

    printError(
      `Stopped after ${this.cfg.maxSteps} steps without finishing. Try /reset and a smaller request.`,
    );
  }

  private async execTool(call: ToolCall): Promise<ToolResult> {
    // Repair common malformed calls from weak local models before dispatch:
    // string-encoded argument blobs, and names with junk / wrong case / a
    // provider prefix. A fuzzy name match avoids a wasted correction round-trip.
    call.arguments = repairArgs(call.arguments);
    let tool = this.tools.get(call.name);
    if (!tool) {
      const resolved = resolveToolName(call.name, this.tools.names());
      if (resolved) {
        printInfo(c.dim(`  (interpreted "${call.name}" as ${resolved})`));
        call.name = resolved;
        tool = this.tools.get(resolved);
      }
    }
    if (!tool) {
      printToolCall(call.name, "unknown tool");
      const known = this.tools.names().join(", ");
      const out = `No tool named "${call.name}". Available tools: ${known}.`;
      printToolResult(false, out);
      return { ok: false, output: out };
    }

    // Loop guard: a weak model can call the same tool with the same arguments
    // over and over when it fails. After a few identical calls, stop running
    // it and push back hard so the model changes approach instead of looping.
    const sig = `${call.name}:${JSON.stringify(call.arguments)}`;
    const repeats = (this.turnCallCounts.get(sig) ?? 0) + 1;
    this.turnCallCounts.set(sig, repeats);
    if (repeats >= 3) {
      printToolCall(call.name, "loop detected");
      printToolResult(false, "loop detected — identical call repeated");
      return {
        ok: false,
        output:
          `Loop detected — you have called ${call.name} with these exact ` +
          `arguments ${repeats} times this turn and it keeps failing the same ` +
          `way. Stop repeating it. Re-read the file to get its exact current ` +
          `text, or change approach entirely: different arguments, a different ` +
          `tool, or tell the operator what is blocking you.`,
      };
    }

    let summary: string;
    try {
      summary = tool.summarize(call.arguments);
    } catch {
      summary = JSON.stringify(call.arguments);
    }
    printToolCall(call.name, summary);

    // Validate the model's arguments against the tool schema before anything
    // else — a precise correction lets a weak model self-fix on its next step.
    const problems = validateArgs(tool.schema, call.arguments);
    if (problems.length > 0) {
      printToolResult(false, `invalid arguments — ${problems[0]}`);
      return {
        ok: false,
        output:
          `Invalid arguments for ${call.name}:\n` +
          problems.map((p) => `  - ${p}`).join("\n") +
          `\nCorrect the arguments and call ${call.name} again.`,
      };
    }

    // Plan mode is read-only: refuse anything that would change state.
    if (planMode.active && tool.risk !== "read") {
      printToolResult(false, "blocked — plan mode is read-only");
      return {
        ok: false,
        output:
          "Plan mode is active (read-only). Do not call write or shell tools. " +
          "Present a written step-by-step plan of the changes instead.",
      };
    }

    const preHook = await runHooks(
      "PreToolUse",
      this.cfg.hooks.PreToolUse,
      { tool: call.name, arguments: call.arguments },
      this.ctx.cwd,
    );
    for (const line of preHook.output) printInfo(c.dim(`  [hook] ${line}`));
    if (preHook.blocked) {
      printToolResult(false, "blocked by a PreToolUse hook");
      return { ok: false, output: "A PreToolUse hook blocked this tool call. Do not retry it." };
    }

    // Show a coloured diff of what a write tool will change, before approval.
    if (tool.risk !== "read" && tool.preview) {
      try {
        const diff = await tool.preview(call.arguments, this.ctx);
        if (diff && diff !== "(no changes)") {
          console.log();
          printDiff(diff);
          console.log();
        }
      } catch {
        // preview is best-effort — never block a call on it
      }
    }

    if (tool.risk !== "read") {
      // Permission rules are evaluated first; then autonomy / autoApprove;
      // a learned "always" rule is recorded when the operator chooses it.
      const ruleAction = this.rules.evaluate(call.name, summary);
      if (ruleAction === "deny") {
        printToolResult(false, "denied by a permission rule");
        return {
          ok: false,
          output: "A permission rule denies this tool call. Do not retry it; ask how to proceed.",
        };
      }
      const autoOk =
        autonomy.enabled ||
        ruleAction === "allow" ||
        (ruleAction !== "ask" && this.cfg.autoApprove[tool.risk]);
      if (autoOk) {
        if (autonomy.enabled && ruleAction !== "allow") {
          printInfo(`  ${c.yellow("⚡ autonomous")} — ${tool.risk} action auto-approved`);
        }
      } else {
        const decision = await confirmToolUse(
          `  ${c.yellow("approve this " + tool.risk + " action?")}`,
        );
        if (decision === "no") {
          printToolResult(false, "declined by user");
          return {
            ok: false,
            output:
              "The user declined to run this tool call. Do not retry it; ask how to proceed.",
          };
        }
        if (decision === "always") {
          this.rules.remember({ tool: call.name, action: "allow" });
          printInfo(c.dim(`  rule added — ${call.name} is now auto-approved`));
        }
      }
    }

    // Snapshot the affected file so the action can be reverted with /undo.
    let snapshotted = false;
    if (tool.affectedPath) {
      const path = tool.affectedPath(call.arguments, this.ctx);
      if (path) {
        this.undo.snapshot(summary, [path]);
        snapshotted = true;
      }
    }

    let result: ToolResult;
    try {
      result = await tool.run(call.arguments, this.ctx);
    } catch (e) {
      result = { ok: false, output: `Tool failed: ${(e as Error).message}` };
    }
    this.turnTools.push(call.name);

    // A failed mutation changed nothing on disk — drop its snapshot.
    if (snapshotted && !result.ok) this.undo.discardLast();

    // Optionally turn each successful AI file change into a git commit.
    if (result.ok && tool.risk === "write" && this.cfg.autoCommit) {
      const commit = await gitCommitAll(this.ctx.cwd, `pretzel-porter: ${summary}`);
      printInfo(
        c.dim(
          commit.ok
            ? "  ✓ auto-committed"
            : `  (auto-commit skipped: ${commit.output.split("\n")[0]})`,
        ),
      );
    }

    if (tool.risk !== "read") audit({ tool: call.name, summary, ok: result.ok });

    const postHook = await runHooks(
      "PostToolUse",
      this.cfg.hooks.PostToolUse,
      { tool: call.name, arguments: call.arguments, ok: result.ok, output: result.output },
      this.ctx.cwd,
    );
    for (const line of postHook.output) printInfo(c.dim(`  [hook] ${line}`));

    printToolResult(result.ok, result.output);
    return result;
  }

  /**
   * Summarise older turns into a single message to reclaim context space.
   * Keeps the system prompt and the last COMPACT_KEEP messages verbatim.
   */
  async compact(reason: "manual" | "auto"): Promise<string> {
    const head = this.messages[0]!;
    const rest = this.messages.slice(1);

    // Find a split point that does not leave a dangling tool result at the head.
    let splitAt = rest.length - COMPACT_KEEP;
    while (splitAt > 0 && rest[splitAt]?.role === "tool") splitAt--;
    if (splitAt <= 0) return "Not enough history to compact yet.";

    const older = rest.slice(0, splitAt);
    const tail = rest.slice(splitAt);
    const transcript = older.map(renderForSummary).join("\n\n");

    startSpinner(reason === "auto" ? "context full — compacting" : "compacting");
    let summary: string;
    try {
      const resp = await this.provider.chat(
        [
          {
            role: "system",
            content:
              "You compress conversation history. Produce a dense summary that " +
              "preserves every fact, decision, file path, number, and unfinished " +
              "task. No preamble, no commentary — just the summary.",
          },
          {
            role: "user",
            content: "Summarise this conversation so it can continue seamlessly:\n\n" + transcript,
          },
        ],
        [],
      );
      summary = resp.content.trim();
    } catch (e) {
      stopSpinner();
      return `Compaction failed: ${(e as Error).message}`;
    }
    stopSpinner();
    if (!summary) return "Compaction produced nothing — history left unchanged.";

    this.messages.length = 0;
    this.messages.push(head);
    this.messages.push({
      role: "user",
      content: "[Summary of earlier conversation]\n" + summary,
    });
    this.messages.push(...tail);
    return `Compacted ${older.length} messages — context now ~${this.estimateTokens()} tokens.`;
  }
}

/**
 * Detect degenerate repetition: the same short chunk repeated many times near
 * the end of a stream. A weak/abliterated model can lock into a loop ("…way to
 * see if there's any way to…") and never stop on its own; this catches it so
 * the agent can abort instead of running to the token limit.
 */
function isRepetitionLoop(text: string): boolean {
  const tail = text.slice(-1000);
  if (tail.length < 400) return false;
  const probe = tail.slice(-64);
  if (probe.trim().length < 24) return false;
  let count = 0;
  let idx = 0;
  while ((idx = tail.indexOf(probe, idx)) !== -1) {
    count++;
    idx += probe.length;
  }
  return count >= 5;
}

/**
 * Heuristic: does this assistant message look like the model narrated a next
 * step and then stopped, rather than actually finishing? Used to auto-continue
 * in autonomous mode instead of handing control back for no reason.
 */
function looksUnfinished(text: string): boolean {
  if (!text) return false;
  // The "I'll go do X next" tell lands at the end of the message.
  const tail = text.slice(-400).toLowerCase();
  return /\b(i'?ll |i will |i'?m going to |let me |let's |next,? i|now i'?ll|i need to (find|check|look|search|locate|run|read|grep|inspect|examine|verify))/.test(
    tail,
  );
}

/** Flatten a message into plain text for the compaction prompt. */
function renderForSummary(m: Message): string {
  if (m.role === "tool") return `[tool result: ${m.tool_name}]\n${m.content}`;
  if (m.role === "assistant") {
    const calls = m.tool_calls?.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(", ");
    return `assistant: ${m.content}${calls ? `\n[tool calls: ${calls}]` : ""}`;
  }
  return `${m.role}: ${m.content}`;
}
