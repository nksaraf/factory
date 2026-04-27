import { eventHandler, getQuery } from "vinxi/http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  html: "html",
  sql: "sql",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  txt: "text",
  env: "text",
  lock: "text",
}

export const GET = eventHandler((event) => {
  const query = getQuery(event)
  const filePath = query.path as string
  const root = (query.root as string) || process.cwd()

  if (!filePath) {
    return { error: "path is required" }
  }

  const fullPath = join(root, filePath)

  if (!existsSync(fullPath)) {
    return { error: `File not found: ${filePath}` }
  }

  const stat = statSync(fullPath)
  if (stat.isDirectory()) {
    return { error: `Path is a directory: ${filePath}` }
  }
  if (stat.size > 512 * 1024) {
    return { error: `File too large: ${filePath} (${stat.size} bytes)` }
  }

  const content = readFileSync(fullPath, "utf-8")
  const ext = extname(filePath).slice(1)

  return {
    path: filePath,
    content,
    language: LANG_MAP[ext] ?? "text",
  }
})
