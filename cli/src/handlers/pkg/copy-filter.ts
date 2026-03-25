/**
 * File copy filtering — .gitignore/.dxignore-aware copy with hardcoded exclusions.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".turbo",
  "__pycache__",
  "build",
  ".next",
  ".dx",
  ".venv",
  "target",
]);

const EXCLUDE_PATTERNS = ["*.pyc", "*.pyo", ".DS_Store"];

/** Simple fnmatch-style pattern matching (supports * and ? only). */
function fnmatch(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

/**
 * Build an ignore function for use with fs.cpSync's filter callback.
 *
 * Combines hardcoded exclusions + .gitignore + .dxignore patterns.
 */
export function buildCopyFilter(
  pkgDir: string
): (src: string) => boolean {
  const extraPatterns: string[] = [];

  for (const ignoreFile of [".gitignore", ".dxignore"]) {
    const ignorePath = join(pkgDir, ignoreFile);
    if (existsSync(ignorePath)) {
      const text = readFileSync(ignorePath, "utf8");
      for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line && !line.startsWith("#")) {
          extraPatterns.push(line.replace(/\/$/, ""));
        }
      }
    }
  }

  /**
   * Filter function for fs.cpSync: return true to INCLUDE, false to EXCLUDE.
   */
  return (src: string): boolean => {
    const name = basename(src);

    // Check hardcoded directory exclusions
    if (EXCLUDE_DIRS.has(name)) return false;

    // Check hardcoded pattern exclusions
    for (const pat of EXCLUDE_PATTERNS) {
      if (fnmatch(name, pat)) return false;
    }

    // Check .gitignore/.dxignore patterns
    for (const pat of extraPatterns) {
      if (fnmatch(name, pat)) return false;
    }

    return true;
  };
}
