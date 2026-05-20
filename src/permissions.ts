import { realpathSync, existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, relative } from "node:path";
import type { PermissionChecker } from "./types.js";

/**
 * The sandbox. Every filesystem path a tool touches is run through
 * `resolveWithin`, which guarantees the result sits inside one of the
 * configured roots — even across `..` segments and symlinks.
 *
 * Two tiers of root:
 *   - allowed roots   — readable and writable
 *   - read-only roots — readable, but mutating tools are rejected
 */
export class Permissions implements PermissionChecker {
  private readonly allowedRoots: string[];
  private readonly readOnly: string[];

  /**
   * @param allowed   writable paths; relative ones resolve against `base`.
   * @param base      directory relative paths resolve against.
   * @param readOnly  reference paths the agent may read but not modify.
   */
  constructor(allowed: string[], base: string, readOnly: string[] = []) {
    if (allowed.length === 0) throw new Error("permissions: no allowed paths configured");
    const resolveAll = (paths: string[]): string[] =>
      paths.map((p) => {
        const abs = isAbsolute(p) ? p : resolve(base, p);
        // Resolve symlinks on the root itself so containment checks are honest.
        return existsSync(abs) ? realpathSync(abs) : resolve(abs);
      });
    this.allowedRoots = [...new Set(resolveAll(allowed))];
    // A read-only root already covered by a writable root is redundant.
    this.readOnly = [...new Set(resolveAll(readOnly))].filter(
      (r) => !this.allowedRoots.some((a) => this.contains(a, r)),
    );
  }

  roots(): string[] {
    return [...this.allowedRoots];
  }

  readOnlyRoots(): string[] {
    return [...this.readOnly];
  }

  /** Primary root — used as the default cwd for shell commands. */
  primaryRoot(): string {
    return this.allowedRoots[0]!;
  }

  private contains(root: string, target: string): boolean {
    if (target === root) return true;
    const rel = relative(root, target);
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  }

  /**
   * Resolve `inputPath` to an absolute path and assert it is inside the
   * sandbox. Resolves the deepest existing ancestor through `realpath` so a
   * symlink cannot be used to point outside an allowed root. Throws on escape.
   *
   * @param forWrite  when true, paths under a read-only root are rejected.
   */
  resolveWithin(inputPath: string, forWrite = false): string {
    if (typeof inputPath !== "string" || inputPath.trim() === "") {
      throw new Error("path must be a non-empty string");
    }
    const abs = isAbsolute(inputPath)
      ? resolve(inputPath)
      : resolve(this.primaryRoot(), inputPath);

    // Walk up to the nearest path that exists, realpath it, re-append the tail.
    let existing = abs;
    const tail: string[] = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break; // reached filesystem root
      tail.unshift(existing.slice(parent.length + 1));
      existing = parent;
    }
    const real = existsSync(existing) ? resolve(realpathSync(existing), ...tail) : abs;

    const inWritable = this.allowedRoots.some((root) => this.contains(root, real));
    const inReadOnly = this.readOnly.some((root) => this.contains(root, real));

    if (inWritable) return real;
    if (inReadOnly) {
      if (forWrite) {
        throw new Error(
          `path "${inputPath}" is a read-only reference path — it can be read but not modified.`,
        );
      }
      return real;
    }

    const roots = [
      ...this.allowedRoots,
      ...this.readOnly.map((r) => `${r}  (read-only)`),
    ];
    throw new Error(
      `path "${inputPath}" is outside the sandbox. Allowed roots:\n  ${roots.join("\n  ")}`,
    );
  }
}
