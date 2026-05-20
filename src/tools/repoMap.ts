import type { Tool } from "../types.js";
import { buildRepoMap } from "../repomap.js";
import { clamp } from "./util.js";

export const repoMapTool: Tool = {
  risk: "read",
  schema: {
    name: "repo_map",
    description:
      "Produce a structured outline of the project: each source file with its " +
      "top-level functions, classes, types, and other declarations. Use this " +
      "early to understand an unfamiliar codebase before reading whole files.",
    parameters: { type: "object", properties: {} },
  },
  summarize: () => "build repo map",
  async run(_args, ctx) {
    return { ok: true, output: clamp(buildRepoMap(ctx.cwd, 12_000), 14_000) };
  },
};
