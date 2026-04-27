import { eventHandler, getQuery } from "vinxi/http"
import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  ".output",
  ".cache",
  ".pnpm",
  ".DS_Store",
  "__pycache__",
  ".venv",
  ".bun",
  ".context",
])
const MAX_FILES = 5000

function walkDir(dir: string, baseDir: string): string[] {
  const paths: string[] = []

  function walk(current: string) {
    if (paths.length >= MAX_FILES) return
    let names: string[]
    try {
      names = readdirSync(current) as unknown as string[]
    } catch {
      return
    }

    for (const name of names) {
      if (paths.length >= MAX_FILES) return
      if (IGNORE.has(name)) continue

      const fullPath = join(current, name)
      let isDir = false
      try {
        isDir = statSync(fullPath).isDirectory()
      } catch {
        continue
      }

      const relPath = relative(baseDir, fullPath)
      if (isDir) {
        paths.push(relPath + "/")
        walk(fullPath)
      } else {
        paths.push(relPath)
      }
    }
  }

  walk(dir)
  return paths
}

export const GET = eventHandler((event) => {
  const query = getQuery(event)
  const root = (query.root as string) || process.cwd()

  const paths = walkDir(root, root)
  return { paths }
})
