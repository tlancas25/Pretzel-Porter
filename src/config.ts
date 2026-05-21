import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { AgentConfig, Risk } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Project root = parent of src/ (or of dist/ once built/installed). */
export const PROJECT_ROOT = resolve(HERE, "..");
/** Per-user config + state directory. */
export const USER_DIR = join(homedir(), ".pretzel-porter");

const DEFAULTS: AgentConfig = {
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "huihui_ai/gemma-4-abliterated:e2b",
  plannerModel: "",
  autoCommit: false,
  temperature: 0.7,
  numCtx: 16384,
  sampling: {
    topP: 0.9,
    topK: 40,
    minP: 0.05,
    repeatPenalty: 1.3,
    repeatLastN: 256,
  },
  think: true,
  maxSteps: 25,
  shellTimeoutMs: 120000,
  maxReadBytes: 200000,
  requestTimeoutMs: 300000,
  allowedPaths: [],
  readOnlyPaths: [],
  autoApprove: { read: true, write: false, shell: false },
  permissionRules: [],
  airgap: false,
  auditLog: false,
  theme: "default",
  hideThinking: false,
  portMem: false,
  mcpServers: {},
  hooks: {},
  rag: { enabled: true, command: "rag", defaultK: 5 },
  ssh: {
    enabled: false,
    mode: "direct",
    host: "",
    user: "",
    port: 22,
    identityFile: "",
    gcloud: { instance: "", zone: "", project: "", iap: false },
    remotePort: 11434,
    localPort: 11435,
  },
};

function fail(msg: string): never {
  throw new Error(`config: ${msg}`);
}

/**
 * Load and merge configuration. Sources are applied in order, each
 * overriding the last:
 *   1. built-in DEFAULTS
 *   2. <project>/agent.config.json        (shipped defaults)
 *   3. <project>/agent.config.local.json  (gitignored)
 *   4. ~/.pretzel-porter/agent.config.json        (per-user, for installs)
 *   5. ~/.pretzel-porter/agent.config.local.json  (per-user secrets)
 * The per-user files let an installed copy be configured without sudo.
 */
export function loadConfig(): AgentConfig {
  let merged: Record<string, unknown> = { ...DEFAULTS };

  const sources = [
    resolve(PROJECT_ROOT, "agent.config.json"),
    resolve(PROJECT_ROOT, "agent.config.local.json"),
    join(USER_DIR, "agent.config.json"),
    join(USER_DIR, "agent.config.local.json"),
  ];
  for (const path of sources) {
    if (!existsSync(path)) continue;
    const name = path;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      fail(`${name} is not valid JSON — ${(e as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null) fail(`${name} must be a JSON object`);
    merged = { ...merged, ...(parsed as Record<string, unknown>) };
    // Nested objects need an explicit deep merge so partial overrides work.
    if ((parsed as any).autoApprove) {
      merged.autoApprove = { ...DEFAULTS.autoApprove, ...(parsed as any).autoApprove };
    }
    if ((parsed as any).sampling) {
      merged.sampling = { ...DEFAULTS.sampling, ...(parsed as any).sampling };
    }
    if ((parsed as any).rag) {
      merged.rag = { ...DEFAULTS.rag, ...(parsed as any).rag };
    }
    if ((parsed as any).ssh) {
      merged.ssh = { ...DEFAULTS.ssh, ...(parsed as any).ssh };
      if ((parsed as any).ssh.gcloud) {
        (merged.ssh as any).gcloud = { ...DEFAULTS.ssh.gcloud, ...(parsed as any).ssh.gcloud };
      }
    }
  }

  const cfg = merged as unknown as AgentConfig;

  // Validate the fields most likely to be set wrong.
  if (cfg.provider !== "ollama") fail(`unsupported provider "${cfg.provider}" (only "ollama" so far)`);
  if (typeof cfg.baseUrl !== "string" || !/^https?:\/\//.test(cfg.baseUrl)) {
    fail("baseUrl must be an http(s) URL");
  }
  if (typeof cfg.model !== "string" || !cfg.model) fail("model must be a non-empty string");
  if (typeof cfg.plannerModel !== "string") fail("plannerModel must be a string");
  if (typeof cfg.autoCommit !== "boolean") fail("autoCommit must be true/false");
  if (typeof cfg.sampling !== "object" || cfg.sampling === null) fail("sampling must be an object");
  if (!Array.isArray(cfg.allowedPaths)) fail("allowedPaths must be an array");
  if (!Array.isArray(cfg.readOnlyPaths)) fail("readOnlyPaths must be an array");
  if (typeof cfg.airgap !== "boolean") fail("airgap must be true/false");
  if (typeof cfg.auditLog !== "boolean") fail("auditLog must be true/false");
  if (typeof cfg.hideThinking !== "boolean") fail("hideThinking must be true/false");
  if (typeof cfg.portMem !== "boolean") fail("portMem must be true/false");
  if (typeof cfg.theme !== "string") fail("theme must be a string");
  if (!Array.isArray(cfg.permissionRules)) fail("permissionRules must be an array");
  if (typeof cfg.mcpServers !== "object" || cfg.mcpServers === null) {
    fail("mcpServers must be an object");
  }
  if (typeof cfg.hooks !== "object" || cfg.hooks === null) fail("hooks must be an object");
  for (const tier of ["read", "write", "shell"] as Risk[]) {
    if (typeof cfg.autoApprove[tier] !== "boolean") fail(`autoApprove.${tier} must be true/false`);
  }
  if (typeof cfg.rag.enabled !== "boolean") fail("rag.enabled must be true/false");
  if (typeof cfg.rag.command !== "string" || !cfg.rag.command) fail("rag.command must be a non-empty string");
  if (typeof cfg.ssh.enabled !== "boolean") fail("ssh.enabled must be true/false");
  if (cfg.ssh.mode !== "direct" && cfg.ssh.mode !== "gcloud") {
    fail(`ssh.mode must be "direct" or "gcloud"`);
  }
  if (cfg.ssh.enabled) {
    if (cfg.ssh.mode === "gcloud") {
      const g = cfg.ssh.gcloud;
      if (!g.instance || !g.zone || !g.project) {
        fail("ssh.enabled with mode 'gcloud' needs ssh.gcloud.instance, .zone and .project");
      }
    } else if (!cfg.ssh.host || !cfg.ssh.user) {
      fail("ssh.enabled with mode 'direct' needs ssh.host and ssh.user");
    }
  }
  cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  return cfg;
}
