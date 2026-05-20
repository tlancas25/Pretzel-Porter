import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Tool } from "../types.js";
import { reqString, optString, optNumber, clamp, looksBinary } from "./util.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".cache"]);
const MAX_FILE_BYTES = 1_000_000;

export const grepTool: Tool = {
  risk: "read",
  schema: {
    name: "grep",
    description:
      "Search for a regular-expression pattern across text files under a " +
      "directory. Returns matching lines as path:line: text.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression to search for." },
        path: { type: "string", description: "Directory to search under. Defaults to the sandbox root." },
        max_results: { type: "number", description: "Cap on matches returned. Default 200." },
      },
      required: ["pattern"],
    },
  },
  summarize: (args) => `grep /${args.pattern}/ in ${args.path ?? "."}`,
  async run(args, ctx) {
    const root = ctx.permissions.resolveWithin(optString(args, "path", "."));
    const maxResults = Math.max(1, Math.min(2000, optNumber(args, "max_results", 200)));
    let re: RegExp;
    try {
      re = new RegExp(reqString(args, "pattern"));
    } catch (e) {
      return { ok: false, output: `Invalid regular expression: ${(e as Error).message}` };
    }

    const hits: string[] = [];
    let scanned = 0;
    let truncated = false;

    const walk = (dir: string): void => {
      if (hits.length >= maxResults) return;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (hits.length >= maxResults) {
          truncated = true;
          return;
        }
        const full = join(dir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!SKIP_DIRS.has(name)) walk(full);
          continue;
        }
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
        let buf: Buffer;
        try {
          buf = readFileSync(full);
        } catch {
          continue;
        }
        if (looksBinary(buf)) continue;
        scanned++;
        const rel = relative(root, full) || name;
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            hits.push(`${rel}:${i + 1}: ${lines[i]!.trim()}`);
            if (hits.length >= maxResults) {
              truncated = true;
              return;
            }
          }
        }
      }
    };

    try {
      const rootStat = statSync(root);
      if (rootStat.isFile()) return { ok: false, output: "path must be a directory for grep." };
      walk(root);
    } catch (e) {
      return { ok: false, output: `Search failed: ${(e as Error).message}` };
    }

    if (hits.length === 0) {
      return { ok: true, output: `No matches in ${scanned} file(s).` };
    }
    const note = truncated ? `\n… [stopped at ${maxResults} matches]` : "";
    return { ok: true, output: `${hits.length} match(es) in ${scanned} file(s):\n${clamp(hits.join("\n"), 12000)}${note}` };
  },
};
