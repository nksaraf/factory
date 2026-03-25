/**
 * .gitignore management for dx-pkg-managed entries.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MARKER = "# dx-pkg-managed";

/** Append a dx-pkg-managed entry to .gitignore. */
export function addGitignoreEntry(root: string, relPath: string): void {
  const gitignore = join(root, ".gitignore");
  const entry = `${relPath}  ${MARKER}`;

  let content = "";
  if (existsSync(gitignore)) {
    content = readFileSync(gitignore, "utf8");
    if (content.includes(entry)) return;
    if (!content.endsWith("\n")) content += "\n";
  }

  content += `${entry}\n`;
  writeFileSync(gitignore, content);
}

/** Remove a dx-pkg-managed entry from .gitignore. */
export function removeGitignoreEntry(root: string, relPath: string): void {
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) return;

  const lines = readFileSync(gitignore, "utf8").split("\n");
  const filtered = lines.filter(
    (line) => !(line.includes(relPath) && line.includes(MARKER))
  );
  writeFileSync(gitignore, filtered.join("\n"));
}
