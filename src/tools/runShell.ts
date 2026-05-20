import { exec } from "node:child_process";
import type { Tool } from "../types.js";
import { reqString, optString, clamp } from "./util.js";

export const runShellTool: Tool = {
  risk: "shell",
  schema: {
    name: "run_shell",
    description:
      "Run a shell command. The working directory is restricted to the " +
      "sandbox. Use for things like running a script or inspecting git. " +
      "Every call requires explicit user approval unless auto-approve is on.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        cwd: { type: "string", description: "Working directory inside the sandbox. Defaults to the sandbox root." },
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

    return await new Promise((resolve) => {
      exec(
        command,
        { cwd, timeout: ctx.shellTimeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const out = clamp(String(stdout ?? ""), 12000);
          const errOut = clamp(String(stderr ?? ""), 6000);
          const parts: string[] = [];
          if (out.trim()) parts.push(`stdout:\n${out}`);
          if (errOut.trim()) parts.push(`stderr:\n${errOut}`);

          if (err) {
            const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
            const reason = killed
              ? `command timed out after ${ctx.shellTimeoutMs}ms`
              : `exited with code ${err.code ?? "unknown"}`;
            parts.unshift(`Command failed (${reason}).`);
            return resolve({ ok: false, output: parts.join("\n\n") });
          }
          parts.unshift("Command succeeded.");
          return resolve({ ok: true, output: parts.join("\n\n") });
        },
      );
    });
  },
};
