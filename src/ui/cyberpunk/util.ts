// Small helpers shared across cyberpunk components. Kept here so each
// component file stays focused on its own layout.

import { theme } from "../theme/tokens.js";

/** Quantize a 0..1 value to a Block Elements sparkline index (0..7). */
export function sparkIndex(v: number): number {
  if (Number.isNaN(v) || v < 0) return 0;
  if (v >= 1) return theme.glyph.spark.length - 1;
  return Math.min(theme.glyph.spark.length - 1, Math.floor(v * theme.glyph.spark.length));
}

/** Render a 0..1 value as a Sparkline glyph. */
export function sparkGlyph(v: number): string {
  return theme.glyph.spark[sparkIndex(v)]!;
}

/**
 * Sub-cell-precision horizontal bar. `frac` is 0..1, `cols` is the cell width.
 * Returns a string like "█████▍   " for a partial-cell fill.
 */
export function barString(frac: number, cols: number): string {
  if (frac <= 0) return theme.glyph.bar.empty.repeat(cols);
  if (frac >= 1) return theme.glyph.bar.full.repeat(cols);
  const full = Math.floor(frac * cols);
  const remainder = frac * cols - full;
  const partial = theme.glyph.bar.partial[Math.floor(remainder * 8)] ?? "";
  const emptyCount = Math.max(0, cols - full - (partial ? 1 : 0));
  return (
    theme.glyph.bar.full.repeat(full) +
    partial +
    theme.glyph.bar.empty.repeat(emptyCount)
  );
}

/** A simple ring buffer of fixed length — used for sparkline data series. */
export class RingSeries {
  private buf: number[];
  private head = 0;
  private filled = 0;
  constructor(public readonly capacity: number) {
    this.buf = new Array(capacity).fill(0);
  }
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }
  /** Values in oldest → newest order. Length is the filled count. */
  values(): number[] {
    if (this.filled < this.capacity) return this.buf.slice(0, this.filled);
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }
  get length(): number {
    return this.filled;
  }
}
