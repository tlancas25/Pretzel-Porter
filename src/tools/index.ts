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
import { todoWriteTool } from "./todoWrite.js";
import { multiEditTool } from "./multiEdit.js";
import { applyPatchTool } from "./applyPatch.js";
import { webFetchTool } from "./webFetch.js";
import { webSearchTool } from "./webSearch.js";

export interface ToolRegistry {
  schemas: ToolSchema[];
  get(name: string): Tool | undefined;
  names(): string[];
}

/**
 * Assemble the tool set for a config. `search_docs` is included only when RAG
 * is enabled, the web tools only when air-gap mode is off, and `extraTools`
 * (e.g. tools from MCP servers) are appended last — so the model never sees a
 * tool it cannot use.
 */
export function buildToolRegistry(cfg: AgentConfig, extraTools: Tool[] = []): ToolRegistry {
  const tools: Tool[] = [
    readFileTool,
    listDirTool,
    grepTool,
    repoMapTool,
    rememberTool,
    recallTool,
    todoWriteTool,
  ];
  if (cfg.rag.enabled) tools.push(searchDocsTool);
  if (!cfg.airgap) tools.push(webFetchTool, webSearchTool);
  tools.push(editFileTool, multiEditTool, writeFileTool, applyPatchTool, runShellTool);
  tools.push(...extraTools);

  const byName = new Map(tools.map((t) => [t.schema.name, t]));
  return {
    schemas: tools.map((t) => t.schema),
    get: (name) => byName.get(name),
    names: () => tools.map((t) => t.schema.name),
  };
}
