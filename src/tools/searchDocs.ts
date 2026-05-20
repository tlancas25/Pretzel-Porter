import { execFile } from "node:child_process";
import type { Tool } from "../types.js";
import { reqString, optNumber, clamp } from "./util.js";

/**
 * Semantic retrieval over the external RAG store, via the `rag` CLI
 * (`rag q -k N "<query>"`). Uses execFile — no shell — so the query string
 * cannot be used for command injection.
 */
export const searchDocsTool: Tool = {
  risk: "read",
  schema: {
    name: "search_docs",
    description:
      "Semantic search over the indexed knowledge base (RAG). Returns the most " +
      "relevant document chunks for a natural-language query, each with its " +
      "source and a relevance score. Use this to find information spread across " +
      "many documents before answering — it is not limited to the file sandbox.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        k: { type: "number", description: "How many chunks to retrieve (1-20)." },
      },
      required: ["query"],
    },
  },
  summarize: (args) => `rag search: ${args.query}`,
  async run(args, ctx) {
    const query = reqString(args, "query");
    const k = Math.max(1, Math.min(20, Math.round(optNumber(args, "k", ctx.ragDefaultK))));

    return await new Promise((resolve) => {
      execFile(
        ctx.ragCommand,
        ["q", "-k", String(k), query],
        { timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const msg =
              code === "ENOENT"
                ? `RAG CLI "${ctx.ragCommand}" not found on PATH. Set rag.command in agent.config.json, or rag.enabled to false.`
                : `RAG search failed: ${err.message}`;
            const detail = String(stderr ?? "").trim();
            return resolve({ ok: false, output: detail ? `${msg}\n${detail}` : msg });
          }
          const out = String(stdout ?? "").trim();
          return resolve({
            ok: out.length > 0,
            output: clamp(out || "No matching chunks found.", 12000),
          });
        },
      );
    });
  },
};
