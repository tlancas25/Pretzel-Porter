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
  /** Resolve a path and assert it is inside the sandbox, else throw. */
  resolveWithin(inputPath: string): string;
  /** Absolute roots the agent is allowed to touch. */
  roots(): string[];
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
}

export interface Tool {
  schema: ToolSchema;
  risk: Risk;
  /** One-line human summary of a specific invocation, for the confirm prompt. */
  summarize(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface AgentConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
  think: boolean;
  maxSteps: number;
  shellTimeoutMs: number;
  maxReadBytes: number;
  allowedPaths: string[];
  autoApprove: Record<Risk, boolean>;
  rag: RagConfig;
  ssh: SshConfig;
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

export interface Provider {
  /** Single non-streaming chat completion with optional tool use. */
  chat(messages: Message[], tools: ToolSchema[]): Promise<ChatResponse>;
  /** Throws with a friendly message if the backend is unreachable. */
  healthCheck(): Promise<void>;
  /** Names of models available on the backend. */
  listModels(): Promise<string[]>;
  /** Capabilities of a model (e.g. "tools", "thinking"); null if unknown. */
  capabilities(model: string): Promise<Set<string> | null>;
}
