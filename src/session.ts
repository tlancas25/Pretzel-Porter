import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";
import type { Message } from "./types.js";

// Session persistence: each conversation is written to a JSON file under
// ~/.pretzel-porter/sessions/ after every turn, so it survives a crash and
// can be resumed later. JSON rather than SQLite keeps the project free of
// native dependencies and the store trivially inspectable — and fully offline.

const SESSION_DIR = join(USER_DIR, "sessions");

export interface SessionMeta {
  id: string;
  created: string;
  updated: string;
  turns: number;
  /** First user message, trimmed — shown in the resume picker. */
  preview: string;
}

interface SessionFile extends SessionMeta {
  messages: Message[];
}

/** A filesystem-safe id from the current timestamp. */
export function newSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Write the conversation to disk. Best-effort — never throws. */
export function saveSession(id: string, messages: Message[]): void {
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
    const userMessages = messages.filter((m) => m.role === "user");
    const existing = loadSession(id);
    const data: SessionFile = {
      id,
      created: existing?.created ?? new Date().toISOString(),
      updated: new Date().toISOString(),
      turns: userMessages.length,
      preview: (userMessages[0]?.content ?? "").replace(/\s+/g, " ").slice(0, 80),
      messages,
    };
    writeFileSync(join(SESSION_DIR, `${id}.json`), JSON.stringify(data), "utf8");
  } catch {
    // session persistence is best-effort
  }
}

/** Load a session by id, or null if it is missing or unreadable. */
export function loadSession(id: string): SessionFile | null {
  try {
    const data = JSON.parse(readFileSync(join(SESSION_DIR, `${id}.json`), "utf8")) as SessionFile;
    if (Array.isArray(data.messages)) return data;
  } catch {
    // missing or corrupt
  }
  return null;
}

/** All saved sessions, most recently updated first. */
export function listSessions(): SessionMeta[] {
  if (!existsSync(SESSION_DIR)) return [];
  let files: string[];
  try {
    files = readdirSync(SESSION_DIR);
  } catch {
    return [];
  }
  const sessions: SessionMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const s = loadSession(file.slice(0, -5));
    if (s) {
      sessions.push({
        id: s.id,
        created: s.created,
        updated: s.updated,
        turns: s.turns,
        preview: s.preview,
      });
    }
  }
  return sessions.sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Delete a saved session. Returns true if it existed. */
export function deleteSession(id: string): boolean {
  try {
    unlinkSync(join(SESSION_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
