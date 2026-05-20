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
