import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// portmem.md — the agent's working memory for a directory. One short entry is
// appended per turn (mechanically, no model call), and on startup the recent
// tail is loaded back into context so a reconnected session continues where it
// left off. It is plain markdown in the working directory, so Claude Code (or
// the operator) can read it as a hand-off trail of what pport did.

const FILENAME = "portmem.md";

const HEADER = `# Pretzel Porter — working memory

<!-- Auto-maintained by pport: one entry per turn. pport reloads the recent
     tail of this file on startup to continue where it left off, and Claude
     Code can read it to see what pport did. Safe to trim or delete. -->
`;

/** Absolute path of the working-memory file for a directory. */
export function portMemPath(cwd: string): string {
  return join(cwd, FILENAME);
}

/**
 * The recent tail of portmem.md, for loading into context. Capped so a long
 * history never floods the window. Returns "" when the file does not exist.
 */
export function loadPortMem(cwd: string, maxChars = 8_000): string {
  const path = portMemPath(cwd);
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text.length <= maxChars) return text;
    return "…(earlier entries trimmed)\n" + text.slice(text.length - maxChars);
  } catch {
    return "";
  }
}

/** The full working-memory file, for the /portmem command. */
export function readPortMem(cwd: string): string {
  const path = portMemPath(cwd);
  try {
    return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  } catch {
    return "";
  }
}

export interface PortMemEntry {
  request: string;
  tools: string[];
  outcome: string;
}

/** Append one turn's entry to portmem.md, creating the file if needed. */
export function appendPortMem(cwd: string, entry: PortMemEntry): void {
  const path = portMemPath(cwd);
  try {
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    const block =
      `\n## ${ts}\n` +
      `**Request:** ${condense(entry.request, 240)}\n` +
      `**Tools:** ${tallyTools(entry.tools)}\n` +
      `**Outcome:** ${condense(entry.outcome, 400)}\n`;
    appendFileSync(path, (existsSync(path) ? "" : HEADER) + block, "utf8");
  } catch {
    // working memory is best-effort — never break a turn over it
  }
}

/** Collapse whitespace and clamp a string to one readable line. */
function condense(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "(none)";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** "edit_file ×2, run_shell" — a compact tally of the tools used. */
function tallyTools(tools: string[]): string {
  if (tools.length === 0) return "(none)";
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
}
