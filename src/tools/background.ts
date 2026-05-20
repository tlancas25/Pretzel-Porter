import type { Tool } from "../types.js";
import { reqString, optString, clamp } from "./util.js";
import { startJob, getJob, listJobs } from "../jobs.js";

// run_background starts a long-running shell command without blocking the
// agent loop; job_status inspects what it has produced so far.

export const runBackgroundTool: Tool = {
  risk: "shell",
  schema: {
    name: "run_background",
    description:
      "Start a long-running shell command in the background and return a job " +
      "id immediately, without waiting for it to finish. Use job_status to " +
      "check on it. For commands that finish quickly, use run_shell instead.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run." },
        cwd: { type: "string", description: "Working directory inside the sandbox." },
      },
      required: ["command"],
    },
  },
  summarize: (args) => `background: ${args.command}`,
  async run(args, ctx) {
    const command = reqString(args, "command");
    let cwd: string;
    try {
      cwd = ctx.permissions.resolveWithin(optString(args, "cwd", ctx.cwd));
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
    const job = startJob(command, cwd);
    return { ok: true, output: `Started ${job.id} — use job_status to check on it.` };
  },
};

export const jobStatusTool: Tool = {
  risk: "read",
  schema: {
    name: "job_status",
    description:
      "Check background jobs started with run_background. With a job id, " +
      "returns that job's status and captured output; with no id, lists all " +
      "jobs.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Job id, e.g. job1. Omit to list all." } },
    },
  },
  summarize: (args) => (args.id ? `job status ${args.id}` : "list background jobs"),
  async run(args) {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) {
      const jobs = listJobs();
      if (jobs.length === 0) return { ok: true, output: "No background jobs." };
      return {
        ok: true,
        output: jobs.map((j) => `${j.id}  [${j.status}]  ${j.command}`).join("\n"),
      };
    }
    const job = getJob(id);
    if (!job) return { ok: false, output: `No job with id "${id}".` };
    const head = `${job.id} [${job.status}${job.exitCode !== null ? ` exit ${job.exitCode}` : ""}]  ${job.command}`;
    const out = job.output.trim() || "(no output yet)";
    return { ok: true, output: `${head}\n\n${clamp(out, 12_000)}` };
  },
};
