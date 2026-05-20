import { exec } from "node:child_process";
import type { HookEvent, HookSpec } from "./types.js";

// Lifecycle hooks: shell commands the operator wires to defined points in a
// turn — auto-format after a write, run a guardrail before a tool, log every
// prompt. The hook payload is delivered as JSON on stdin. For the blocking
// events (UserPromptSubmit, PreToolUse) a non-zero exit cancels the action.

export interface HookOutcome {
  /** True when a blocking hook vetoed the action. */
  blocked: boolean;
  /** Combined stdout/stderr of hooks that produced output. */
  output: string[];
}

const HOOK_TIMEOUT_MS = 30_000;

/**
 * Run every hook configured for `event`. For PreToolUse / PostToolUse the
 * `matcher` regex is tested against `payload.tool`.
 */
export async function runHooks(
  event: HookEvent,
  specs: HookSpec[] | undefined,
  payload: Record<string, unknown>,
  cwd: string,
): Promise<HookOutcome> {
  const outcome: HookOutcome = { blocked: false, output: [] };
  if (!specs || specs.length === 0) return outcome;

  const toolName = typeof payload.tool === "string" ? payload.tool : "";
  const canBlock = event === "UserPromptSubmit" || event === "PreToolUse";

  for (const spec of specs) {
    if (!spec || typeof spec.command !== "string" || !spec.command) continue;
    if (spec.matcher && toolName) {
      try {
        if (!new RegExp(spec.matcher).test(toolName)) continue;
      } catch {
        // an invalid matcher regex never matches
        continue;
      }
    }

    const code = await new Promise<number>((resolve) => {
      const child = exec(
        spec.command,
        {
          cwd,
          timeout: HOOK_TIMEOUT_MS,
          windowsHide: true,
          env: { ...process.env, PRETZEL_HOOK_EVENT: event, PRETZEL_TOOL: toolName },
        },
        (err, stdout, stderr) => {
          const text = (String(stdout ?? "") + String(stderr ?? "")).trim();
          if (text) outcome.output.push(text);
          resolve(err ? ((err as { code?: number }).code ?? 1) : 0);
        },
      );
      // The hook may not read stdin; ignore the EPIPE that follows.
      child.stdin?.on("error", () => {});
      try {
        child.stdin?.end(JSON.stringify(payload));
      } catch {
        // the command may have closed stdin already
      }
    });

    if (code !== 0 && canBlock) {
      outcome.blocked = true;
      break;
    }
  }
  return outcome;
}
