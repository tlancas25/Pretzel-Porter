import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Tool } from "../types.js";
import { reqString } from "./util.js";

export const writeFileTool: Tool = {
  risk: "write",
  schema: {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing one with the " +
      "given content. Parent directories are created as needed. For small " +
      "changes to an existing file, prefer edit_file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Destination path inside the sandbox." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
  },
  summarize: (args) => {
    const bytes = Buffer.byteLength(String(args.content ?? ""), "utf8");
    return `write ${args.path} (${bytes} bytes)`;
  },
  async run(args, ctx) {
    const path = ctx.permissions.resolveWithin(reqString(args, "path"));
    const content = reqString(args, "content");
    if (existsSync(path) && statSync(path).isDirectory()) {
      return { ok: false, output: `"${args.path}" is a directory.` };
    }
    const existed = existsSync(path);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    } catch (e) {
      return { ok: false, output: `Write failed: ${(e as Error).message}` };
    }
    const bytes = Buffer.byteLength(content, "utf8");
    return {
      ok: true,
      output: `${existed ? "Overwrote" : "Created"} ${args.path} (${bytes} bytes).`,
    };
  },
};
