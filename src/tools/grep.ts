import { readdirSync, statSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { reqString, optString, optNumber, clamp, looksBinary } from "./util.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".cache"]);
const MAX_FILE_BYTES = 1_000_000;

export const grepTool: Tool = {
  risk: "read",
  schema: {
    name: "grep",
    description:
      "Search for a regular-expression pattern across text files under a " +
      "directory. Returns matching lines as path:line: text. Uses ripgrep " +
      "when it is installed (fast, .gitignore-aware) and falls back to a " +
      "built-in scan otherwise.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
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
    const pattern = reqString(args, "pattern");

    try {
      if (!statSync(root).isDirectory()) {
        return { ok: false, output: "path must be a directory for grep." };
      }
    } catch (e) {
      return { ok: false, output: `Search failed: ${(e as Error).message}` };
    }

    // Prefer ripgrep — fast and .gitignore-aware. Falls back on any trouble.
    const viaRg = await ripgrep(pattern, root, maxResults);
    if (viaRg) return viaRg;

    // Built-in, dependency-free scan.
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      return { ok: false, output: `Invalid regular expression: ${(e as Error).message}` };
    }
    return jsGrep(re, root, maxResults);
  },
};

/**
 * Search with ripgrep. Returns a result when `rg` ran (matches or not), or
 * null when `rg` is unavailable or errored — the caller then falls back.
 */
function ripgrep(pattern: string, root: string, maxResults: number): Promise<ToolResult | null> {
  return new Promise((resolve) => {
    execFile(
      "rg",
      ["--line-number", "--no-heading", "--color=never", "--max-filesize", "1M", "-e", pattern, "."],
      { cwd: root, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const code = (err as { code?: string | number }).code;
          if (code === "ENOENT") return resolve(null); // ripgrep not installed
          if (code === 1) return resolve({ ok: true, output: "No matches." }); // ran, 0 matches
          return resolve(null); // a real rg error — fall back to the JS scan
        }
        const all = String(stdout).split("\n").filter((l) => l.trim());
        const hits = all.slice(0, maxResults).map((line) => {
          const m = line.match(/^(.*?):(\d+):(.*)$/);
          return m ? `${m[1]}:${m[2]}: ${m[3]!.trim()}` : line;
        });
        if (hits.length === 0) return resolve({ ok: true, output: "No matches." });
        const note = all.length > maxResults ? `\n… [stopped at ${maxResults} matches]` : "";
        resolve({
          ok: true,
          output: `${hits.length} match(es) (ripgrep):\n${clamp(hits.join("\n"), 12_000)}${note}`,
        });
      },
    );
  });
}

/** The original built-in recursive scan — used when ripgrep is unavailable. */
function jsGrep(re: RegExp, root: string, maxResults: number): ToolResult {
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
    walk(root);
  } catch (e) {
    return { ok: false, output: `Search failed: ${(e as Error).message}` };
  }
  if (hits.length === 0) return { ok: true, output: `No matches in ${scanned} file(s).` };
  const note = truncated ? `\n… [stopped at ${maxResults} matches]` : "";
  return {
    ok: true,
    output: `${hits.length} match(es) in ${scanned} file(s):\n${clamp(hits.join("\n"), 12_000)}${note}`,
  };
}
