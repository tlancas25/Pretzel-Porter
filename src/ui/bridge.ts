// src/ui/bridge.ts — the agent's output API, routed into the Ink store.
//
// agent.ts (and index.ts's command handlers) import these. Instead of writing
// to stdout they update `ui`, which the Ink app renders. This is what lets the
// existing imperative agent loop drive a declarative React UI unchanged.

import { ui } from "./store.js";

/** Colour helpers are identity now — the Ink components own all styling. */
const id = (s: string): string => s;
export const c = {
  bold: id,
  dim: id,
  italic: id,
  red: id,
  green: id,
  yellow: id,
  blue: id,
  magenta: id,
  cyan: id,
  gray: id,
};

export function printInfo(text: string): void {
  ui.info(text.replace(/\n+$/, ""));
}
export function printError(text: string): void {
  ui.error(text);
}
export function printDiff(diff: string): void {
  ui.diff(diff);
}
export function printTiming(seconds: number): void {
  ui.timing(seconds);
}

let lastToolId = 0;
export function printToolCall(name: string, summary: string): void {
  lastToolId = ui.toolCall(name, summary);
}
export function printToolResult(ok: boolean, preview: string): void {
  ui.toolResult(lastToolId, ok, preview);
}

export interface StreamRenderer {
  thinking(delta: string): void;
  content(delta: string): void;
  active(): boolean;
  end(): void;
}
export function createStreamRenderer(): StreamRenderer {
  let any = false;
  return {
    thinking(d) {
      any = true;
      ui.streamThinkingDelta(d);
    },
    content(d) {
      any = true;
      ui.streamContentDelta(d);
    },
    active() {
      return any;
    },
    end() {
      ui.commitStream();
    },
  };
}

/** A transient sub-status line (compaction, commit-message generation, …). */
export function startSpinner(label: string): void {
  ui.setNote(label);
}
export function stopSpinner(): void {
  ui.setNote("");
}

/** Tool-approval prompt — answered by the Ink confirm dialog. */
export function confirmToolUse(question: string): Promise<"yes" | "no" | "always"> {
  return ui.askConfirm(question);
}

/** A plain horizontal rule (the Ink components style their own). */
export function rule(): string {
  return "─".repeat(56);
}
