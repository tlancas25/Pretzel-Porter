import { readFileSync, writeFileSync } from "node:fs";
import type { Tool } from "../types.js";
import { reqString, nearestMatch } from "./util.js";
import { formatDiff } from "../diff.js";

// multi_edit applies a batch of exact-string edits to one file in a single,
// all-or-nothing call — cheaper and safer than several edit_file round-trips.

interface EditOp {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

/** Parse and validate the `edits` argument; returns ops or an error string. */
function parseEdits(args: Record<string, unknown>): EditOp[] | string {
  const raw = args.edits;
  if (!Array.isArray(raw) || raw.length === 0) return "edits must be a non-empty array.";
  const ops: EditOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!e || typeof e !== "object") return `edit #${i + 1} must be an object.`;
    const rec = e as Record<string, unknown>;
    if (typeof rec.old_string !== "string" || rec.old_string.length === 0) {
      return `edit #${i + 1} needs a non-empty old_string.`;
    }
    ops.push({
      old_string: rec.old_string,
      new_string: typeof rec.new_string === "string" ? rec.new_string : "",
      replace_all: rec.replace_all === true,
    });
  }
  return ops;
}

/** Apply edits in order. Returns the new text, or an error. */
function applyEdits(text: string, ops: EditOp[]): string | { error: string } {
  let out = text;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const count = out.split(op.old_string).length - 1;
    if (count === 0) {
      const near = nearestMatch(out, op.old_string);
      return {
        error:
          `edit #${i + 1}: old_string was not found — it must match the file ` +
          `exactly, character for character.` +
          (near
            ? `\nClosest region of the file — compare it against your old_string:\n${near}`
            : ""),
      };
    }
    if (count > 1 && !op.replace_all) {
      return {
        error: `edit #${i + 1}: old_string matches ${count} times — make it unique or set replace_all.`,
      };
    }
    out = op.replace_all
      ? out.split(op.old_string).join(op.new_string)
      : out.replace(op.old_string, op.new_string);
  }
  return out;
}

export const multiEditTool: Tool = {
  risk: "write",
  schema: {
    name: "multi_edit",
    description:
      "Apply several exact-string edits to one file in a single call. Edits " +
      "apply in order, each building on the last. Every old_string must match " +
      "(uniquely, unless replace_all is set). All-or-nothing: if any edit fails " +
      "the file is left untouched.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to edit, inside the sandbox." },
        edits: {
          type: "array",
          description: "The edits to apply, in order.",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string", description: "Exact text to find." },
              new_string: { type: "string", description: "Replacement text." },
              replace_all: { type: "boolean", description: "Replace every occurrence." },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
  summarize: (args) => {
    const n = Array.isArray(args.edits) ? args.edits.length : 0;
    return `multi-edit ${args.path} (${n} edit${n === 1 ? "" : "s"})`;
  },
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
    const ops = parseEdits(args);
    if (typeof ops === "string") return null;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    const result = applyEdits(text, ops);
    return typeof result === "string" ? formatDiff(text, result) : null;
  },
  async run(args, ctx) {
    const path = ctx.permissions.resolveWithin(reqString(args, "path"), true);
    const ops = parseEdits(args);
    if (typeof ops === "string") return { ok: false, output: ops };
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      return { ok: false, output: `Could not read file: ${(e as Error).message}` };
    }
    const result = applyEdits(text, ops);
    if (typeof result !== "string") return { ok: false, output: result.error };
    try {
      writeFileSync(path, result, "utf8");
    } catch (e) {
      return { ok: false, output: `Write failed: ${(e as Error).message}` };
    }
    return { ok: true, output: `Applied ${ops.length} edit(s) to ${args.path}.` };
  },
};
