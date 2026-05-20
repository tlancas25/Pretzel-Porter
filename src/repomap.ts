import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { looksBinary } from "./tools/util.js";

// A dependency-free repo map: a ranked outline of the project's source files
// and their top-level symbols. Tree-sitter would be more precise, but it is a
// native dependency — and the whole project ships with zero runtime deps. The
// regex heuristics below are coarse but give a small model a real sense of the
// codebase shape without it spending tool calls to discover it.

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".cache", "vendor",
  "__pycache__", ".venv", "venv", "target", ".next", "coverage",
]);
const MAX_FILE_BYTES = 400_000;

/** Symbol-definition patterns per language; the matched line is the signature. */
const LANG_PATTERNS: Record<string, RegExp[]> = {
  js: [
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class)\s+\w+/,
    /^(?:export\s+)?(?:interface|type|enum)\s+\w+/,
    /^export\s+(?:const|let|var)\s+\w+/,
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
  ],
  py: [/^\s*(?:class|def|async def)\s+\w+/],
  go: [/^func\s+/, /^type\s+\w+/],
  rust: [/^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl|mod)\s+\w/],
  ruby: [/^\s*(?:class|module|def)\s+\w/],
  java: [
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+\w+/,
    /^\s*(?:public|private|protected)\s+[\w<>\[\],\s]+\s+\w+\s*\([^;]*\)\s*\{?\s*$/,
  ],
  c: [/^[\w][\w\s\*]*\s+\**\w+\s*\([^;{]*\)\s*\{?\s*$/, /^(?:struct|enum|typedef)\s+\w/],
  sh: [/^(?:function\s+)?\w+\s*\(\)\s*\{?/],
};

/** Map a file extension to a language key in LANG_PATTERNS. */
function langOf(ext: string): keyof typeof LANG_PATTERNS | null {
  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs":
      return "js";
    case ".py": return "py";
    case ".go": return "go";
    case ".rs": return "rust";
    case ".rb": return "ruby";
    case ".java": case ".cs": case ".kt": return "java";
    case ".c": case ".h": case ".cpp": case ".hpp": case ".cc": return "c";
    case ".sh": case ".bash": return "sh";
    default: return null;
  }
}

/** Extract signature lines from a source file. */
function extractSymbols(text: string, lang: keyof typeof LANG_PATTERNS): string[] {
  const patterns = LANG_PATTERNS[lang]!;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (out.length >= 80) break;
    if (patterns.some((re) => re.test(raw))) {
      // Trim, drop a trailing opening brace, collapse long lines.
      let sig = raw.trim().replace(/\s*\{\s*$/, "");
      if (sig.length > 120) sig = sig.slice(0, 117) + "…";
      out.push(sig);
    }
  }
  return out;
}

interface FileEntry {
  rel: string;
  symbols: string[];
}

/**
 * Build a repo map for `root`: each source file with its symbol outline,
 * rendered within `charBudget`. Files are ordered by symbol count so the
 * richest files survive truncation.
 */
export function buildRepoMap(root: string, charBudget = 12_000): string {
  const entries: FileEntry[] = [];

  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const lang = langOf(extname(name).toLowerCase());
      if (!lang) continue;
      let buf: Buffer;
      try {
        buf = readFileSync(full);
      } catch {
        continue;
      }
      if (looksBinary(buf)) continue;
      const symbols = extractSymbols(buf.toString("utf8"), lang);
      if (symbols.length > 0) entries.push({ rel: relative(root, full) || name, symbols });
    }
  };
  walk(root);

  if (entries.length === 0) {
    return "No recognised source files found under the project root.";
  }

  // Richest files first, then alphabetical — so truncation drops the thin ones.
  entries.sort((a, b) => b.symbols.length - a.symbols.length || a.rel.localeCompare(b.rel));

  const lines: string[] = [`Repo map — ${entries.length} source file(s):`, ""];
  let used = lines.join("\n").length;
  let shown = 0;
  for (const e of entries) {
    const block = [e.rel, ...e.symbols.map((s) => `  ${s}`)].join("\n");
    if (used + block.length + 2 > charBudget) break;
    lines.push(block, "");
    used += block.length + 2;
    shown++;
  }
  if (shown < entries.length) {
    lines.push(`… [${entries.length - shown} more file(s) omitted — map budget reached]`);
  }
  return lines.join("\n").trimEnd();
}
