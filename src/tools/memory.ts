import type { Tool } from "../types.js";
import { reqString, optNumber, clamp } from "./util.js";
import { remember, recall } from "../memory.js";

// remember / recall touch only the agent's own memory store under
// ~/.pretzel-porter/memory — never the user's files — so they carry the
// "read" risk tier and do not trigger a write confirmation.

export const rememberTool: Tool = {
  risk: "read",
  schema: {
    name: "remember",
    description:
      "Save a durable note to long-term memory so it is available in future " +
      "sessions. Use for stable, useful facts (how the user's files are " +
      "organised, a preference they stated). Never store secrets or passwords.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The note to remember." } },
      required: ["text"],
    },
  },
  summarize: (args) => `remember: ${String(args.text ?? "").slice(0, 60)}`,
  async run(args) {
    const note = remember(reqString(args, "text"));
    return { ok: true, output: `Saved to long-term memory (id ${note.id}).` };
  },
};

export const recallTool: Tool = {
  risk: "read",
  schema: {
    name: "recall",
    description:
      "Search long-term memory for notes saved in past sessions. Returns the " +
      "most relevant notes for the query; an empty query returns recent notes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for." },
        limit: { type: "number", description: "Max notes to return (default 8)." },
      },
    },
  },
  summarize: (args) => `recall: ${args.query || "(recent)"}`,
  async run(args) {
    const query = typeof args.query === "string" ? args.query : "";
    const limit = Math.max(1, Math.min(20, Math.round(optNumber(args, "limit", 8))));
    const notes = recall(query, limit);
    if (notes.length === 0) return { ok: true, output: "No matching notes in memory." };
    const body = notes.map((n) => `[${n.ts.slice(0, 10)}] ${n.text}`).join("\n");
    return { ok: true, output: clamp(body, 8_000) };
  },
};
