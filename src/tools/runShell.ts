import { exec } from "node:child_process";
import type { Tool } from "../types.js";
import { reqString, optString, optNumber, clamp } from "./util.js";

/** Hard ceiling on a single run_shell call — 30 minutes. */
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

export const runShellTool: Tool = {
  risk: "shell",
  schema: {
    name: "run_shell",
    description:
      "Run a shell command. The working directory is restricted to the " +
      "sandbox. Reaches the system's installed tools — including the Kali " +
      "security toolkit (nmap, gobuster, nikto, sqlmap, etc.). A scan or fuzz " +
      "can take minutes: pass a generous `timeout` for those, or use " +
      "run_background for very long jobs. Every call requires explicit user " +
      "approval unless auto-approve is on.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        cwd: {
          type: "string",
          description: "Working directory inside the sandbox. Defaults to the sandbox root.",
        },
        timeout: {
          type: "number",
          description:
            "Seconds to allow before the command is killed. Defaults to the " +
            "configured shell timeout. Raise it for slow commands — e.g. 600 " +
            "for a network scan. Capped at 1800 (30 min).",
        },
      },
      required: ["command"],
    },
  },
  summarize: (args) => `run: ${args.command}`,
  async run(args, ctx) {
    const command = reqString(args, "command");
    // Resolve (and sandbox-check) the cwd; default to the primary root.
    let cwd: string;
    try {
      cwd = ctx.permissions.resolveWithin(optString(args, "cwd", ctx.cwd));
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }

    // A per-call timeout (seconds) overrides the configured default.
    const requested = optNumber(args, "timeout", 0);
    const timeoutMs =
      requested > 0 ? Math.min(requested * 1000, MAX_TIMEOUT_MS) : ctx.shellTimeoutMs;

    return await new Promise((resolve) => {
      exec(
        command,
        { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const out = clamp(String(stdout ?? ""), 12000);
          const errOut = clamp(String(stderr ?? ""), 6000);
          const parts: string[] = [];
          if (out.trim()) parts.push(`stdout:\n${out}`);
          if (errOut.trim()) parts.push(`stderr:\n${errOut}`);

          if (err) {
            const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
            const reason = killed
              ? `command timed out after ${Math.round(timeoutMs / 1000)}s`
              : `exited with code ${err.code ?? "unknown"}`;
            parts.unshift(`Command failed (${reason}).`);
            if (killed) {
              parts.push(
                "If the command simply needs longer, call run_shell again with a " +
                  "larger `timeout` (in seconds), or use run_background for a " +
                  "long-running job and poll job_status.",
              );
            }
            return resolve({ ok: false, output: parts.join("\n\n") });
          }
          parts.unshift("Command succeeded.");
          return resolve({ ok: true, output: parts.join("\n\n") });
        },
      );
    });
  },
};
