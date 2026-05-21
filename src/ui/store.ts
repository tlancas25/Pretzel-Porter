// src/ui/store.ts — external state for the Ink UI.
//
// The agent writes here (addUser, tool calls, streaming deltas, …); the React
// tree subscribes via useSyncExternalStore and re-renders. Keeping UI state
// outside React lets the existing agent loop drive it without becoming React.

export interface StatusInfo {
  model: string;
  backend: string;
  cwd: string;
  ctxPct: number;
  modes: string[];
}

export type ConvItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "thinking"; text: string }
  | { id: number; kind: "info"; text: string }
  | { id: number; kind: "error"; text: string }
  | { id: number; kind: "timing"; text: string }
  | { id: number; kind: "diff"; text: string }
  | { id: number; kind: "tool"; name: string; summary: string; ok: boolean | null; preview: string };

class UiStore {
  items: ConvItem[] = [];
  status: StatusInfo = { model: "", backend: "local", cwd: "", ctxPct: 0, modes: [] };
  streamThinking = "";
  streamContent = "";
  version = 0;

  private listeners = new Set<() => void>();
  private nextId = 1;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private push(item: ConvItem): void {
    this.items.push(item);
    this.bump();
  }

  setStatus(s: StatusInfo): void {
    this.status = s;
    this.bump();
  }

  user(text: string): void {
    this.push({ id: this.nextId++, kind: "user", text });
  }
  assistant(text: string): void {
    this.push({ id: this.nextId++, kind: "assistant", text });
  }
  info(text: string): void {
    this.push({ id: this.nextId++, kind: "info", text });
  }
  error(text: string): void {
    this.push({ id: this.nextId++, kind: "error", text });
  }
  diff(text: string): void {
    this.push({ id: this.nextId++, kind: "diff", text });
  }
  timing(seconds: number): void {
    const t = seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
    this.push({ id: this.nextId++, kind: "timing", text: `done in ${t}` });
  }

  // ── Streaming assistant message ──────────────────────────────────────
  streamThinkingDelta(d: string): void {
    this.streamThinking += d;
    this.bump();
  }
  streamContentDelta(d: string): void {
    this.streamContent += d;
    this.bump();
  }
  /** Move the in-progress stream into the permanent conversation log. */
  commitStream(): void {
    if (this.streamThinking.trim()) {
      this.items.push({ id: this.nextId++, kind: "thinking", text: this.streamThinking.trim() });
    }
    if (this.streamContent.trim()) {
      this.items.push({ id: this.nextId++, kind: "assistant", text: this.streamContent.trim() });
    }
    this.streamThinking = "";
    this.streamContent = "";
    this.bump();
  }

  // ── Tool calls ───────────────────────────────────────────────────────
  /** Record a tool call (status pending). Returns its id for the result. */
  toolCall(name: string, summary: string): number {
    const id = this.nextId++;
    this.push({ id, kind: "tool", name, summary, ok: null, preview: "" });
    return id;
  }
  toolResult(id: number, ok: boolean, preview: string): void {
    const it = this.items.find((x) => x.id === id);
    if (it && it.kind === "tool") {
      it.ok = ok;
      it.preview = preview;
    }
    this.bump();
  }
}

/** The single UI store instance shared by the app and the agent. */
export const ui = new UiStore();
