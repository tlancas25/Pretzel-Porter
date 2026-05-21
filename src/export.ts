// src/export.ts — render a conversation to a Markdown report, for engagement
// write-ups. Tool results are collapsed so the report stays readable.

import type { Message } from "./types.js";

export interface ExportMeta {
  model: string;
  sandbox: string;
}

/** Compact one-line summary of a tool call's arguments. */
function argLine(args: Record<string, unknown>): string {
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.pattern === "string") return String(args.pattern);
  const s = JSON.stringify(args ?? {});
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

/** Render a conversation to a Markdown engagement report. */
export function sessionToMarkdown(messages: Message[], meta: ExportMeta): string {
  const out: string[] = [];
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  out.push(`# Pretzel Porter session — ${stamp}`, "");
  out.push(`- **Model:** ${meta.model}`);
  out.push(`- **Workspace:** ${meta.sandbox}`);
  out.push(`- **Turns recorded:** ${messages.filter((m) => m.role === "user").length}`);
  out.push("", "---", "");

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      // Drop the pinned-file / @mention preamble; keep the actual request.
      let text = m.content;
      const i = text.lastIndexOf("[User request]\n");
      if (i >= 0) text = text.slice(i + "[User request]\n".length);
      out.push("### ▸ Operator", "", text.trim() || "_(empty)_", "");
    } else if (m.role === "assistant") {
      if (m.content.trim()) out.push("### ● Agent", "", m.content.trim(), "");
      for (const tc of m.tool_calls ?? []) {
        out.push("`" + tc.name + "` — `" + argLine(tc.arguments) + "`", "");
      }
    } else if (m.role === "tool") {
      const body =
        m.content.length > 2000 ? m.content.slice(0, 2000) + "\n… (truncated)" : m.content;
      out.push(
        `<details><summary>↳ ${m.tool_name ?? "tool"} result</summary>`,
        "",
        "```",
        body,
        "```",
        "</details>",
        "",
      );
    }
  }
  return out.join("\n") + "\n";
}
