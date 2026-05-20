import type { AgentConfig, Tool, ToolSchema } from "../types.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { listDirTool } from "./listDir.js";
import { grepTool } from "./grep.js";
import { runShellTool } from "./runShell.js";
import { searchDocsTool } from "./searchDocs.js";
import { repoMapTool } from "./repoMap.js";
import { rememberTool, recallTool } from "./memory.js";

export interface ToolRegistry {
  schemas: ToolSchema[];
  get(name: string): Tool | undefined;
  names(): string[];
}

/**
 * Assemble the tool set for a config. `search_docs` is only included when
 * RAG is enabled, so the model never sees a tool it cannot use.
 */
export function buildToolRegistry(cfg: AgentConfig): ToolRegistry {
  const tools: Tool[] = [readFileTool, listDirTool, grepTool, repoMapTool, rememberTool, recallTool];
  if (cfg.rag.enabled) tools.push(searchDocsTool);
  tools.push(editFileTool, writeFileTool, runShellTool);

  const byName = new Map(tools.map((t) => [t.schema.name, t]));
  return {
    schemas: tools.map((t) => t.schema),
    get: (name) => byName.get(name),
    names: () => tools.map((t) => t.schema.name),
  };
}
