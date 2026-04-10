/**
 * Plan extractor — parses JSONL transcripts for plan-related tool calls.
 *
 * Extracts:
 * - ExitPlanMode snapshots (full plan content + title)
 * - Edit/Write operations targeting ~/.claude/plans/ files
 *
 * Implements title-change detection to decide whether a title shift
 * means a new document or a version of the existing one.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename } from "node:path"

import { fixLocalTimestamp } from "./common.js"

// ── Types ────────────────────────────────────────────────────

export type PlanSnapshot = {
  slug: string
  title: string
  content: string
  planFilePath: string
  sessionId: string
  project: string
  version: number
  contentHash: string
  timestamp: string
}

export type PlanEditSummary = {
  slug: string
  sessionId: string
  editCount: number
}

export type PlanExtractionResult = {
  snapshots: PlanSnapshot[]
  edits: PlanEditSummary[]
}

// ── Title-change detection ────────────────────────────────────

/**
 * Determine if a title change is an evolution (append/trim) or a
 * completely different document.
 *
 * Returns true if the new title is an evolution of the old one
 * (appended to end, or trimmed from end).
 */
export function isTitleEvolution(oldTitle: string, newTitle: string): boolean {
  const a = oldTitle.toLowerCase().trim().replace(/\s+/g, " ")
  const b = newTitle.toLowerCase().trim().replace(/\s+/g, " ")
  if (a === b) return true
  if (b.startsWith(a)) return true
  if (a.startsWith(b)) return true
  return false
}

// ── Helpers ────────────────────────────────────────────────────

function extractSlugFromPath(planFilePath: string): string {
  // ~/.claude/plans/vivid-imagining-noodle.md → vivid-imagining-noodle
  return basename(planFilePath, ".md")
}

function extractTitleFromContent(content: string): string {
  // First line starting with # is the title
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("# ")) {
      return trimmed
        .replace(/^#+\s*/, "") // remove heading markers
        .replace(/^Plan:\s*/i, "") // strip "Plan:" prefix if present
        .trim()
    }
  }
  return "Untitled"
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

// ── Main extraction ──────────────────────────────────────────

export function extractPlansFromTranscript(
  jsonlPath: string,
  sessionId: string,
  project: string
): PlanExtractionResult {
  const text = readFileSync(jsonlPath, "utf8")
  const lines = text.split("\n").filter((l) => l.trim())

  const snapshots: PlanSnapshot[] = []
  const editCounts = new Map<string, number>()
  const seenHashes = new Set<string>()

  for (const line of lines) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    // Look for tool_use entries in assistant messages
    const content = entry?.message?.content ?? entry?.data?.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (block?.type !== "tool_use") continue

      const toolName = block.name as string
      const input = block.input as Record<string, unknown> | undefined
      if (!input) continue

      // ExitPlanMode → plan snapshot
      if (toolName === "ExitPlanMode") {
        // The plan content comes from the plan file, which was written before ExitPlanMode
        // ExitPlanMode itself doesn't carry the plan content — we need to look at
        // the Write/Edit calls that preceded it to get the plan file path
        // However, the plan file path is in the system prompt. Let's check if there's
        // a planFilePath in the input or if we can derive it from context.

        // Actually, ExitPlanMode has no meaningful input params — the plan was
        // already written to the plan file. We need to track the plan file from
        // preceding Write calls. Skip for now and handle via Write/Edit tracking below.
        continue
      }

      // Write to a plan file → capture full content as snapshot
      if (toolName === "Write" && typeof input.file_path === "string") {
        const filePath = input.file_path as string
        if (!filePath.includes("/.claude/plans/")) continue
        if (typeof input.content !== "string") continue

        const slug = extractSlugFromPath(filePath)
        const planContent = input.content as string
        const hash = sha256(planContent)

        // Count edits
        editCounts.set(slug, (editCounts.get(slug) ?? 0) + 1)

        // Deduplicate by content hash
        if (seenHashes.has(hash)) continue
        seenHashes.add(hash)

        const title = extractTitleFromContent(planContent)
        snapshots.push({
          slug,
          title,
          content: planContent,
          planFilePath: filePath,
          sessionId,
          project,
          version: 0, // assigned later during grouping
          contentHash: hash,
          timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
        })
      }

      // Edit to a plan file → count edit
      if (toolName === "Edit" && typeof input.file_path === "string") {
        const filePath = input.file_path as string
        if (!filePath.includes("/.claude/plans/")) continue
        const slug = extractSlugFromPath(filePath)
        editCounts.set(slug, (editCounts.get(slug) ?? 0) + 1)
      }
    }
  }

  const edits: PlanEditSummary[] = []
  for (const [slug, editCount] of editCounts) {
    edits.push({ slug, sessionId, editCount })
  }

  return { snapshots, edits }
}

// ── Grouping across sessions ─────────────────────────────────

export type GroupedPlan = {
  slug: string
  title: string
  versions: PlanSnapshot[]
  totalEdits: number
  sessionsInvolved: string[]
  titleHistory: string[]
}

/**
 * Group plan snapshots across multiple sessions into documents,
 * applying title-change detection to split into separate documents
 * when titles change significantly.
 */
export function groupPlanSnapshots(
  allSnapshots: PlanSnapshot[],
  allEdits: PlanEditSummary[]
): GroupedPlan[] {
  // Group by slug first
  const bySlug = new Map<string, PlanSnapshot[]>()
  for (const s of allSnapshots) {
    const list = bySlug.get(s.slug) ?? []
    list.push(s)
    bySlug.set(s.slug, list)
  }

  // Edit totals by slug
  const editTotals = new Map<string, number>()
  const sessionsBySlug = new Map<string, Set<string>>()
  for (const e of allEdits) {
    editTotals.set(e.slug, (editTotals.get(e.slug) ?? 0) + e.editCount)
    const set = sessionsBySlug.get(e.slug) ?? new Set()
    set.add(e.sessionId)
    sessionsBySlug.set(e.slug, set)
  }
  for (const s of allSnapshots) {
    const set = sessionsBySlug.get(s.slug) ?? new Set()
    set.add(s.sessionId)
    sessionsBySlug.set(s.slug, set)
  }

  const plans: GroupedPlan[] = []

  for (const [slug, slugSnapshots] of bySlug) {
    // Sort snapshots by timestamp
    slugSnapshots.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    // Split into document groups based on title changes
    const groups: PlanSnapshot[][] = []
    let currentGroup: PlanSnapshot[] = []
    let currentTitle = ""

    for (const snap of slugSnapshots) {
      if (currentGroup.length === 0) {
        currentGroup.push(snap)
        currentTitle = snap.title
      } else if (isTitleEvolution(currentTitle, snap.title)) {
        currentGroup.push(snap)
        currentTitle = snap.title // update to latest title evolution
      } else {
        // Significant title change → start new document group
        groups.push(currentGroup)
        currentGroup = [snap]
        currentTitle = snap.title
      }
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      const titleHistory = [...new Set(group.map((s) => s.title))]
      const latestTitle = group[group.length - 1].title

      // Assign version numbers
      for (let i = 0; i < group.length; i++) {
        group[i].version = i + 1
      }

      // If multiple groups for same slug, suffix the slug for additional ones
      const effectiveSlug =
        groups.length > 1 && gi > 0 ? `${slug}-v${gi + 1}` : slug

      plans.push({
        slug: effectiveSlug,
        title: latestTitle,
        versions: group,
        totalEdits: gi === 0 ? (editTotals.get(slug) ?? 0) : 0,
        sessionsInvolved: [...(sessionsBySlug.get(slug) ?? [])],
        titleHistory,
      })
    }
  }

  return plans
}
