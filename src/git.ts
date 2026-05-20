import { execFile } from "node:child_process";

// Thin git helpers. git is invoked via execFile (no shell) so a path or
// message can never be reinterpreted as a command. Used for /diff, /commit,
// and the optional per-change auto-commit — turning git into the audit trail.

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          code: err ? ((err as { code?: number }).code ?? 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

/** True when `cwd` is inside a git working tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  return r.code === 0 && r.stdout.trim() === "true";
}

/** The working-tree diff (or the staged diff when `staged` is true). */
export async function gitDiff(cwd: string, staged = false): Promise<string> {
  const r = await git(staged ? ["diff", "--cached"] : ["diff"], cwd);
  return r.stdout.trimEnd();
}

/** Short porcelain status — one line per changed path. */
export async function gitStatusShort(cwd: string): Promise<string> {
  const r = await git(["status", "--short"], cwd);
  return r.stdout.trimEnd();
}

/** Stage everything and commit. Returns ok plus a short message. */
export async function gitCommitAll(
  cwd: string,
  message: string,
): Promise<{ ok: boolean; output: string }> {
  const add = await git(["add", "-A"], cwd);
  if (add.code !== 0) {
    return { ok: false, output: add.stderr.trim() || "git add failed" };
  }
  const commit = await git(["commit", "-m", message], cwd);
  if (commit.code !== 0) {
    return { ok: false, output: (commit.stdout + commit.stderr).trim() || "git commit failed" };
  }
  return { ok: true, output: commit.stdout.trim() };
}
