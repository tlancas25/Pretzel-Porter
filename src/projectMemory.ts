import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";

// Project memory: a PRETZEL.md briefing loaded into the system prompt every
// session. A global file (~/.pretzel-porter/PRETZEL.md) holds cross-project
// preferences; a per-directory file holds facts about that project. Keeping
// durable context here means the operator does not re-explain it each run.

const FILENAME = "PRETZEL.md";

/**
 * Load global + project memory. Returns "" when neither file exists.
 * The result is meant to be appended to the system prompt verbatim.
 */
export function loadProjectMemory(cwd: string): string {
  const sources = [
    { label: "Global notes (~/.pretzel-porter/PRETZEL.md)", path: join(USER_DIR, FILENAME) },
    { label: `Project notes (${cwd}/${FILENAME})`, path: join(cwd, FILENAME) },
  ];
  const blocks: string[] = [];
  for (const s of sources) {
    if (!existsSync(s.path)) continue;
    try {
      const text = readFileSync(s.path, "utf8").trim();
      if (text) blocks.push(`### ${s.label}\n${text}`);
    } catch {
      // unreadable — skip silently
    }
  }
  return blocks.join("\n\n");
}

const TEMPLATE = `# Project notes for Pretzel Porter

<!-- Pretzel Porter loads this file into context at the start of every session.
     Keep it short and factual — it is an always-on briefing, not documentation.
     Delete these comments once you have filled it in. -->

## What this project / directory is


## Conventions and preferences


## Things to remember
`;

/** Create a starter PRETZEL.md in `cwd`. Returns a status string. */
export function initProjectMemory(cwd: string): string {
  const path = join(cwd, FILENAME);
  if (existsSync(path)) return `${FILENAME} already exists here — left untouched.`;
  try {
    writeFileSync(path, TEMPLATE, "utf8");
    return `Created ${FILENAME}. Edit it, then /reload (or restart) to load it into context.`;
  } catch (e) {
    return `Could not create ${FILENAME}: ${(e as Error).message}`;
  }
}
