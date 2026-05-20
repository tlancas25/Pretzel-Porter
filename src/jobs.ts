import { spawn, type ChildProcess } from "node:child_process";

// Background jobs: long-running shell commands that keep running while the
// REPL stays responsive. Output is captured into a ring buffer so it can be
// inspected later. Jobs live only for the session.

const MAX_OUTPUT = 200_000;

export interface Job {
  id: string;
  command: string;
  status: "running" | "done" | "failed";
  exitCode: number | null;
  output: string;
  startedAt: number;
}

interface LiveJob extends Job {
  proc: ChildProcess;
}

const jobs = new Map<string, LiveJob>();
let counter = 0;

/** Spawn a command in the background and return its job record. */
export function startJob(command: string, cwd: string): Job {
  const id = `job${++counter}`;
  const proc = spawn(command, { cwd, shell: true, windowsHide: true });
  const job: LiveJob = {
    id,
    command,
    status: "running",
    exitCode: null,
    output: "",
    startedAt: Date.now(),
    proc,
  };

  const append = (chunk: Buffer): void => {
    job.output += chunk.toString("utf8");
    if (job.output.length > MAX_OUTPUT) job.output = job.output.slice(-MAX_OUTPUT);
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  proc.on("error", (e) => {
    job.status = "failed";
    job.output += `\n[spawn error: ${e.message}]`;
  });
  proc.on("exit", (code) => {
    job.exitCode = code;
    job.status = code === 0 ? "done" : "failed";
  });

  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()];
}

/** Kill a still-running job. Returns true if it was running. */
export function killJob(id: string): boolean {
  const job = jobs.get(id);
  if (job && job.status === "running") {
    job.proc.kill();
    return true;
  }
  return false;
}

/** Kill every running job — used on shutdown. */
export function killAllJobs(): void {
  for (const job of jobs.values()) {
    if (job.status === "running") job.proc.kill();
  }
}
