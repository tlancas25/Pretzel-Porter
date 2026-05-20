import type {
  AgentConfig,
  Message,
  Provider,
  ToolCall,
  ToolContext,
  ToolResult,
} from "./types.js";
import type { Permissions } from "./permissions.js";
import { buildToolRegistry, type ToolRegistry } from "./tools/index.js";
import {
  c,
  confirm,
  printAssistant,
  printError,
  printThinking,
  printToolCall,
  printToolResult,
  startSpinner,
  stopSpinner,
} from "./ui.js";

function systemPrompt(roots: string[], ragEnabled: boolean): string {
  return [
    "You are Pretzel Porter, a private assistant that runs entirely on the user's",
    "own machine. Nothing the user shares leaves this computer — that is the point",
    "of the tool. The user relies on you for sensitive material such as their",
    "investment portfolio and personal finances.",
    "",
    "You have tools to read, search, edit, write, and list files, and to run shell",
    "commands. You can only touch paths inside this sandbox:",
    ...roots.map((r) => `  - ${r}`),
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
    "- Always read a file before editing it, so edits match the real text.",
    "- Prefer edit_file for small changes; use write_file to create or fully replace.",
    "- Be cautious: write and shell actions ask the user for approval. If a request",
    "  is destructive or ambiguous, explain the risk before acting.",
    "- Think step by step, then take one or more tool actions, observe results, and",
    "  continue until the task is done.",
    "- When finished, give a short, direct answer. For financial questions, show the",
    "  numbers and how you derived them.",
  ].join("\n");
}

/** Drives the think → call tools → observe loop for one conversation. */
export class Agent {
  private readonly messages: Message[];
  private readonly ctx: ToolContext;
  private readonly tools: ToolRegistry;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly provider: Provider,
    permissions: Permissions,
  ) {
    this.messages = [
      { role: "system", content: systemPrompt(permissions.roots(), cfg.rag.enabled) },
    ];
    this.tools = buildToolRegistry(cfg);
    this.ctx = {
      permissions,
      cwd: permissions.primaryRoot(),
      shellTimeoutMs: cfg.shellTimeoutMs,
      maxReadBytes: cfg.maxReadBytes,
      ragCommand: cfg.rag.command,
      ragDefaultK: cfg.rag.defaultK,
    };
  }

  /** Forget the conversation, keep the system prompt. */
  reset(): void {
    this.messages.length = 1;
  }

  /** Run one user turn to completion (final answer or step limit). */
  async run(userInput: string): Promise<void> {
    this.messages.push({ role: "user", content: userInput });

    for (let step = 0; step < this.cfg.maxSteps; step++) {
      startSpinner("thinking");
      let resp;
      try {
        resp = await this.provider.chat(this.messages, this.tools.schemas);
      } catch (e) {
        stopSpinner();
        printError((e as Error).message);
        return;
      }
      stopSpinner();

      this.messages.push({
        role: "assistant",
        content: resp.content,
        thinking: resp.thinking,
        tool_calls: resp.toolCalls.length ? resp.toolCalls : undefined,
      });

      if (resp.thinking) printThinking(resp.thinking);

      if (resp.toolCalls.length === 0) {
        if (resp.content.trim()) printAssistant(resp.content);
        else printError("The model returned an empty response.");
        return;
      }

      // The model may narrate before calling tools — show that too.
      if (resp.content.trim()) printAssistant(resp.content);

      for (const call of resp.toolCalls) {
        const result = await this.execTool(call);
        this.messages.push({ role: "tool", content: result.output, tool_name: call.name });
      }
    }

    printError(`Stopped after ${this.cfg.maxSteps} steps without finishing. Try /reset and a smaller request.`);
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

    const needsConfirm = tool.risk !== "read" && !this.cfg.autoApprove[tool.risk];
    if (needsConfirm) {
      const approved = await confirm(`  ${c.yellow("approve this " + tool.risk + " action?")}`);
      if (!approved) {
        printToolResult(false, "declined by user");
        return { ok: false, output: "The user declined to run this tool call. Do not retry it; ask how to proceed." };
      }
    }

    let result: ToolResult;
    try {
      result = await tool.run(call.arguments, this.ctx);
    } catch (e) {
      result = { ok: false, output: `Tool failed: ${(e as Error).message}` };
    }
    printToolResult(result.ok, result.output);
    return result;
  }
}
