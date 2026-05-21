import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Tool } from "../types.js";
import { reqString, optString, optNumber, clamp } from "./util.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".cache"]);

/** Convert a glob pattern to an anchored RegExp. `**` spans directories. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"; // ** — any depth, including across directory separators
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*"; // * — within a single path segment
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp("^" + re + "$");
}

export const globTool: Tool = {
  risk: "read",
  schema: {
    name: "glob",
    description:
      "Find files by name pattern under a directory. Supports glob wildcards: " +
      "* (within a path segment), ** (any depth), ? (one character). " +
      "Examples: **/*.ts, src/*.py, **/Dockerfile. Returns matching paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match file paths against." },
        path: { type: "string", description: "Directory to search under. Defaults to the sandbox root." },
        max_results: { type: "number", description: "Cap on paths returned. Default 300." },
      },
      required: ["pattern"],
    },
  },
  summarize: (args) => `glob ${args.pattern} in ${args.path ?? "."}`,
  async run(args, ctx) {
    const root = ctx.permissions.resolveWithin(optString(args, "path", "."));
    const maxResults = Math.max(1, Math.min(5000, optNumber(args, "max_results", 300)));
    const pattern = reqString(args, "pattern");

    let re: RegExp;
    try {
      re = globToRegExp(pattern);
    } catch (e) {
      return { ok: false, output: `Invalid glob pattern: ${(e as Error).message}` };
    }
    try {
      if (!statSync(root).isDirectory()) {
        return { ok: false, output: "path must be a directory for glob." };
      }
    } catch (e) {
      return { ok: false, output: `Search failed: ${(e as Error).message}` };
    }

    const hits: string[] = [];
    let truncated = false;
    const walk = (dir: string): void => {
      if (hits.length >= maxResults) {
        truncated = true;
        return;
      }
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names.sort()) {
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
        // Match the path relative to the search root, with forward slashes.
        const rel = relative(root, full).split(sep).join("/");
        if (re.test(rel)) hits.push(rel);
      }
    };
    walk(root);

    if (hits.length === 0) return { ok: true, output: `No files match ${pattern}.` };
    const note = truncated ? `\n… [stopped at ${maxResults} matches]` : "";
    return {
      ok: true,
      output: `${hits.length} match(es):\n${clamp(hits.join("\n"), 12_000)}${note}`,
    };
  },
};
