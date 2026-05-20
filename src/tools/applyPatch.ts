import { readFileSync, writeFileSync } from "node:fs";
import type { Tool } from "../types.js";
import { reqString } from "./util.js";
import { formatDiff } from "../diff.js";

// apply_patch applies a unified-diff patch to one file. It matches hunks by
// content (context + removed lines), not by line number, so a patch still
// applies if the surrounding line numbers have drifted slightly.

interface Hunk {
  oldBlock: string;
  newBlock: string;
}

/** Parse the ` `/`-`/`+` lines of a unified diff into hunks. */
function parseHunks(patch: string): Hunk[] | string {
  const hunks: Hunk[] = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let inHunk = false;

  const flush = (): void => {
    if (inHunk) hunks.push({ oldBlock: oldLines.join("\n"), newBlock: newLines.join("\n") });
    oldLines = [];
    newLines = [];
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      flush();
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const tag = line[0];
    const body = line.slice(1);
    if (tag === " ") {
      oldLines.push(body);
      newLines.push(body);
    } else if (tag === "-") {
      oldLines.push(body);
    } else if (tag === "+") {
      newLines.push(body);
    }
    // any other line (e.g. "\ No newline at end of file") is ignored
  }
  flush();
  return hunks.length > 0 ? hunks : "No hunks found — patch must contain @@ hunk headers.";
}

/** Apply hunks to text by locating each old block and substituting. */
function applyHunks(text: string, hunks: Hunk[]): string | { error: string } {
  let result = text;
  for (let i = 0; i < hunks.length; i++) {
    const { oldBlock, newBlock } = hunks[i]!;
    if (oldBlock === "") {
      // Pure insertion with no context — append to the end.
      result += (result.endsWith("\n") || result === "" ? "" : "\n") + newBlock;
      continue;
    }
    const idx = result.indexOf(oldBlock);
    if (idx === -1) {
      return { error: `hunk #${i + 1} did not match the file — the context has changed.` };
    }
    result = result.slice(0, idx) + newBlock + result.slice(idx + oldBlock.length);
  }
  return result;
}

export const applyPatchTool: Tool = {
  risk: "write",
  schema: {
    name: "apply_patch",
    description:
      "Apply a unified-diff patch to a file. The patch is the body of a diff: " +
      "@@ hunk headers followed by lines prefixed with a space (context), '-' " +
      "(remove), or '+' (add). Hunks are matched by content. Prefer edit_file " +
      "or multi_edit for simple changes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to patch, inside the sandbox." },
        patch: { type: "string", description: "The unified-diff hunks to apply." },
      },
      required: ["path", "patch"],
    },
  },
  summarize: (args) => `apply patch to ${args.path}`,
  affectedPath(args, ctx) {
    try {
      return ctx.permissions.resolveWithin(reqString(args, "path"));
    } catch {
      return null;
    }
  },
  async preview(args, ctx) {
    let path: string;
    try {
      path = ctx.permissions.resolveWithin(reqString(args, "path"));
    } catch {
      return null;
    }
    const hunks = parseHunks(typeof args.patch === "string" ? args.patch : "");
    if (typeof hunks === "string") return null;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    const result = applyHunks(text, hunks);
    return typeof result === "string" ? formatDiff(text, result) : null;
  },
  async run(args, ctx) {
    const path = ctx.permissions.resolveWithin(reqString(args, "path"), true);
    const hunks = parseHunks(reqString(args, "patch"));
    if (typeof hunks === "string") return { ok: false, output: hunks };
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      return { ok: false, output: `Could not read file: ${(e as Error).message}` };
    }
    const result = applyHunks(text, hunks);
    if (typeof result !== "string") return { ok: false, output: result.error };
    try {
      writeFileSync(path, result, "utf8");
    } catch (e) {
      return { ok: false, output: `Write failed: ${(e as Error).message}` };
    }
    return { ok: true, output: `Applied ${hunks.length} hunk(s) to ${args.path}.` };
  },
};
