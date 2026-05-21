// Shared types for the agent. Kept dependency-free so every module can import it.

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  /** Locally-generated id — Ollama's native API does not return one. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  /** Native reasoning trace, present on assistant turns from a "thinking" model. */
  thinking?: string;
  /** Present on assistant turns that call tools. */
  tool_calls?: ToolCall[];
  /** Present on `role: "tool"` turns — which tool produced this result. */
  tool_name?: string;
  /** Base64-encoded images attached to a user turn, for a vision model. */
  images?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  ok: boolean;
  /** Text fed back to the model. Keep it informative but bounded. */
  output: string;
}

/** Risk tier — drives whether a call needs user confirmation. */
export type Risk = "read" | "write" | "shell";

/** Narrow view of the permission layer that tools are allowed to use. */
export interface PermissionChecker {
  /**
   * Resolve a path and assert it is inside the sandbox, else throw.
   * Pass `forWrite` true for mutating tools — paths under a read-only
   * reference root are then rejected.
   */
  resolveWithin(inputPath: string, forWrite?: boolean): string;
  /** Absolute roots the agent is allowed to touch. */
  roots(): string[];
  /** Absolute roots the agent may read but never modify. */
  readOnlyRoots(): string[];
}

export interface ToolContext {
  permissions: PermissionChecker;
  /** Working directory for shell commands — the primary sandbox root. */
  cwd: string;
  shellTimeoutMs: number;
  maxReadBytes: number;
  /** Command name/path for the RAG retrieval CLI. */
  ragCommand: string;
  /** Default number of chunks to retrieve. */
  ragDefaultK: number;
  /** Spawn a scoped sub-agent for a focused task. Undefined inside a sub-agent. */
  subagent?: (prompt: string) => Promise<string>;
}

export interface Tool {
  schema: ToolSchema;
  risk: Risk;
  /** One-line human summary of a specific invocation, for the confirm prompt. */
  summarize(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  /**
   * Optional: a unified-diff preview of what this call will change, shown
   * before the confirmation prompt. Returns null when no preview applies.
   */
  preview?(args: Record<string, unknown>, ctx: ToolContext): Promise<string | null>;
  /**
   * Optional: the absolute sandbox path this call will mutate, so the agent
   * can snapshot it for /undo. Returns null when nothing can be resolved.
   */
  affectedPath?(args: Record<string, unknown>, ctx: ToolContext): string | null;
}

export interface AgentConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  /** Optional second model used for planning (plan mode). Empty = use `model`. */
  plannerModel: string;
  /** When true, each successful AI file change is committed to git automatically. */
  autoCommit: boolean;
  temperature: number;
  numCtx: number;
  think: boolean;
  maxSteps: number;
  shellTimeoutMs: number;
  maxReadBytes: number;
  /** Abort a single model request after this long, so a hung/slow model fails cleanly. */
  requestTimeoutMs: number;
  allowedPaths: string[];
  /** Paths the agent may read but never modify (docs, configs). */
  readOnlyPaths: string[];
  autoApprove: Record<Risk, boolean>;
  /** Wildcard allow/ask/deny rules, evaluated before the autoApprove tiers. */
  permissionRules: PermissionRuleConfig[];
  /** When true, every network-capable tool is disabled — a hard offline guarantee. */
  airgap: boolean;
  /** When true, every write/shell tool action is appended to an audit log. */
  auditLog: boolean;
  /** Accent colour theme: "default" or "plain" (no colour). */
  theme: string;
  /** When true, the model's reasoning trace is not displayed. */
  hideThinking: boolean;
  /**
   * When true, pport maintains portmem.md per directory and loads it into the
   * system prompt on startup. Off by default — an auto-loaded, model-writable
   * memory file can recycle a weak model's hallucinations back into context.
   */
  portMem: boolean;
  rag: RagConfig;
  ssh: SshConfig;
  /** MCP servers to connect to at startup; their tools join the registry. */
  mcpServers: Record<string, McpServerConfig>;
  /** Lifecycle hooks — shell commands run at defined points. */
  hooks: Partial<Record<HookEvent, HookSpec[]>>;
}

/** A configured permission rule — see src/rules.ts. */
export interface PermissionRuleConfig {
  /** Tool name the rule applies to. */
  tool: string;
  /** Glob tested against the call summary; omitted = matches every call. */
  pattern?: string;
  /** What to do on a match. */
  action: "allow" | "ask" | "deny";
}

/** A Model Context Protocol server launched over stdio. */
export interface McpServerConfig {
  /** Executable to spawn. */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Extra environment variables for the server process. */
  env?: Record<string, string>;
  /** Set false to keep the entry but not connect. Default true. */
  enabled?: boolean;
}

/** Points in the session lifecycle at which hooks can fire. */
export type HookEvent = "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";

/** One configured hook — a shell command, optionally scoped by a matcher. */
export interface HookSpec {
  /** Shell command to run. */
  command: string;
  /** For tool events: a regex tested against the tool name. Default: all tools. */
  matcher?: string;
}

export interface SshConfig {
  /** When true, open an SSH tunnel at startup and route Ollama through it. */
  enabled: boolean;
  /**
   * "direct"  — plain `ssh user@host` to a fixed host.
   * "gcloud"  — `gcloud compute ssh` to a GCE instance by name (handles keys
   *             and the changing external IP of a preemptible VM).
   */
  mode: "direct" | "gcloud";

  // direct mode
  host: string;
  user: string;
  /** SSH port on the remote host. Default 22. */
  port: number;
  /** Optional path to an SSH private key. */
  identityFile: string;

  // gcloud mode
  gcloud: {
    instance: string;
    zone: string;
    project: string;
    /** Route through Identity-Aware Proxy instead of the external IP. */
    iap: boolean;
  };

  /** Port Ollama listens on remotely. Default 11434. */
  remotePort: number;
  /** Local port the tunnel is forwarded to. Default 11435. */
  localPort: number;
}

export interface RagConfig {
  /** When false, the search_docs tool is not exposed to the model. */
  enabled: boolean;
  /** Command name or path of the RAG retrieval CLI (default "rag"). */
  command: string;
  /** Default number of chunks to retrieve per query. */
  defaultK: number;
}

export interface ChatResponse {
  content: string;
  thinking?: string;
  toolCalls: ToolCall[];
}

/** An incremental piece of a streamed response. */
export interface ChatDelta {
  /** Newly arrived answer text. */
  content?: string;
  /** Newly arrived reasoning-trace text. */
  thinking?: string;
}

/** Per-request options for a chat completion. */
export interface ChatOptions {
  /** Abort the request when this signal fires (Ctrl-C cancellation). */
  signal?: AbortSignal;
  /** When provided, the response is streamed and each chunk is delivered here. */
  onDelta?: (delta: ChatDelta) => void;
  /** Override the model for this one request (planner/executor split). */
  model?: string;
}

export interface Provider {
  /** A chat completion with optional tool use; streams when opts.onDelta is set. */
  chat(messages: Message[], tools: ToolSchema[], opts?: ChatOptions): Promise<ChatResponse>;
  /** Throws with a friendly message if the backend is unreachable. */
  healthCheck(): Promise<void>;
  /** Names of models available on the backend. */
  listModels(): Promise<string[]>;
  /** Capabilities of a model (e.g. "tools", "thinking"); null if unknown. */
  capabilities(model: string): Promise<Set<string> | null>;
}
