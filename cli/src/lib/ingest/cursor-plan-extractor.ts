/**
 * Cursor plan extractor — reads ~/.cursor/plans/*.plan.md files.
 *
 * Cursor plans are markdown files with YAML frontmatter containing
 * name, overview, todos (with id/content/status), and isProject flag.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

// ── Types ────────────────────────────────────────────────────

export type CursorPlan = {
  slug: string
  title: string
  overview: string
  content: string
  contentHash: string
  filePath: string
  todos: CursorPlanTodo[]
  isProject: boolean
  sizeBytes: number
}

export type CursorPlanTodo = {
  id: string
  content: string
  status: string
}

// ── Path detection ───────────────────────────────────────────

export function getCursorPlansDir(): string | null {
  const dir = join(homedir(), ".cursor", "plans")
  return existsSync(dir) ? dir : null
}

// ── Frontmatter parser ───────────────────────────────────────

function parseFrontmatter(content: string): {
  meta: Record<string, unknown>
  body: string
} {
  if (!content.startsWith("---")) {
    return { meta: {}, body: content }
  }

  const endIdx = content.indexOf("\n---", 3)
  if (endIdx === -1) {
    return { meta: {}, body: content }
  }

  const yamlBlock = content.slice(4, endIdx)
  const body = content.slice(endIdx + 4).trim()

  // Simple YAML parser for the structured frontmatter we expect
  const meta: Record<string, unknown> = {}
  let currentKey = ""
  let currentArray: Record<string, string>[] | null = null
  let currentItem: Record<string, string> | null = null

  for (const line of yamlBlock.split("\n")) {
    // Top-level key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)$/)
    if (kvMatch) {
      // Flush any pending array
      if (currentArray && currentKey) {
        if (currentItem) currentArray.push(currentItem)
        meta[currentKey] = currentArray
      }
      currentArray = null
      currentItem = null

      const [, key, value] = kvMatch
      currentKey = key

      if (value === "") {
        // Could be start of array or multiline
        continue
      }
      // Boolean
      if (value === "true" || value === "false") {
        meta[key] = value === "true"
        continue
      }
      // String (strip quotes if present)
      meta[key] = value.replace(/^["']|["']$/g, "")
      continue
    }

    // Array item start: "  - id: xxx"
    const arrayItemStart = line.match(/^\s+-\s+(\w+):\s*(.*)$/)
    if (arrayItemStart) {
      if (!currentArray) currentArray = []
      if (currentItem) currentArray.push(currentItem)
      currentItem = {
        [arrayItemStart[1]]: arrayItemStart[2].replace(/^["']|["']$/g, ""),
      }
      continue
    }

    // Nested key in array item: "    content: xxx"
    const nestedKv = line.match(/^\s{4,}(\w+):\s*(.*)$/)
    if (nestedKv && currentItem) {
      currentItem[nestedKv[1]] = nestedKv[2].replace(/^["']|["']$/g, "")
      continue
    }
  }

  // Flush final array
  if (currentArray && currentKey) {
    if (currentItem) currentArray.push(currentItem)
    meta[currentKey] = currentArray
  }

  return { meta, body }
}

// ── Main extraction ──────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

export function extractCursorPlans(): CursorPlan[] {
  const dir = getCursorPlansDir()
  if (!dir) return []

  const files = readdirSync(dir).filter((f) => f.endsWith(".plan.md"))
  const plans: CursorPlan[] = []

  for (const file of files) {
    const filePath = join(dir, file)
    const content = readFileSync(filePath, "utf-8")
    const { meta, body } = parseFrontmatter(content)

    const slug = basename(file, ".plan.md")
    const title = (meta.name as string) ?? slug
    const overview = (meta.overview as string) ?? ""
    const isProject = (meta.isProject as boolean) ?? false

    const rawTodos = Array.isArray(meta.todos)
      ? (meta.todos as Record<string, string>[])
      : []
    const todos: CursorPlanTodo[] = rawTodos.map((t) => ({
      id: t.id ?? "",
      content: t.content ?? "",
      status: t.status ?? "pending",
    }))

    plans.push({
      slug,
      title,
      overview,
      content,
      contentHash: sha256(content),
      filePath,
      todos,
      isProject,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
    })
  }

  return plans
}
