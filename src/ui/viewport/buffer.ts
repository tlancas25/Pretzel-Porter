// Framework-free message buffer for the scrollable viewport.
//
// Owns: the list of conversation items, the scroll offset (rows from bottom),
// and the "new since you scrolled back" counter that drives the "↓ N new"
// indicator. Does not own: wrapping, rendering, measuring — those are the
// component's job, because they depend on the live viewport width.
//
// The buffer is mutable. Components subscribe via the surrounding store/event
// system and re-render on change. Kept dumb and unit-testable.

export interface BufferItem {
  id: number;
  /** Conversation kind. Components map this to a styled block. */
  kind: string;
  /** Raw text. Styling and wrapping happen at render time. */
  text: string;
  /** Open slot for component-specific metadata (tool args, timing, etc.). */
  meta?: Record<string, unknown>;
}

export class ViewportBuffer {
  private _items: BufferItem[] = [];
  private nextId = 1;
  /** Rows scrolled up from the bottom. 0 means "stuck to the latest message". */
  private _offset = 0;
  /** Items appended since the user scrolled away from the bottom. */
  private _newSinceScroll = 0;
  private readonly _cap: number;

  constructor(cap = 1000) {
    this._cap = cap;
  }

  get items(): readonly BufferItem[] {
    return this._items;
  }

  get offset(): number {
    return this._offset;
  }

  /** Count of items added since the user last scrolled away from the bottom. */
  get newSinceScroll(): number {
    return this._newSinceScroll;
  }

  /** True when the latest item is visible — the auto-follow state. */
  get stuckBottom(): boolean {
    return this._offset === 0;
  }

  append(kind: string, text: string, meta?: Record<string, unknown>): BufferItem {
    const item: BufferItem = { id: this.nextId++, kind, text, meta };
    this._items.push(item);
    // Trim from the front when the buffer is over its cap. The cap exists so
    // a very long session doesn't grow memory unbounded; default 1000 items
    // is generous (a multi-hour session typically lands well under that).
    if (this._items.length > this._cap) {
      this._items.splice(0, this._items.length - this._cap);
    }
    if (this._offset > 0) this._newSinceScroll += 1;
    return item;
  }

  /**
   * Replace the text of an existing item — used while streaming tokens into
   * a single growing message. Component should re-render on the next tick.
   */
  update(id: number, text: string): void {
    const item = this._items.find((it) => it.id === id);
    if (item) item.text = text;
  }

  /**
   * Scroll by `rows` (positive = up / older, negative = down / newer). Clamped
   * to 0 at the bottom; the maximum is the component's responsibility because
   * it depends on wrapped row totals at the current viewport width.
   */
  scrollBy(rows: number): void {
    this._offset = Math.max(0, this._offset + rows);
    if (this._offset === 0) this._newSinceScroll = 0;
  }

  scrollToBottom(): void {
    this._offset = 0;
    this._newSinceScroll = 0;
  }

  /** Clamp the offset against a known maximum (called by the component after layout). */
  clampOffset(maxOffset: number): void {
    if (this._offset > maxOffset) this._offset = maxOffset;
  }

  clear(): void {
    this._items = [];
    this._offset = 0;
    this._newSinceScroll = 0;
  }
}

/**
 * Pure helper: pick the slice of items that fits in `viewportHeight` rows
 * given a `measure` function that returns the wrapped row-count for an item.
 *
 * Returns the items in display order (top → bottom), how many rows of the top
 * item to skip (so partial top-item display works when an item is taller than
 * the remaining space), and the total rows above the visible region (for the
 * scroll-position indicator).
 *
 * Pulled out of the buffer class so it stays trivially testable.
 */
export interface VisibleSlice {
  items: BufferItem[];
  /** Rows of the topmost item to drop from the top (when it overflows upward). */
  topRowSkip: number;
  /** Total rows above the visible window (for a scrollbar/indicator). */
  rowsAbove: number;
  /** `offset` echoed back for convenience. */
  rowsBelow: number;
}

export function computeVisibleSlice(
  items: readonly BufferItem[],
  measure: (item: BufferItem) => number,
  viewportHeight: number,
  offset: number,
): VisibleSlice {
  // Walk from the newest backward. First, burn `offset` rows from the bottom
  // (those are scrolled out of view below). Then collect items until we've
  // filled `viewportHeight` rows.
  let bottomBurn = offset;
  let rowsAccumulated = 0;
  let topRowSkip = 0;
  const picked: BufferItem[] = [];

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const rows = measure(item);

    if (bottomBurn >= rows) {
      bottomBurn -= rows;
      continue;
    }
    // Whatever's left of this item after burning the bottom-skip is what we
    // can actually show.
    const visibleHere = rows - bottomBurn;
    bottomBurn = 0;

    if (rowsAccumulated + visibleHere >= viewportHeight) {
      // This item fills (or overflows) the remaining space. Show only the
      // bottom rows; track how many to skip from the top.
      topRowSkip = rowsAccumulated + visibleHere - viewportHeight;
      picked.unshift(item);
      rowsAccumulated = viewportHeight;
      break;
    }
    picked.unshift(item);
    rowsAccumulated += visibleHere;
  }

  // rowsAbove: rows above the topmost picked item + rows skipped within it.
  let rowsAbove = topRowSkip;
  const topIdx = picked.length === 0 ? items.length : items.indexOf(picked[0]!);
  for (let i = 0; i < topIdx; i++) rowsAbove += measure(items[i]!);

  return { items: picked, topRowSkip, rowsAbove, rowsBelow: offset };
}
