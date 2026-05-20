import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

// In-session undo/redo for file mutations. Before a write tool runs, the agent
// snapshots every file it is about to touch; /undo restores the previous state
// and /redo re-applies it. State lives in memory for the session — cheap, and
// it makes a less-predictable local model low-risk to let loose.

interface Snapshot {
  path: string;
  /** Whether the file existed when the snapshot was taken. */
  existed: boolean;
  content: string;
}

interface UndoEntry {
  /** Human label, e.g. "edit_file budget.md". */
  label: string;
  snapshots: Snapshot[];
}

export class UndoStore {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  /** Capture the current state of `paths` so the action can be reverted. */
  snapshot(label: string, paths: string[]): void {
    const entry = this.capture(label, paths);
    if (entry.snapshots.length === 0) return;
    this.undoStack.push(entry);
    this.redoStack = []; // a fresh action invalidates the redo history
  }

  /** Drop the most recent snapshot — used when the action did not apply. */
  discardLast(): void {
    this.undoStack.pop();
  }

  /** Revert the last mutating action. Returns its label, or null if none. */
  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const inverse = this.capture(entry.label, entry.snapshots.map((s) => s.path));
    this.apply(entry);
    this.redoStack.push(inverse);
    return entry.label;
  }

  /** Re-apply the last undone action. Returns its label, or null if none. */
  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const inverse = this.capture(entry.label, entry.snapshots.map((s) => s.path));
    this.apply(entry);
    this.undoStack.push(inverse);
    return entry.label;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private capture(label: string, paths: string[]): UndoEntry {
    const seen = new Set<string>();
    const snapshots: Snapshot[] = [];
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      if (existsSync(path)) {
        try {
          snapshots.push({ path, existed: true, content: readFileSync(path, "utf8") });
        } catch {
          // Unreadable (e.g. binary/permission) — skip; cannot snapshot it.
        }
      } else {
        snapshots.push({ path, existed: false, content: "" });
      }
    }
    return { label, snapshots };
  }

  private apply(entry: UndoEntry): void {
    for (const s of entry.snapshots) {
      if (s.existed) {
        mkdirSync(dirname(s.path), { recursive: true });
        writeFileSync(s.path, s.content, "utf8");
      } else if (existsSync(s.path)) {
        unlinkSync(s.path);
      }
    }
  }
}
