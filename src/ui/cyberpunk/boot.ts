// Typed-cadence boot sequence. Runs before Ink takes over the screen, so it
// uses raw stdout writes. The cadence is fast (5-20ms per char) so the lines
// land quickly but the typewriter effect is unmistakable.
//
// Lines are stable strings; they don't reflect real per-step timings (that
// would require restructuring index.ts). Future enhancement: pull actual
// timings from the setup phases and stamp them in.

import { theme } from "../theme/tokens.js";

const COL = theme.color;

function ansi(s: string, hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeLine(s: string, color: string = COL.accent.secondary, perChar = 6): Promise<void> {
  for (const ch of s) {
    process.stdout.write(ansi(ch, color));
    if (perChar > 0) await sleep(perChar);
  }
  process.stdout.write("\n");
}

// ANSI Shadow-style block font, 6 rows tall, per-letter columns vary. Each
// row of a letter is the same width so concatenating across letters keeps
// the baseline aligned. Only the letters we actually need.
const FONT: Record<string, string[]> = {
  P: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔═══╝ ",
    "██║     ",
    "╚═╝     ",
  ],
  R: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔══██╗",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  E: [
    "███████╗",
    "██╔════╝",
    "█████╗  ",
    "██╔══╝  ",
    "███████╗",
    "╚══════╝",
  ],
  T: [
    "████████╗",
    "╚══██╔══╝",
    "   ██║   ",
    "   ██║   ",
    "   ██║   ",
    "   ╚═╝   ",
  ],
  Z: [
    "███████╗",
    "╚══███╔╝",
    "  ██╔╝  ",
    " ██╔╝   ",
    "███████╗",
    "╚══════╝",
  ],
  L: [
    "██╗    ",
    "██║    ",
    "██║    ",
    "██║    ",
    "██████╗",
    "╚═════╝",
  ],
  O: [
    " ██████╗ ",
    "██╔═══██╗",
    "██║   ██║",
    "██║   ██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
};

/** Render a word in the block font as 6 rows. Caller pads the left margin. */
function bigText(word: string): string[] {
  const rows = 6;
  const out: string[] = [];
  const upper = word.toUpperCase();
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (const ch of upper) {
      const glyph = FONT[ch];
      line += (glyph ? glyph[r]! : "  ") + " ";
    }
    out.push(line);
  }
  return out;
}

export async function runBootSequence(opts: { version: string; quick?: boolean }): Promise<void> {
  if (!process.stdout.isTTY) return; // skip in piped mode
  if (opts.quick) return;
  process.stdout.write("\n");

  // Chunky stacked block-letter banner: "PRETZEL" on top, "PORTER" below.
  // Same ANSI Shadow font as the prior PPORT banner — full name spelled out.
  for (const ln of bigText("PRETZEL")) {
    process.stdout.write("  " + ansi(ln, COL.accent.primary) + "\n");
  }
  for (const ln of bigText("PORTER")) {
    process.stdout.write("  " + ansi(ln, COL.accent.primary) + "\n");
  }
  process.stdout.write(
    "  " + ansi(opts.version, COL.text.dim) + "  " +
    ansi("hyper-stack", COL.accent.secondary) + "\n\n",
  );

  await typeLine("  > booting...", COL.text.dim, 8);
  await sleep(50);
  await typeLine("  > terminal: " + (process.env.TERM_PROGRAM ?? "unknown"), COL.text.dim, 3);
  await typeLine("  > truecolor: ok", COL.status.ok, 3);
  await typeLine("  > raw mode: armed", COL.status.ok, 3);
  await typeLine("  > engaging hyper-stack...", COL.accent.primary, 8);
  await sleep(120);
  process.stdout.write("\n");
}
