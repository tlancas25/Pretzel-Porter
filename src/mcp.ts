import { spawn, type ChildProcess } from "node:child_process";
import type { McpServerConfig, Tool, ToolSchema } from "./types.js";

// A minimal Model Context Protocol client. It speaks JSON-RPC 2.0 over a
// stdio transport (newline-delimited messages) to a server process, lists the
// server's tools, and wraps each as a Pretzel Porter Tool. This is written
// from the protocol spec — no SDK — to keep the project dependency-free.
//
// stdio servers are local processes, so they suit a privacy-first tool: no
// network is involved. HTTP/SSE transports are intentionally not implemented.

const REQUEST_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** A single connected MCP server. */
export class McpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buf = "";
  private toolDefs: McpToolDef[] = [];

  constructor(
    /** Sanitised, collision-free prefix for this server's tool names. */
    readonly name: string,
    private readonly cfg: McpServerConfig,
  ) {}

  /** Spawn the server, run the handshake, and fetch its tool list. */
  async connect(): Promise<void> {
    const proc = spawn(this.cfg.command, this.cfg.args ?? [], {
      env: { ...process.env, ...(this.cfg.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    const spawnFailed = new Promise<never>((_, reject) => {
      proc.once("error", (e) => reject(new Error(`could not start server: ${e.message}`)));
      proc.once("exit", (code) => {
        if (code !== 0 && code !== null) reject(new Error(`server exited with code ${code}`));
      });
    });

    proc.stdout?.on("data", (d: Buffer) => this.onData(d));
    proc.stdin?.on("error", () => {}); // ignore EPIPE if the server exits
    // Surface nothing from stderr by default — many servers log there freely.

    const handshake = (async () => {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "pretzel-porter", version: "1.2.0" },
      });
      this.notify("notifications/initialized", {});
      const listed = (await this.request("tools/list", {})) as { tools?: McpToolDef[] } | undefined;
      this.toolDefs = Array.isArray(listed?.tools) ? listed!.tools! : [];
    })();

    await Promise.race([handshake, spawnFailed]);
  }

  /** Number of tools this server exposed. */
  get toolCount(): number {
    return this.toolDefs.length;
  }

  /** Wrap each MCP tool as a Pretzel Porter Tool. */
  tools(): Tool[] {
    return this.toolDefs.map((def) => {
      const schema: ToolSchema = {
        name: `${this.name}__${def.name}`,
        description: def.description ?? `MCP tool "${def.name}" from server ${this.name}`,
        parameters: normaliseSchema(def.inputSchema),
      };
      return {
        // External, side-effecting tools — route through write confirmation.
        risk: "write" as const,
        schema,
        summarize: () => `mcp ${this.name}:${def.name}`,
        run: async (args) => {
          try {
            const res = (await this.request("tools/call", {
              name: def.name,
              arguments: args,
            })) as { content?: unknown; isError?: boolean } | undefined;
            return { ok: !res?.isError, output: renderResult(res) };
          } catch (e) {
            return { ok: false, output: `MCP call failed: ${(e as Error).message}` };
          }
        },
      };
    });
  }

  /** Terminate the server process. */
  close(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // ignore non-JSON noise on stdout
      }
      if (typeof msg.id !== "number") continue; // a notification — ignore
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? "MCP error"));
      else waiter.resolve(msg.result);
    }
  }

  private send(obj: Record<string, unknown>): void {
    this.proc?.stdin?.write(JSON.stringify(obj) + "\n");
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
    });
  }
}

/** Coerce an MCP inputSchema into our ToolSchema.parameters shape. */
function normaliseSchema(input: unknown): ToolSchema["parameters"] {
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    return {
      type: "object",
      properties: (rec.properties as Record<string, unknown>) ?? {},
      required: Array.isArray(rec.required) ? (rec.required as string[]) : undefined,
    };
  }
  return { type: "object", properties: {} };
}

/** Extract the text parts of an MCP tools/call result. */
function renderResult(res: { content?: unknown } | undefined): string {
  const content = res?.content;
  if (!Array.isArray(content)) return "(no content)";
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.text === "string") parts.push(rec.text);
      else if (typeof rec.type === "string") parts.push(`[${rec.type} content]`);
    }
  }
  return parts.join("\n") || "(empty result)";
}

/**
 * Connect to every enabled MCP server in the config. Failures are collected,
 * not thrown — one broken server must not stop the session from starting.
 */
export async function connectMcpServers(
  servers: Record<string, McpServerConfig>,
): Promise<{ clients: McpClient[]; tools: Tool[]; errors: string[] }> {
  const clients: McpClient[] = [];
  const tools: Tool[] = [];
  const errors: string[] = [];
  const used = new Set<string>();

  for (const [rawName, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;
    if (!cfg.command) {
      errors.push(`${rawName}: no command configured`);
      continue;
    }
    // Sanitise the name so wrapped tool names stay valid identifiers.
    let name = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
    while (used.has(name)) name += "_";
    used.add(name);

    const client = new McpClient(name, cfg);
    try {
      await client.connect();
      clients.push(client);
      tools.push(...client.tools());
    } catch (e) {
      errors.push(`${rawName}: ${(e as Error).message}`);
      client.close();
    }
  }
  return { clients, tools, errors };
}
