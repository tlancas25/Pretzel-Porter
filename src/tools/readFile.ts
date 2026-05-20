import { readFileSync } from "node:fs";
import type { Tool } from "../types.js";
import { reqString, clamp, looksBinary } from "./util.js";

export const readFileTool: Tool = {
  risk: "read",
  schema: {
    name: "read_file",
    description:
      "Read the contents of a text file inside the sandbox. Returns the file " +
      "with line numbers. Use this before editing a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file, relative to the sandbox root or absolute." },
      },
      required: ["path"],
    },
  },
  summarize: (args) => `read ${args.path}`,
  async run(args, ctx) {
    const path = ctx.permissions.resolveWithin(reqString(args, "path"));
    let buf: Buffer;
    try {
      buf = readFileSync(path);
    } catch (e) {
      return { ok: false, output: `Could not read file: ${(e as Error).message}` };
    }
    if (looksBinary(buf)) {
      return { ok: false, output: `"${args.path}" looks like a binary file — not reading it as text.` };
    }
    const truncated = buf.length > ctx.maxReadBytes;
    const text = buf.subarray(0, ctx.maxReadBytes).toString("utf8");
    const numbered = text
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(5)}  ${line}`)
      .join("\n");
    const note = truncated ? `\n… [file truncated at ${ctx.maxReadBytes} bytes]` : "";
    return { ok: true, output: numbered + note };
  },
};
