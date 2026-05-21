// src/workspace.ts — a directory tree of the sandbox, built once at session
// start and injected into the system prompt. A weak local model will not
// reliably explore on its own; handing it the layout up front means it always
// knows what files and subdirectories exist instead of guessing or tunnelling
// on the root directory.

import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
]);

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build an indented directory tree of `root` — directories first at each
 * level, then files with their sizes. Bounded by depth and a total entry cap
 * so it stays a reasonable size in the prompt.
 */
export function workspaceTree(root: string, maxDepth = 3, maxEntries = 220): string {
  const out: string[] = [basename(root) + "/"];
  let count = 0;
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || truncated) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const dirs: string[] = [];
    const files: { name: string; size: number }[] = [];
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      let st;
      try {
        st = statSync(join(dir, name));
      } catch {
        continue;
      }
      if (st.isDirectory()) dirs.push(name);
      else if (st.isFile()) files.push({ name, size: st.size });
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.name.localeCompare(b.name));
    const indent = "  ".repeat(depth);
    for (const name of dirs) {
      if (count >= maxEntries) {
        truncated = true;
        return;
      }
      out.push(`${indent}${name}/`);
      count++;
      walk(join(dir, name), depth + 1);
    }
    for (const f of files) {
      if (count >= maxEntries) {
        truncated = true;
        return;
      }
      out.push(`${indent}${f.name}  (${humanSize(f.size)})`);
      count++;
    }
  };

  walk(root, 1);
  if (truncated) out.push(`  … (tree truncated at ${maxEntries} entries — use list_dir/glob for the rest)`);
  return out.join("\n");
}
