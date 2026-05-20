import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";
import type { PermissionRuleConfig } from "./types.js";

// Permission rules: wildcard allow / ask / deny rules evaluated before the
// coarse autoApprove tiers. Configured rules come from agent.config.json;
// learned rules are added when the operator answers "always" to a confirm
// prompt, and are persisted so prompt fatigue drops over time.

const RULES_FILE = join(USER_DIR, "rules.json");

export type RuleAction = "allow" | "ask" | "deny";

/** Convert a glob (with * and ?) to an anchored, case-insensitive RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function loadLearned(): PermissionRuleConfig[] {
  try {
    const data = JSON.parse(readFileSync(RULES_FILE, "utf8"));
    if (Array.isArray(data)) return data as PermissionRuleConfig[];
  } catch {
    // no learned rules yet
  }
  return [];
}

function saveLearned(rules: PermissionRuleConfig[]): void {
  try {
    mkdirSync(USER_DIR, { recursive: true });
    writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

export class PermissionRules {
  private learned: PermissionRuleConfig[];

  constructor(private readonly configured: PermissionRuleConfig[]) {
    this.learned = loadLearned();
  }

  /**
   * Evaluate a tool call against the rules. The pattern (a glob) is tested
   * against the call summary. Returns the first matching action, or null.
   */
  evaluate(tool: string, summary: string): RuleAction | null {
    for (const rule of [...this.configured, ...this.learned]) {
      if (rule.tool !== "*" && rule.tool !== tool) continue;
      if (rule.pattern) {
        try {
          if (!globToRegExp(rule.pattern).test(summary)) continue;
        } catch {
          continue; // a malformed glob never matches
        }
      }
      return rule.action;
    }
    return null;
  }

  /** Add a learned rule and persist it. */
  remember(rule: PermissionRuleConfig): void {
    this.learned.push(rule);
    saveLearned(this.learned);
  }

  /** Configured + learned rules, for /rules. */
  list(): { configured: PermissionRuleConfig[]; learned: PermissionRuleConfig[] } {
    return { configured: [...this.configured], learned: [...this.learned] };
  }

  /** Forget every learned rule. Returns how many were cleared. */
  clearLearned(): number {
    const n = this.learned.length;
    this.learned = [];
    saveLearned([]);
    return n;
  }
}
