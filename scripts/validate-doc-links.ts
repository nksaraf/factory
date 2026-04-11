#!/usr/bin/env bun
/**
 * Find broken internal links in markdown files.
 *
 * Usage:
 *   bun run scripts/validate-doc-links.ts docs/
 *   bun run scripts/validate-doc-links.ts docs/ --verbose
 *
 * Checks:
 *   - [text](relative/path.md) — target file must exist
 *   - [text](relative/path.md#heading) — target file must exist (heading not checked)
 *   - Ignores external URLs (http://, https://)
 *   - Ignores anchors-only (#heading)
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname, join } from "path"
import { Glob } from "bun"

const targetDir = process.argv[2]
const verbose = process.argv.includes("--verbose")

if (!targetDir) {
  console.error("Usage: bun run scripts/validate-doc-links.ts <directory>")
  process.exit(1)
}

const resolvedDir = resolve(targetDir)

// Collect all markdown files
const mdFiles: string[] = []
const glob = new Glob("**/*.md")
for (const path of glob.scanSync({ cwd: resolvedDir })) {
  mdFiles.push(join(resolvedDir, path))
}

mdFiles.sort()

const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
const broken: { file: string; line: number; link: string; target: string }[] =
  []
let totalLinks = 0

for (const file of mdFiles) {
  const content = readFileSync(file, "utf-8")
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    let match
    linkRegex.lastIndex = 0
    while ((match = linkRegex.exec(lines[i])) !== null) {
      const linkText = match[1]
      let href = match[2]

      // Skip external links
      if (href.startsWith("http://") || href.startsWith("https://")) continue
      // Skip anchor-only links
      if (href.startsWith("#")) continue
      // Skip mailto
      if (href.startsWith("mailto:")) continue

      totalLinks++

      // Strip anchor
      const anchorIdx = href.indexOf("#")
      if (anchorIdx !== -1) {
        href = href.slice(0, anchorIdx)
      }

      // Strip query string
      const queryIdx = href.indexOf("?")
      if (queryIdx !== -1) {
        href = href.slice(0, queryIdx)
      }

      if (!href) continue // Was anchor-only after stripping

      // Resolve relative to the file's directory
      const targetPath = resolve(dirname(file), href)

      if (!existsSync(targetPath)) {
        const relFile = file.replace(resolvedDir + "/", "")
        broken.push({
          file: relFile,
          line: i + 1,
          link: `[${linkText}](${match[2]})`,
          target: href,
        })
      }
    }
  }
}

// Report
console.log("=== Doc Link Validation ===\n")
console.log(
  `Scanned ${mdFiles.length} markdown files, ${totalLinks} internal links\n`
)

if (broken.length === 0) {
  console.log("BROKEN LINKS: 0 — all internal links resolve")
} else {
  console.log(`BROKEN LINKS: ${broken.length}`)
  for (const b of broken) {
    console.log(`  ${b.file}:${b.line}`)
    if (verbose) {
      console.log(`    Link: ${b.link}`)
      console.log(`    Target: ${b.target}`)
    }
  }
}

console.log()
if (broken.length > 0) {
  process.exit(1)
}
