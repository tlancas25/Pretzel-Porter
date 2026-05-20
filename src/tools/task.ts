import type { Tool } from "../types.js";
import { reqString, clamp } from "./util.js";

// The task tool delegates a self-contained job to a fresh sub-agent with its
// own clean context. Heavy investigation stays out of the main conversation —
// only the sub-agent's final answer comes back. Sub-agents cannot nest.

export const taskTool: Tool = {
  risk: "read",
  schema: {
    name: "task",
    description:
      "Delegate a focused, self-contained sub-task to a fresh sub-agent that " +
      "has its own clean context and the same tools. Use it for research or " +
      "multi-step work whose intermediate detail would otherwise clutter the " +
      "main conversation. Only the sub-agent's final answer is returned.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A complete, self-contained description of the sub-task.",
        },
      },
      required: ["prompt"],
    },
  },
  summarize: (args) => `subagent: ${String(args.prompt ?? "").slice(0, 60)}`,
  async run(args, ctx) {
    if (!ctx.subagent) {
      return { ok: false, output: "A sub-agent cannot itself spawn sub-agents." };
    }
    try {
      const result = await ctx.subagent(reqString(args, "prompt"));
      return { ok: true, output: clamp(result, 12_000) };
    } catch (e) {
      return { ok: false, output: `Sub-agent failed: ${(e as Error).message}` };
    }
  },
};
