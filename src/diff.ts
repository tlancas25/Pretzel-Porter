// A dependency-free line-based diff, used to preview file writes before the
// operator approves them. LCS backtrack → unified hunks with 3 lines context.

interface Op {
  tag: " " | "-" | "+";
  text: string;
}

/** Largest file (in lines) we will diff; beyond this the table is too big. */
const MAX_LINES = 2000;

/**
 * A unified-diff style summary of the change from `oldText` to `newText`.
 * Returns a plain string — colour it with `printDiff` in ui.ts.
 */
export function formatDiff(oldText: string, newText: string): string {
  if (oldText === newText) return "(no changes)";
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return `(file too large for a line diff — ${a.length} → ${b.length} lines)`;
  }
  return toUnified(lcsDiff(a, b));
}

/** Classic LCS dynamic-programming diff over arrays of lines. */
function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of the LCS of a[i..] and b[j..]; one Int32Array per row.
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ tag: "-", text: a[i]! });
      i++;
    } else {
      ops.push({ tag: "+", text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "-", text: a[i++]! });
  while (j < m) ops.push({ tag: "+", text: b[j++]! });
  return ops;
}

/** Group ops into hunks (3 lines of context) and render unified-diff text. */
function toUnified(ops: Op[]): string {
  const CONTEXT = 3;
  // Annotate each op with its 1-based line number on each side.
  let aLine = 1;
  let bLine = 1;
  const ann = ops.map((op) => {
    const e = { ...op, a: aLine, b: bLine };
    if (op.tag !== "+") aLine++;
    if (op.tag !== "-") bLine++;
    return e;
  });

  const changed: number[] = [];
  ann.forEach((x, i) => {
    if (x.tag !== " ") changed.push(i);
  });
  if (changed.length === 0) return "(no changes)";

  // Each change pulls in CONTEXT lines either side; merge overlapping ranges.
  const hunks: [number, number][] = [];
  for (const ci of changed) {
    const lo = Math.max(0, ci - CONTEXT);
    const hi = Math.min(ann.length - 1, ci + CONTEXT);
    const last = hunks[hunks.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else hunks.push([lo, hi]);
  }

  const lines: string[] = [];
  for (const [lo, hi] of hunks) {
    const slice = ann.slice(lo, hi + 1);
    const oldCount = slice.filter((x) => x.tag !== "+").length;
    const newCount = slice.filter((x) => x.tag !== "-").length;
    const oldStart = slice.find((x) => x.tag !== "+")?.a ?? 0;
    const newStart = slice.find((x) => x.tag !== "-")?.b ?? 0;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const x of slice) lines.push(x.tag + x.text);
  }
  return lines.join("\n");
}
