/**
 * .gitignore management for dx-pkg-managed entries.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const MARKER = "# dx-pkg-managed"

/**
 * Strip a trailing slash — gitignore patterns ending in "/" only match
 * directories, so a tracked symlink (git mode 120000) would slip past.
 * Dropping the slash matches both directories and symlinks.
 */
function normalize(relPath: string): string {
  return relPath.endsWith("/") ? relPath.slice(0, -1) : relPath
}

/**
 * Append a dx-pkg-managed entry to .gitignore. Writes the marker comment on
 * its own line (git treats `#` as a comment only at the start of a line).
 */
export function addGitignoreEntry(root: string, relPath: string): void {
  const gitignore = join(root, ".gitignore")
  const path = normalize(relPath)

  let content = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : ""
  if (matchesEntry(content, path)) return
  if (content && !content.endsWith("\n")) content += "\n"

  content += `${MARKER}\n${path}\n`
  writeFileSync(gitignore, content)
}

/** Remove a dx-pkg-managed entry from .gitignore. */
export function removeGitignoreEntry(root: string, relPath: string): void {
  const gitignore = join(root, ".gitignore")
  if (!existsSync(gitignore)) return

  const path = normalize(relPath)
  const lines = readFileSync(gitignore, "utf8").split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Drop a marker immediately followed by the managed path
    if (line.trimEnd() === MARKER && lines[i + 1]?.trim() === path) {
      i++
      continue
    }
    // Legacy format: "<path>  # dx-pkg-managed" on one line
    if (
      line.includes(MARKER) &&
      (line.includes(path) || line.includes(relPath))
    ) {
      continue
    }
    out.push(line)
  }
  writeFileSync(gitignore, out.join("\n"))
}

/** True if `path` is present as a standalone gitignore line. */
function matchesEntry(content: string, path: string): boolean {
  return content.split("\n").some((l) => l.trim() === path)
}
