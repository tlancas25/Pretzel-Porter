import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PermissionChecker } from "./types.js";
import { looksBinary } from "./tools/util.js";

// File context: a set of files (and directories) pinned into every turn, plus
// inline @path mentions expanded for a single turn. This lets a weak model see
// the files that matter without the operator pasting them or the model having
// to discover them with tool calls.

const MAX_FILE_BYTES = 100_000;
/** Hard cap on the whole attached-context block, to protect the window. */
const MAX_BLOCK_CHARS = 48_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".cache", "build"]);

export class FileContext {
  private readonly pinnedFiles = new Set<string>();
  private readonly pinnedDirs = new Set<string>();

  constructor(private readonly permissions: PermissionChecker) {}

  /** Pin a file or directory into every turn. Returns a status string. */
  add(input: string): string {
    let abs: string;
    try {
      abs = this.permissions.resolveWithin(input);
    } catch (e) {
      return (e as Error).message;
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      return `not found: ${input}`;
    }
    if (st.isDirectory()) {
      this.pinnedDirs.add(abs);
      return `pinned directory ${input}`;
    }
    this.pinnedFiles.add(abs);
    return `pinned ${input}`;
  }

  /** Unpin a previously pinned file or directory. */
  drop(input: string): string {
    let abs = input;
    try {
      abs = this.permissions.resolveWithin(input);
    } catch {
      // fall back to the raw string — it may still match a stored entry
    }
    if (this.pinnedFiles.delete(abs) || this.pinnedDirs.delete(abs)) {
      return `unpinned ${input}`;
    }
    return `not pinned: ${input}`;
  }

  clear(): void {
    this.pinnedFiles.clear();
    this.pinnedDirs.clear();
  }

  /** Human-readable listing of what is pinned. */
  list(): string[] {
    return [
      ...[...this.pinnedDirs].map((d) => `${d}/  (directory)`),
      ...[...this.pinnedFiles],
    ];
  }

  get size(): number {
    return this.pinnedFiles.size + this.pinnedDirs.size;
  }

  /**
   * Build the attached-context block for a turn: pinned files and directories,
   * plus any @path mentions in `input`. Returns "" when there is nothing.
   */
  build(input: string): string {
    const paths = new Set<string>();
    for (const f of this.pinnedFiles) paths.add(f);
    for (const d of this.pinnedDirs) for (const f of this.walkDir(d)) paths.add(f);
    for (const mention of this.mentions(input)) {
      try {
        paths.add(this.permissions.resolveWithin(mention));
      } catch {
        // a bad mention is ignored — the model still sees the raw text
      }
    }
    if (paths.size === 0) return "";

    const blocks: string[] = [];
    let used = 0;
    let skipped = 0;
    for (const abs of paths) {
      const body = this.readFile(abs);
      if (body === null) continue;
      const block = `--- ${abs} ---\n${body}`;
      if (used + block.length > MAX_BLOCK_CHARS) {
        skipped++;
        continue;
      }
      blocks.push(block);
      used += block.length;
    }
    if (blocks.length === 0) return "";
    const note = skipped > 0 ? `\n\n[${skipped} more file(s) omitted — context budget reached]` : "";
    return "[Attached files for context]\n\n" + blocks.join("\n\n") + note;
  }

  /** Extract `@path` tokens from user text. */
  private mentions(input: string): string[] {
    const out: string[] = [];
    const re = /(?:^|\s)@([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) out.push(m[1]!);
    return out;
  }

  private walkDir(dir: string): string[] {
    const out: string[] = [];
    const recurse = (d: string): void => {
      if (out.length >= 60) return;
      let names: string[];
      try {
        names = readdirSync(d);
      } catch {
        return;
      }
      for (const name of names.sort()) {
        if (out.length >= 60) return;
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        const full = join(d, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) recurse(full);
        else if (st.isFile() && st.size <= MAX_FILE_BYTES) out.push(full);
      }
    };
    recurse(dir);
    return out;
  }

  private readFile(abs: string): string | null {
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
      const buf = readFileSync(abs);
      if (looksBinary(buf)) return null;
      return buf.toString("utf8");
    } catch {
      return null;
    }
  }
}
