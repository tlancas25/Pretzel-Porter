import { readFileSync, writeFileSync } from "node:fs";
import type { Tool } from "../types.js";
import { reqString, optBool } from "./util.js";
import { formatDiff } from "../diff.js";

export const editFileTool: Tool = {
  risk: "write",
  schema: {
    name: "edit_file",
    description:
      "Make a targeted edit to an existing file by replacing an exact string. " +
      "old_string must match the file exactly and be unique, unless replace_all " +
      "is true. Read the file first so you know the exact text.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to edit, inside the sandbox." },
        old_string: { type: "string", description: "Exact text to find." },
        new_string: { type: "string", description: "Text to replace it with." },
        replace_all: {
          type: "boolean",
          description: "Replace every occurrence instead of requiring uniqueness. Default false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  summarize: (args) => `edit ${args.path}`,
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
    const oldStr = typeof args.old_string === "string" ? args.old_string : "";
    const newStr = typeof args.new_string === "string" ? args.new_string : "";
    if (!oldStr) return null;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    const count = text.split(oldStr).length - 1;
    if (count === 0) return null;
    const replaceAll = optBool(args, "replace_all", false);
    if (count > 1 && !replaceAll) return null;
    const updated = replaceAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, newStr);
    return formatDiff(text, updated);
  },
  async run(args, ctx) {
    const path = ctx.permissions.resolveWithin(reqString(args, "path"), true);
    const oldStr = reqString(args, "old_string");
    const newStr = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = optBool(args, "replace_all", false);
    if (oldStr === newStr) {
      return { ok: false, output: "old_string and new_string are identical — nothing to do." };
    }

    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      return { ok: false, output: `Could not read file: ${(e as Error).message}` };
    }

    const count = text.split(oldStr).length - 1;
    if (count === 0) {
      return { ok: false, output: "old_string was not found in the file." };
    }
    if (count > 1 && !replaceAll) {
      return {
        ok: false,
        output: `old_string matches ${count} times. Make it unique, or pass replace_all: true.`,
      };
    }

    const updated = replaceAll
      ? text.split(oldStr).join(newStr)
      : text.replace(oldStr, newStr);
    try {
      writeFileSync(path, updated, "utf8");
    } catch (e) {
      return { ok: false, output: `Write failed: ${(e as Error).message}` };
    }
    return { ok: true, output: `Edited ${args.path} — replaced ${count} occurrence(s).` };
  },
};
