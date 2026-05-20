import type { Tool } from "../types.js";
import { reqString, optNumber, clamp } from "./util.js";
import { htmlToText } from "./webFetch.js";

/** Pull result titles and URLs out of a DuckDuckGo HTML results page. */
function parseResults(html: string, max: number): string[] {
  const out: string[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && out.length < max) {
    let url = m[1]!;
    // DuckDuckGo wraps result URLs as //duckduckgo.com/l/?uddg=<encoded>
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]!);
    else if (url.startsWith("//")) url = "https:" + url;
    const title = htmlToText(m[2]!).replace(/\s+/g, " ").trim();
    if (title) out.push(`${out.length + 1}. ${title}\n   ${url}`);
  }
  return out;
}

export const webSearchTool: Tool = {
  risk: "read",
  schema: {
    name: "web_search",
    description:
      "Search the web and return result titles and URLs. Follow up with " +
      "web_fetch to read a result. Available only when air-gap mode is off.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        max_results: { type: "number", description: "How many results (1-15, default 6)." },
      },
      required: ["query"],
    },
  },
  summarize: (args) => `web search: ${args.query}`,
  async run(args) {
    const query = reqString(args, "query");
    const max = Math.max(1, Math.min(15, Math.round(optNumber(args, "max_results", 6))));
    let res: Response;
    try {
      res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; PretzelPorter/1.2)" },
      });
    } catch (e) {
      return { ok: false, output: `Search failed: ${(e as Error).message}` };
    }
    if (!res.ok) return { ok: false, output: `Search returned HTTP ${res.status}.` };
    const results = parseResults(await res.text(), max);
    if (results.length === 0) {
      return { ok: true, output: "No results found (or the search page format changed)." };
    }
    return { ok: true, output: clamp(results.join("\n\n"), 10_000) };
  },
};
