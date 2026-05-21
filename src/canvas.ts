// src/canvas.ts — terminal layout primitives for "the canvas".
//
// Side margins, ANSI-aware word-wrap, and the pinned bottom information bar.
// Zero-dependency: ANSI escape codes and Node builtins only. On a non-TTY
// (piped) run every function degrades to a no-op or to plain text.

const SGR = /\x1b\[[0-9;]*m/g;
const SGR_AT_START = /^\x1b\[[0-9;]*m/;

/** Left and right margin width, in columns. */
export const MARGIN = 2;
/** The left gutter applied to every printed line on a TTY. */
export const GUTTER = " ".repeat(MARGIN);

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

export function termCols(): number {
  const c = process.stdout.columns;
  return c && c > 0 ? c : 80;
}

export function termRows(): number {
  const r = process.stdout.rows;
  return r && r > 0 ? r : 24;
}

/** Usable text width inside the side margins. */
export function contentWidth(): number {
  return Math.max(24, termCols() - MARGIN * 2);
}

/** Visible length of a string, ignoring ANSI SGR colour codes. */
export function visibleWidth(s: string): number {
  return s.replace(SGR, "").length;
}

/**
 * Word-wrap one logical line to `width`, ANSI-aware: colour codes do not count
 * toward width, and the active colour is re-applied after each break so a
 * wrapped coloured line stays coloured and never bleeds.
 */
export function wrapLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];
  const out: string[] = [];
  let cur = "";
  let curWidth = 0;
  let sgr = ""; // currently-active colour, re-emitted at each break
  let lastSpace = -1; // index in `cur` of the last breakable space
  let i = 0;

  const flush = (upto: number, dropSpace: boolean): void => {
    const head = cur.slice(0, upto);
    const tail = cur.slice(dropSpace ? upto + 1 : upto);
    out.push(head + (sgr ? "\x1b[0m" : ""));
    cur = sgr + tail;
    curWidth = visibleWidth(tail);
    lastSpace = -1;
  };

  while (i < line.length) {
    const esc = line.slice(i).match(SGR_AT_START);
    if (esc) {
      const code = esc[0];
      cur += code;
      sgr = code === "\x1b[0m" ? "" : code;
      i += code.length;
      continue;
    }
    if (curWidth >= width) {
      if (lastSpace >= 0) flush(lastSpace, true);
      else flush(cur.length, false);
    }
    const ch = line[i]!;
    if (ch === " ") lastSpace = cur.length;
    cur += ch;
    curWidth++;
    i++;
  }
  if (visibleWidth(cur) > 0) out.push(cur + (sgr ? "\x1b[0m" : ""));
  return out;
}

/** Split a block into wrapped lines (no gutter applied). */
export function wrapBlock(text: string, width = contentWidth()): string[] {
  const out: string[] = [];
  for (const logical of text.split("\n")) {
    for (const wrapped of wrapLine(logical, width)) out.push(wrapped);
  }
  return out;
}

/**
 * Print a block of text inside the canvas: word-wrapped to the content width
 * and left-padded by the gutter. On a non-TTY it prints plain, unframed.
 */
export function printBlock(text: string): void {
  if (!isTTY()) {
    console.log(text);
    return;
  }
  for (const line of wrapBlock(text)) console.log(GUTTER + line);
}

// ── Streaming writer ────────────────────────────────────────────────────
// The model's response arrives token by token. This writer keeps the stream
// inside the gutter and soft-wraps it at the right margin, tracking the cursor
// column itself (ANSI codes don't advance it).

export interface GutterStream {
  write(chunk: string): void;
}

export function createGutterStream(): GutterStream {
  if (!isTTY()) {
    return { write: (chunk) => process.stdout.write(chunk) };
  }
  const width = contentWidth();
  let col = 0;
  let atLineStart = true;
  return {
    write(chunk: string): void {
      let i = 0;
      while (i < chunk.length) {
        const esc = chunk.slice(i).match(SGR_AT_START);
        if (esc) {
          process.stdout.write(esc[0]);
          i += esc[0].length;
          continue;
        }
        const ch = chunk[i]!;
        if (atLineStart) {
          process.stdout.write(GUTTER);
          atLineStart = false;
          col = 0;
        }
        if (ch === "\n") {
          process.stdout.write("\n");
          atLineStart = true;
          col = 0;
        } else {
          if (col >= width) {
            process.stdout.write("\n" + GUTTER);
            col = 0;
          }
          process.stdout.write(ch);
          col++;
        }
        i++;
      }
    },
  };
}

// ── Screen control ──────────────────────────────────────────────────────

/** Clear the screen and home the cursor — used once, at startup. */
export function clearScreen(): void {
  if (isTTY()) process.stdout.write("\x1b[2J\x1b[H");
}

/** Truncate a (possibly coloured) string to a visible width. */
export function clipWidth(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  let i = 0;
  while (i < s.length && w < width) {
    const esc = s.slice(i).match(SGR_AT_START);
    if (esc) {
      out += esc[0];
      i += esc[0].length;
      continue;
    }
    out += s[i];
    w++;
    i++;
  }
  return out + "\x1b[0m";
}
