import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Persistent cross-session state, stored in ~/.pretzel-porter/state.json.
 * Holds which directories the user has trusted and the last model used —
 * so Pretzel Porter does not re-ask things it already knows.
 */
const DIR = join(homedir(), ".pretzel-porter");
const FILE = join(DIR, "state.json");

export interface AppState {
  /** Absolute directory paths the user has approved Pretzel Porter to work in. */
  trustedDirs: string[];
  /** Model tag selected on the most recent run. */
  lastModel?: string;
}

export function loadState(): AppState {
  try {
    if (existsSync(FILE)) {
      const s = JSON.parse(readFileSync(FILE, "utf8")) as Partial<AppState>;
      return {
        trustedDirs: Array.isArray(s.trustedDirs) ? s.trustedDirs.filter((d) => typeof d === "string") : [],
        lastModel: typeof s.lastModel === "string" ? s.lastModel : undefined,
      };
    }
  } catch {
    // Corrupt state file — start fresh rather than crash.
  }
  return { trustedDirs: [] };
}

export function saveState(state: AppState): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // Persistence is best-effort; never fail the session over it.
  }
}
