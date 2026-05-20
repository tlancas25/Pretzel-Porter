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
import type { Permissions } from "./permissions.js";
import { buildToolRegistry, type ToolRegistry } from "./tools/index.js";
import { autonomy } from "./autonomy.js";
import { planMode } from "./planmode.js";
import { UndoStore } from "./undo.js";
import { FileContext } from "./context.js";
import { loadProjectMemory } from "./projectMemory.js";
import { runHooks } from "./hooks.js";
import { isGitRepo, gitDiff, gitCommitAll } from "./git.js";
import {
  c,
  confirm,
  createStreamRenderer,
  printDiff,
  printError,
  printInfo,
  printToolCall,
  printToolResult,
  startSpinner,
  stopSpinner,
} from "./ui.js";

function systemPrompt(
  roots: string[],
  readOnlyRoots: string[],
  ragEnabled: boolean,
  projectMemory: string,
): string {
  return [
    "You are Pretzel Porter, a private assistant that runs entirely on the user's",
    "own machine. Nothing the user shares leaves this computer — that is the point",
    "of the tool. The user relies on you for sensitive material such as their",
    "investment portfolio and personal finances.",
    "",
    "You have tools to read, search, edit, write, and list files, to map the",
    "project structure (repo_map), to run shell commands, and to keep long-term",
    "memory (remember / recall). You can read and write paths inside this sandbox:",
    ...roots.map((r) => `  - ${r}`),
    ...(readOnlyRoots.length
      ? [
          "",
          "These reference paths are read-only — you may read them but not modify them:",
          ...readOnlyRoots.map((r) => `  - ${r}`),
        ]
      : []),
    "",
    ...(ragEnabled
      ? [
          "You also have search_docs: semantic search over an indexed knowledge base.",
          "When a question may be answered by existing documents, call search_docs",
          "first to retrieve relevant chunks, then reason over them. It is not limited",
          "to the file sandbox.",
          "",
        ]
      : []),
    "Working rules:",
    "- Use tools to get facts. Never invent file contents or numbers.",
    "- For an unfamiliar codebase, call repo_map first to orient yourself.",
    "- Always read a file before editing it, so edits match the real text.",
    "- Prefer edit_file for small changes; use write_file to create or fully replace.",
    "- Be cautious: write and shell actions ask the user for approval. If a request",
    "  is destructive or ambiguous, explain the risk before acting.",
    "- Use remember to save durable facts worth keeping across sessions; use recall",
    "  to retrieve them. Never store secrets.",
    "- Delegate a large, self-contained sub-job to a sub-agent with the task tool",
    "  to keep this conversation focused.",
    "- A turn may include an [Attached files for context] block — treat those files",
    "  as already read; do not re-read them with a tool.",
    "- Think step by step, then take one or more tool actions, observe results, and",
    "  continue until the task is done.",
    "- When finished, give a short, direct answer. For financial questions, show the",
    "  numbers and how you derived them.",
    ...(projectMemory
      ? [
          "",
          "──────────── Project memory (loaded from PRETZEL.md) ────────────",
          projectMemory,
          "─────────────────────────────────────────────────────────────────",
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

  private controller: AbortController | null = null;
  private _running = false;
  /** Auto-compaction is attempted at most once per user turn. */
  private autoCompactedThisTurn = false;
  /** The final answer text of the last turn — read back by a parent agent. */
  private lastAnswer = "";

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
    this.messages = [{ role: "system", content: this.buildSystemPrompt() }];
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
      this.cfg.rag.enabled,
      loadProjectMemory(this.permissions.primaryRoot()),
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
    this.messages.push({ role: "user", content });
    this.lastAnswer = "";
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
    }
  }

  private async loop(signal: AbortSignal): Promise<void> {
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
      const onDelta = (d: ChatDelta): void => {
        if (!sawDelta) {
          stopSpinner();
          sawDelta = true;
        }
        if (d.thinking) render.thinking(d.thinking);
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
        if (msg === "__ABORTED__" || signal.aborted) printInfo("  (cancelled)\n");
        else printError(msg);
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
        if (resp.content.trim()) this.lastAnswer = resp.content.trim();
        else printError("The model returned an empty response.");
        return;
      }

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
    const tool = this.tools.get(call.name);
    if (!tool) {
      printToolCall(call.name, "unknown tool");
      const known = this.tools.names().join(", ");
      const out = `No tool named "${call.name}". Available tools: ${known}.`;
      printToolResult(false, out);
      return { ok: false, output: out };
    }

    let summary: string;
    try {
      summary = tool.summarize(call.arguments);
    } catch {
      summary = JSON.stringify(call.arguments);
    }
    printToolCall(call.name, summary);

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

    const needsConfirm =
      tool.risk !== "read" && !this.cfg.autoApprove[tool.risk] && !autonomy.enabled;
    if (needsConfirm) {
      const approved = await confirm(`  ${c.yellow("approve this " + tool.risk + " action?")}`);
      if (!approved) {
        printToolResult(false, "declined by user");
        return {
          ok: false,
          output: "The user declined to run this tool call. Do not retry it; ask how to proceed.",
        };
      }
    } else if (tool.risk !== "read" && autonomy.enabled) {
      printInfo(`  ${c.yellow("⚡ autonomous")} — ${tool.risk} action auto-approved`);
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

/** Flatten a message into plain text for the compaction prompt. */
function renderForSummary(m: Message): string {
  if (m.role === "tool") return `[tool result: ${m.tool_name}]\n${m.content}`;
  if (m.role === "assistant") {
    const calls = m.tool_calls?.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(", ");
    return `assistant: ${m.content}${calls ? `\n[tool calls: ${calls}]` : ""}`;
  }
  return `${m.role}: ${m.content}`;
}
