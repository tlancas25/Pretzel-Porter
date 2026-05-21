// src/repair.ts — make tool calls from weak local models survivable.
//
// Small local models routinely emit slightly-wrong tool calls: a name with the
// wrong case, a provider prefix (`functions.read_file`), special-token junk
// glued on, or arguments handed over as a JSON string instead of an object.
// Repairing these in-place avoids a wasted round-trip where the model has to
// notice an error and try again.

/**
 * Normalise a tool name for fuzzy matching — fold case, drop a `functions.` /
 * `tool:` style prefix, and strip every non-alphanumeric character (which
 * removes separators and any special-token contamination).
 */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(functions?|tools?)[.:]/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a possibly-malformed tool name to a known one. Returns the exact
 * name when it matches, the unique fuzzy match when there is exactly one, or
 * null when nothing matches (or the match is ambiguous).
 */
export function resolveToolName(raw: string, known: string[]): string | null {
  if (known.includes(raw)) return raw;
  const target = normalizeName(raw);
  if (!target) return null;
  const matches = known.filter((n) => normalizeName(n) === target);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Coerce malformed tool arguments into a plain object. Handles the common case
 * of a model emitting the argument object as a JSON-encoded string.
 */
export function repairArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string" && args.trim()) {
    try {
      const parsed: unknown = JSON.parse(args.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON — leave it; validateArgs will report the missing arguments
    }
  }
  return {};
}
