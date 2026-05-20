import type { Tool } from "../types.js";
import { reqString, clamp } from "./util.js";

// web_fetch and web_search are the only network-capable tools. They are
// registered only when airgap is off, so an air-gapped session is guaranteed
// to make no outbound connection beyond the configured Ollama backend.

/** Crude HTML → text: drop scripts/markup, decode the common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: Tool = {
  risk: "read",
  schema: {
    name: "web_fetch",
    description:
      "Fetch a web page over HTTP(S) and return its text content. Available " +
      "only when air-gap mode is off.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The http(s) URL to fetch." } },
      required: ["url"],
    },
  },
  summarize: (args) => `fetch ${args.url}`,
  async run(args) {
    const url = reqString(args, "url");
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, output: "url must start with http:// or https://" };
    }
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
        headers: { "user-agent": "PretzelPorter/1.2 (+local agent)" },
      });
    } catch (e) {
      return { ok: false, output: `Fetch failed: ${(e as Error).message}` };
    }
    if (!res.ok) return { ok: false, output: `HTTP ${res.status} ${res.statusText} for ${url}` };
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw;
    return { ok: true, output: clamp(text || "(empty response)", 16_000) };
  },
};
