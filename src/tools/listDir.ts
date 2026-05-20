import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Tool } from "../types.js";
import { optString, clamp } from "./util.js";

export const listDirTool: Tool = {
  risk: "read",
  schema: {
    name: "list_dir",
    description: "List the files and subdirectories of a directory inside the sandbox.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list. Defaults to the sandbox root." },
      },
    },
  },
  summarize: (args) => `list ${args.path ?? "."}`,
  async run(args, ctx) {
    const dir = ctx.permissions.resolveWithin(optString(args, "path", "."));
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (e) {
      return { ok: false, output: `Could not list directory: ${(e as Error).message}` };
    }
    entries.sort();

    const lines: string[] = [];
    for (const name of entries) {
      try {
        const st = statSync(join(dir, name));
        if (st.isDirectory()) lines.push(`  ${name}/`);
        else lines.push(`  ${name}  (${st.size} bytes)`);
      } catch {
        lines.push(`  ${name}  (unreadable)`);
      }
    }
    const body = lines.length ? lines.join("\n") : "  (empty)";
    return { ok: true, output: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}:\n${clamp(body, 8000)}` };
  },
};
