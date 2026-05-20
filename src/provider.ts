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

  async chat(messages: Message[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      model: this.cfg.model,
      messages: messages.map(toOllamaMessage),
      tools: tools.map((t) => ({ type: "function", function: t })),
      think: this.cfg.think,
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
