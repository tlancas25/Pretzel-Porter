// Small helpers shared by tools — argument coercion and output bounding.

export function reqString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing required string argument "${key}"`);
  }
  return v;
}

export function optString(args: Record<string, unknown>, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

export function optBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  return typeof v === "boolean" ? v : fallback;
}

export function optNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Clamp text fed back to the model so one tool call cannot blow the context. */
export function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return text.slice(0, maxChars) + `\n… [${omitted} more characters truncated]`;
}

/** Cheap binary-file sniff: a NUL byte in the first chunk. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Word-overlap similarity of two strings, 0..1. */
function lineSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = new Set(a.split(/\s+/).filter(Boolean));
  const bt = new Set(b.split(/\s+/).filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let common = 0;
  for (const t of at) if (bt.has(t)) common++;
  return common / Math.max(at.size, bt.size);
}

/**
 * When an edit's old_string is not found, locate the region of the file most
 * similar to it and return a numbered snippet. Lets a weak model see the real
 * text — and spot its own typo — instead of retrying a hallucinated string.
 */
export function nearestMatch(text: string, oldStr: string): string {
  const fileLines = text.split("\n");
  const probe = (oldStr.split("\n").find((l) => l.trim()) ?? "").trim();
  if (!probe) return "";
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < fileLines.length; i++) {
    const score = lineSimilarity(probe, fileLines[i]!.trim());
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestScore < 0.4) return "";
  const from = Math.max(0, bestIdx - 3);
  const to = Math.min(fileLines.length, bestIdx + 5);
  return fileLines
    .slice(from, to)
    .map((l, k) => `  ${from + k + 1}| ${l}`)
    .join("\n");
}
