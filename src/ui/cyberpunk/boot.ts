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

const BANNER = [
  "  ██████╗ ██████╗  ██████╗ ██████╗ ████████╗",
  "  ██╔══██╗██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝",
  "  ██████╔╝██████╔╝██║   ██║██████╔╝   ██║   ",
  "  ██╔═══╝ ██╔═══╝ ██║   ██║██╔══██╗   ██║   ",
  "  ██║     ██║     ╚██████╔╝██║  ██║   ██║   ",
  "  ╚═╝     ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ",
];

export async function runBootSequence(opts: { version: string; quick?: boolean }): Promise<void> {
  if (!process.stdout.isTTY) return; // skip in piped mode
  if (opts.quick) return;
  process.stdout.write("\n");
  for (const ln of BANNER) {
    process.stdout.write(ansi(ln, COL.accent.primary) + "\n");
  }
  process.stdout.write("\n");
  await typeLine(
    `  > pretzel.porter ${opts.version} :: cyberpunk-tui experimental`,
    COL.accent.secondary,
  );
  await typeLine("  > booting...", COL.text.dim, 10);
  await sleep(60);
  await typeLine("  > terminal: " + (process.env.TERM_PROGRAM ?? "unknown"), COL.text.dim, 3);
  await typeLine("  > truecolor: ok", COL.status.ok, 3);
  await typeLine("  > raw mode: armed", COL.status.ok, 3);
  await typeLine("  > engaging hyper-stack...", COL.accent.primary, 8);
  await sleep(120);
  process.stdout.write("\n");
}
