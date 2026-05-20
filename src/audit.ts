import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";

// Audit log: an append-only record of every write/shell tool action, for the
// finances use case where knowing exactly what was changed, and when, matters.
// Enabled by the auditLog config flag.

export const AUDIT_FILE = join(USER_DIR, "audit.log");

let enabled = false;

/** Turn the audit log on or off (from config at startup). */
export function setAudit(on: boolean): void {
  enabled = on;
}

export interface AuditEntry {
  tool: string;
  summary: string;
  ok: boolean;
}

/** Append one entry to the audit log. Best-effort — never throws. */
export function audit(entry: AuditEntry): void {
  if (!enabled) return;
  try {
    mkdirSync(USER_DIR, { recursive: true });
    appendFileSync(
      AUDIT_FILE,
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
      "utf8",
    );
  } catch {
    // auditing is best-effort; never break a session over it
  }
}
