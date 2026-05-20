import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import type { SshConfig } from "./types.js";

/**
 * Manages an SSH local-port-forward to a self-hosted Ollama, so Pretzel
 * Porter can use a remote LLM over an encrypted tunnel without exposing
 * Ollama's port publicly.
 *
 *   direct:  ssh -N -L <localPort>:localhost:<remotePort> user@host
 *   gcloud:  gcloud compute ssh <instance> ... -- -N -L <localPort>:...
 *
 * The gcloud mode is preferred for GCE VMs: it resolves the instance by
 * name (so a preemptible VM's changing external IP does not matter) and
 * manages SSH keys automatically.
 */
let proc: ChildProcess | null = null;

function buildCommand(cfg: SshConfig): { cmd: string; args: string[]; label: string } {
  const forward = ["-N", "-T", "-L", `${cfg.localPort}:localhost:${cfg.remotePort}`];
  const sshOpts = [
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ConnectTimeout=15",
  ];

  if (cfg.mode === "gcloud") {
    const g = cfg.gcloud;
    const args = [
      "compute", "ssh", g.instance,
      "--zone", g.zone,
      "--project", g.project,
      "--quiet", // never block on an interactive prompt
    ];
    if (g.iap) args.push("--tunnel-through-iap");
    // Everything after `--` is handed to the underlying ssh.
    args.push("--", ...sshOpts, ...forward);
    return { cmd: "gcloud", args, label: `gcloud → ${g.instance}` };
  }

  const args = [...sshOpts, ...forward];
  if (cfg.identityFile) args.push("-i", cfg.identityFile);
  if (cfg.port && cfg.port !== 22) args.push("-p", String(cfg.port));
  args.push(`${cfg.user}@${cfg.host}`);
  return { cmd: "ssh", args, label: `ssh → ${cfg.host}` };
}

/** Open the tunnel and resolve once the local port accepts connections. */
export async function openTunnel(cfg: SshConfig): Promise<string> {
  const { cmd, args } = buildCommand(cfg);
  proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });

  let stderr = "";
  proc.stderr?.on("data", (d) => {
    stderr += String(d);
  });

  const spawnError = new Promise<never>((_, reject) => {
    proc!.once("error", (e) =>
      reject(new Error(`Could not start ${cmd}: ${e.message}`)),
    );
    proc!.once("exit", (code) =>
      reject(
        new Error(
          `${cmd} tunnel exited early (code ${code}).\n${stderr.trim() || "no output"}`,
        ),
      ),
    );
  });

  // gcloud's first connect propagates SSH keys via instance metadata — slow.
  const timeoutMs = cfg.mode === "gcloud" ? 90000 : 25000;
  try {
    await Promise.race([waitForPort(cfg.localPort, timeoutMs), spawnError]);
  } catch (e) {
    closeTunnel();
    throw e;
  }
  return `http://localhost:${cfg.localPort}`;
}

/** Tear the tunnel down — safe to call even if nothing is open. */
export function closeTunnel(): void {
  if (proc && proc.exitCode === null) proc.kill();
  proc = null;
}

/** Poll a local TCP port until it accepts a connection or we time out. */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const sock = createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`SSH tunnel did not come up within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 400);
        }
      });
    };
    attempt();
  });
}
