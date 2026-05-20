import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";

// Persistent agent memory: durable notes the agent accumulates across sessions,
// stored as append-only JSONL under ~/.pretzel-porter/memory/. This is the
// agent's own long-term scratchpad (e.g. learned facts about how the operator's
// finances are organised) — separate from PRETZEL.md, which the operator owns.

const MEM_DIR = join(USER_DIR, "memory");
const MEM_FILE = join(MEM_DIR, "notes.jsonl");

export interface Note {
  id: string;
  ts: string;
  text: string;
}

function readAll(): Note[] {
  if (!existsSync(MEM_FILE)) return [];
  try {
    return readFileSync(MEM_FILE, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Note)
      .filter((n) => n && typeof n.text === "string");
  } catch {
    return [];
  }
}

/** Append a note. Returns the stored note. */
export function remember(text: string): Note {
  const note: Note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    text: text.trim(),
  };
  mkdirSync(MEM_DIR, { recursive: true });
  appendFileSync(MEM_FILE, JSON.stringify(note) + "\n", "utf8");
  return note;
}

/**
 * Return notes most relevant to `query` (keyword overlap), most-recent-first
 * on ties. An empty query returns the most recent notes.
 */
export function recall(query: string, limit = 8): Note[] {
  const all = readAll();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return all.slice(-limit).reverse();

  const scored = all.map((n) => {
    const hay = n.text.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    return { n, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.n.ts.localeCompare(a.n.ts))
    .slice(0, limit)
    .map((s) => s.n);
}

/** Every stored note, oldest first. */
export function allNotes(): Note[] {
  return readAll();
}

/** Delete a note by id. Returns true if it existed. */
export function forget(id: string): boolean {
  const all = readAll();
  const kept = all.filter((n) => n.id !== id);
  if (kept.length === all.length) return false;
  mkdirSync(MEM_DIR, { recursive: true });
  writeFileSync(MEM_FILE, kept.map((n) => JSON.stringify(n)).join("\n") + (kept.length ? "\n" : ""), "utf8");
  return true;
}
