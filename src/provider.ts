import type {
  AgentConfig,
  ChatOptions,
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
      res = await fetch(`${this.cfg.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(15000),
      });
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
        signal: AbortSignal.timeout(15000),
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

  async chat(
    messages: Message[],
    tools: ToolSchema[],
    opts: ChatOptions = {},
  ): Promise<ChatResponse> {
    // Only ask for thinking / tools if the model actually supports them —
    // otherwise Ollama returns HTTP 400. Unknown capabilities → optimistic.
    const model = opts.model || this.cfg.model;
    const caps = await this.capabilities(model);
    const useThink = this.cfg.think && (caps === null || caps.has("thinking"));
    const useTools = (caps === null || caps.has("tools")) && tools.length > 0;
    const stream = typeof opts.onDelta === "function";

    const body = {
      model,
      messages: messages.map(toOllamaMessage),
      tools: useTools ? tools.map((t) => ({ type: "function", function: t })) : [],
      think: useThink,
      stream,
      options: {
        temperature: this.cfg.temperature,
        num_ctx: this.cfg.numCtx,
        top_p: this.cfg.sampling.topP,
        top_k: this.cfg.sampling.topK,
        min_p: this.cfg.sampling.minP,
        repeat_penalty: this.cfg.sampling.repeatPenalty,
        repeat_last_n: this.cfg.sampling.repeatLastN,
      },
    };

    // The request is aborted by the caller's signal, or by an inactivity
    // watchdog (no bytes for requestTimeoutMs) — whichever fires first.
    const watchdog = new AbortController();
    const signals = [watchdog.signal];
    if (opts.signal) signals.push(opts.signal);
    let idleTimer: NodeJS.Timeout = setTimeout(
      () => watchdog.abort(),
      this.cfg.requestTimeoutMs,
    );
    const kickWatchdog = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => watchdog.abort(), this.cfg.requestTimeoutMs);
    };

    const timedOut = (): boolean => watchdog.signal.aborted && !opts.signal?.aborted;
    const abortError = (): Error => {
      if (opts.signal?.aborted) return new Error("__ABORTED__");
      const secs = Math.round(this.cfg.requestTimeoutMs / 1000);
      return new Error(
        `No response from "${model}" within ${secs}s. The model may be ` +
          `overloaded or too slow — try a faster or quantized model, or raise ` +
          `requestTimeoutMs in the config.`,
      );
    };

    try {
      let res: Response;
      try {
        res = await fetch(`${this.cfg.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
      } catch (e) {
        const err = e as Error;
        if (err.name === "TimeoutError" || err.name === "AbortError") {
          throw timedOut() || opts.signal?.aborted ? abortError() : err;
        }
        throw new Error(`Lost connection to Ollama: ${err.message}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Ollama /api/chat returned HTTP ${res.status}. ${detail}`.trim());
      }

      return stream
        ? await this.readStream(res, opts, kickWatchdog, abortError)
        : await this.readWhole(res);
    } finally {
      clearTimeout(idleTimer);
    }
  }

  /** Parse a non-streamed /api/chat response. */
  private async readWhole(res: Response): Promise<ChatResponse> {
    const data = (await res.json()) as OllamaChatResponse;
    const msg = data.message ?? { role: "assistant", content: "" };
    return {
      content: msg.content ?? "",
      thinking: msg.thinking?.trim() || undefined,
      toolCalls: toToolCalls(msg.tool_calls),
    };
  }

  /** Parse a streamed (NDJSON) /api/chat response, emitting deltas as they arrive. */
  private async readStream(
    res: Response,
    opts: ChatOptions,
    kickWatchdog: () => void,
    abortError: () => Error,
  ): Promise<ChatResponse> {
    if (!res.body) throw new Error("Ollama returned an empty streaming response.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    let thinking = "";
    const rawToolCalls: OllamaToolCall[] = [];

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: OllamaChatResponse & { error?: string };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return; // ignore a malformed/partial line
      }
      if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
      const msg = obj.message;
      if (!msg) return;
      if (msg.thinking) {
        thinking += msg.thinking;
        opts.onDelta?.({ thinking: msg.thinking });
      }
      if (msg.content) {
        content += msg.content;
        opts.onDelta?.({ content: msg.content });
      }
      if (msg.tool_calls) rawToolCalls.push(...msg.tool_calls);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        kickWatchdog();
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handleLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handleLine(buf); // trailing line without a newline
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") throw abortError();
      throw err;
    }

    return {
      content,
      thinking: thinking.trim() || undefined,
      toolCalls: toToolCalls(rawToolCalls),
    };
  }
}

type OllamaToolCall = { function?: { name?: string; arguments?: unknown } };

/** Convert Ollama's tool-call shape into our ToolCall[], minting local ids. */
function toToolCalls(raw: OllamaToolCall[] | undefined): ToolCall[] {
  return (raw ?? []).map((tc, i) => ({
    id: `call_${Date.now().toString(36)}_${i}`,
    name: tc.function?.name ?? "",
    arguments: normalizeArgs(tc.function?.arguments),
  }));
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
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.images?.length) out.images = m.images; // base64 images for a vision model
  return out;
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
