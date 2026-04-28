/**
 * Plan file path classification, shared between the IDE-hook ingestion path
 * (which captures Write/Edit) and the threads endpoint (which infers plans
 * referenced by Read/Bash/Grep/Edit to cross-link sessions to plans authored
 * elsewhere).
 */

export type PlanPathClass = {
  slug: string
  basename: string
  source: "claude-code" | "superpowers" | "context-plan"
}

/**
 * Match a plan file path to a known plan-authoring directory.
 * Returns a qualified slug + source, or null if not a plan.
 *
 * Patterns (leading slash optional, handles absolute and relative paths):
 *   .../.claude/plans/<name>.md            → claude-code:<name>
 *   .../docs/superpowers/plans/<name>.md   → superpowers:<project>:<name>
 *   .../.context/plans/<name>.md           → context-plan:<project>:<name>
 */
export function classifyPlanPath(filePath: string): PlanPathClass | null {
  if (!filePath.endsWith(".md")) return null

  const mClaude = filePath.match(/(?:^|\/)\.claude\/plans\/([^/]+)\.md$/)
  if (mClaude) {
    return {
      slug: `claude-code:${mClaude[1]}`,
      basename: mClaude[1],
      source: "claude-code",
    }
  }

  const mSuper = filePath.match(
    /(?:^|\/)([^/]+)\/docs\/superpowers\/plans\/([^/]+)\.md$/
  )
  if (mSuper) {
    return {
      slug: `superpowers:${mSuper[1]}:${mSuper[2]}`,
      basename: mSuper[2],
      source: "superpowers",
    }
  }

  const mCtx = filePath.match(/(?:^|\/)([^/]+)\/\.context\/plans\/([^/]+)\.md$/)
  if (mCtx) {
    return {
      slug: `context-plan:${mCtx[1]}:${mCtx[2]}`,
      basename: mCtx[2],
      source: "context-plan",
    }
  }

  return null
}

/**
 * Extract every plan-file path referenced by a tool invocation's input.
 *
 * Handles:
 *  - Write/Edit/Read: `file_path`, `target_file`, `path`
 *  - Grep:  `path` scoped directory (we only match plan files, not dirs)
 *  - Bash:  scan the command string for `.md` paths under known plan roots
 *
 * Returns deduplicated, classified matches.
 */
export function extractPlanReferences(toolInput: unknown): PlanPathClass[] {
  const results = new Map<string, PlanPathClass>()

  const tryAdd = (raw: unknown) => {
    if (typeof raw !== "string") return
    const cls = classifyPlanPath(raw)
    if (cls) results.set(cls.slug, cls)
  }

  const parsed: Record<string, unknown> = (() => {
    if (!toolInput) return {}
    if (typeof toolInput === "string") {
      try {
        return JSON.parse(toolInput) as Record<string, unknown>
      } catch {
        return { __raw: toolInput }
      }
    }
    if (typeof toolInput === "object")
      return toolInput as Record<string, unknown>
    return {}
  })()

  tryAdd(parsed.file_path)
  tryAdd(parsed.target_file)
  tryAdd(parsed.path)
  tryAdd(parsed.notebook_path)

  // Bash / free-text: scan for any path ending in .md that matches a plan root.
  // Lead anchor `(?:^|[\s'"=:/])` requires a path-boundary character before the
  // match so we don't match `my.claude/plans/...` when `my` precedes `.claude`.
  const freeText = [parsed.command, parsed.__raw]
    .filter((v) => typeof v === "string")
    .join("\n")
  if (freeText) {
    const re =
      /(?:^|[\s'"=:])((?:[\w./-]*\/)?(?:\.claude\/plans|\.context\/plans|docs\/superpowers\/plans)\/[A-Za-z0-9._-]+\.md)/g
    for (const m of freeText.matchAll(re)) tryAdd(m[1])
  }

  return Array.from(results.values())
}
