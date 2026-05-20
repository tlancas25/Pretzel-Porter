import type {
  AgentConfig,
  ChatResponse,
  Message,
  Provider,
  ToolCall,
  ToolSchema,
} from "./types.js";

/**
 * Talks to Ollama's native /api/chat endpoint, which exposes both the
 * `thinking` trace and structured `tool_calls` cleanly.
 *
 * The Provider interface is deliberately backend-agnostic: when the GCP
 * vLLM box is ready, add an OpenAI-compatible provider implementing the
 * same two methods and select it via `config.provider`.
 */
export class OllamaProvider implements Provider {
  /** Per-model capability cache (null = could not be determined). */
  private readonly capsCache = new Map<string, Set<string> | null>();

  constructor(private readonly cfg: AgentConfig) {}

  private async fetchTags(): Promise<{ name?: string; model?: string }[]> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/tags`);
    } catch (e) {
      throw new Error(
        `Cannot reach Ollama at ${this.cfg.baseUrl} — is it running? ` +
          `Start it with \`ollama serve\`. (${(e as Error).message})`,
      );
    }
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status} for /api/tags`);
    const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
    return data.models ?? [];
  }

  async healthCheck(): Promise<void> {
    await this.fetchTags(); // throws if the backend is unreachable
  }

  async listModels(): Promise<string[]> {
    const seen = new Set<string>();
    for (const m of await this.fetchTags()) {
      if (m.name) seen.add(m.name);
      else if (m.model) seen.add(m.model);
    }
    return [...seen].sort();
  }

  /**
   * Capabilities of a model (e.g. "tools", "thinking"), via /api/show.
   * Cached per model. Returns null if the capabilities can't be determined,
   * so callers can fall back to optimistic behaviour.
   */
  async capabilities(model: string): Promise<Set<string> | null> {
    const cached = this.capsCache.get(model);
    if (cached !== undefined) return cached;
    let caps: Set<string> | null = null;
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        const data = (await res.json()) as { capabilities?: string[] };
        if (Array.isArray(data.capabilities)) caps = new Set(data.capabilities);
      }
    } catch {
      // leave caps null — treat as "unknown"
    }
    this.capsCache.set(model, caps);
    return caps;
  }

  async chat(messages: Message[], tools: ToolSchema[]): Promise<ChatResponse> {
    // Only ask for thinking / tools if the model actually supports them —
    // otherwise Ollama returns HTTP 400. Unknown capabilities → optimistic.
    const caps = await this.capabilities(this.cfg.model);
    const useThink = this.cfg.think && (caps === null || caps.has("thinking"));
    const useTools = caps === null || caps.has("tools");

    const body = {
      model: this.cfg.model,
      messages: messages.map(toOllamaMessage),
      tools: useTools ? tools.map((t) => ({ type: "function", function: t })) : [],
      think: useThink,
      stream: false,
      options: {
        temperature: this.cfg.temperature,
        num_ctx: this.cfg.numCtx,
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Lost connection to Ollama: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama /api/chat returned HTTP ${res.status}. ${detail}`.trim());
    }

    const data = (await res.json()) as OllamaChatResponse;
    const msg = data.message ?? { role: "assistant", content: "" };

    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
      id: `call_${Date.now().toString(36)}_${i}`,
      name: tc.function?.name ?? "",
      arguments: normalizeArgs(tc.function?.arguments),
    }));

    return {
      content: msg.content ?? "",
      thinking: msg.thinking?.trim() || undefined,
      toolCalls,
    };
  }
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content?: string;
    thinking?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
}

function toOllamaMessage(m: Message): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_name: m.tool_name ?? "" };
  }
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.tool_calls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

/** Ollama usually returns an object; some builds return a JSON string. */
function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}
