import { realpathSync, existsSync } from "node:fs";
import { resolve, dirname, sep, isAbsolute, relative } from "node:path";
import type { PermissionChecker } from "./types.js";

/**
 * The sandbox. Every filesystem path a tool touches is run through
 * `resolveWithin`, which guarantees the result sits inside one of the
 * configured roots — even across `..` segments and symlinks.
 */
export class Permissions implements PermissionChecker {
  private readonly allowedRoots: string[];

  /** @param allowed  paths from config; relative ones resolve against `base`. */
  constructor(allowed: string[], base: string) {
    if (allowed.length === 0) throw new Error("permissions: no allowed paths configured");
    const resolved = allowed.map((p) => {
      const abs = isAbsolute(p) ? p : resolve(base, p);
      // Resolve symlinks on the root itself so containment checks are honest.
      return existsSync(abs) ? realpathSync(abs) : resolve(abs);
    });
    this.allowedRoots = [...new Set(resolved)];
  }

  roots(): string[] {
    return [...this.allowedRoots];
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
   */
  resolveWithin(inputPath: string): string {
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
    const real = existsSync(existing)
      ? resolve(realpathSync(existing), ...tail)
      : abs;

    const ok = this.allowedRoots.some((root) => this.contains(root, real));
    if (!ok) {
      throw new Error(
        `path "${inputPath}" is outside the sandbox. Allowed roots:\n  ${this.allowedRoots.join("\n  ")}`,
      );
    }
    return real;
  }
}
