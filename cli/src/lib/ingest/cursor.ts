/**
 * Cursor AI tracking SQLite parser.
 * Reads ~/.cursor/ai-tracking/ai-code-tracking.db.
 * Adapted from scripts/ingest/cursor.ts.
 */
import { Database } from "bun:sqlite"

import {
  type IngestEvent,
  type IngestOptions,
  type IngestResult,
  getCursorDbPath,
  normalizeModel,
  resolveRepoContext,
} from "./common.js"
import {
  extractCursorPlans,
  getCursorPlansDir,
} from "./cursor-plan-extractor.js"
import { sendBatch, uploadDocument } from "./send.js"

// ── Types ────────────────────────────────────────────────────

type ConversationSummary = {
  conversationId: string
  model: string
  sources: string[]
  fileExtensions: string[]
  fileNames: string[]
  codeHashCount: number
  startedAt: number
  endedAt: number
}

type ScoredCommitRow = {
  commitHash: string
  branchName: string
  scoredAt: number
  linesAdded: number | null
  linesDeleted: number | null
  tabLinesAdded: number | null
  tabLinesDeleted: number | null
  composerLinesAdded: number | null
  composerLinesDeleted: number | null
  humanLinesAdded: number | null
  humanLinesDeleted: number | null
  blankLinesAdded: number | null
  blankLinesDeleted: number | null
  commitMessage: string | null
  commitDate: string | null
  v1AiPercentage: string | null
  v2AiPercentage: string | null
}

// ── DB access ────────────────────────────────────────────────

function openCursorDb(): Database {
  const dbPath = getCursorDbPath()
  if (!dbPath) {
    throw new Error("Cursor tracking database not found")
  }
  return new Database(dbPath, { readonly: true })
}

function queryConversations(db: Database, since?: Date): ConversationSummary[] {
  let sql = `
    SELECT
      conversationId,
      GROUP_CONCAT(DISTINCT model) as models,
      GROUP_CONCAT(DISTINCT source) as sources,
      GROUP_CONCAT(DISTINCT fileExtension) as fileExtensions,
      GROUP_CONCAT(DISTINCT fileName) as fileNames,
      COUNT(*) as codeHashCount,
      MIN(timestamp) as startedAt,
      MAX(timestamp) as endedAt
    FROM ai_code_hashes
    WHERE conversationId IS NOT NULL AND conversationId != ''
  `
  const params: any[] = []
  if (since) {
    sql += ` AND timestamp >= ?`
    params.push(since.getTime())
  }
  sql += ` GROUP BY conversationId ORDER BY MIN(timestamp)`

  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map((r) => ({
    conversationId: r.conversationId,
    model:
      (r.models as string)
        ?.split(",")
        .filter((m: string) => m && m !== "")[0] ?? "unknown",
    sources: (r.sources as string)?.split(",").filter(Boolean) ?? [],
    fileExtensions:
      (r.fileExtensions as string)?.split(",").filter(Boolean) ?? [],
    fileNames: (r.fileNames as string)?.split(",").filter(Boolean) ?? [],
    codeHashCount: r.codeHashCount,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  }))
}

function queryScoredCommits(db: Database, since?: Date): ScoredCommitRow[] {
  let sql = `SELECT * FROM scored_commits`
  const params: any[] = []
  if (since) {
    sql += ` WHERE scoredAt >= ?`
    params.push(since.getTime())
  }
  sql += ` ORDER BY scoredAt`
  return db.prepare(sql).all(...params) as ScoredCommitRow[]
}

// ── Event building ───────────────────────────────────────────

function buildConversationEvents(convos: ConversationSummary[]): IngestEvent[] {
  return convos.map((c) => {
    const absFile = c.fileNames.find((f) => f.startsWith("/"))
    const repoCtx = absFile
      ? resolveRepoContext(absFile.replace(/\/[^/]+$/, ""))
      : {}

    return {
      source: "cursor" as const,

      deliveryId: `cursor-session-${c.conversationId}`,
      eventType: "thread.summary",
      sessionId: c.conversationId,
      timestamp: new Date(c.startedAt).toISOString(),
      cwd: absFile ? absFile.replace(/\/[^/]+$/, "") : undefined,
      project: repoCtx.repoSlug,
      payload: {
        sessionId: c.conversationId,
        model: normalizeModel(c.model),
        gitRemoteUrl: repoCtx.gitRemoteUrl,
        repoSlug: repoCtx.repoSlug,
        repoName: repoCtx.repoName,
        startedAt: new Date(c.startedAt).toISOString(),
        endedAt: new Date(c.endedAt).toISOString(),
        durationMinutes: Math.round((c.endedAt - c.startedAt) / 60000),
        codeHashCount: c.codeHashCount,
        sources: c.sources,
        fileExtensions: c.fileExtensions,
        filesModified: c.fileNames.slice(0, 100),
      },
    }
  })
}

function buildCommitEvents(commits: ScoredCommitRow[]): IngestEvent[] {
  return commits.map((c) => ({
    source: "cursor" as const,
    providerId: "local-backfill",
    deliveryId: `cursor-commit-${c.commitHash}-${c.branchName}`,
    eventType: "commit.scored",
    sessionId: c.commitHash,
    timestamp: c.commitDate ?? new Date(c.scoredAt).toISOString(),
    payload: {
      commitHash: c.commitHash,
      branchName: c.branchName,
      commitMessage: c.commitMessage,
      commitDate: c.commitDate,
      linesAdded: c.linesAdded,
      linesDeleted: c.linesDeleted,
      aiContribution: {
        tabLinesAdded: c.tabLinesAdded,
        tabLinesDeleted: c.tabLinesDeleted,
        composerLinesAdded: c.composerLinesAdded,
        composerLinesDeleted: c.composerLinesDeleted,
        humanLinesAdded: c.humanLinesAdded,
        humanLinesDeleted: c.humanLinesDeleted,
        v1AiPercentage: c.v1AiPercentage,
        v2AiPercentage: c.v2AiPercentage,
      },
    },
  }))
}

// ── Public API ───────────────────────────────────────────────

export function countConversations(): number {
  const dbPath = getCursorDbPath()
  if (!dbPath) return 0
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .prepare(
        "SELECT COUNT(DISTINCT conversationId) as cnt FROM ai_code_hashes WHERE conversationId IS NOT NULL AND conversationId != ''"
      )
      .get() as any
    db.close()
    return row?.cnt ?? 0
  } catch {
    return 0
  }
}

// ── Plan upload ──────────────────────────────────────────────

async function uploadCursorPlans(opts: {
  dryRun: boolean
  verbose: boolean
}): Promise<{ uploaded: number; duplicates: number; errors: number }> {
  const plans = extractCursorPlans()
  if (plans.length === 0) return { uploaded: 0, duplicates: 0, errors: 0 }

  console.error(`  Found ${plans.length} Cursor plans`)

  let uploaded = 0
  let duplicates = 0
  let errors = 0

  for (const plan of plans) {
    try {
      const completedTodos = plan.todos.filter(
        (t) => t.status === "completed"
      ).length
      const totalTodos = plan.todos.length

      const result = await uploadDocument({
        path: `plan/${plan.slug}/current.md`,
        content: plan.content,
        type: "plan",
        source: "cursor",
        title: plan.title,
        contentHash: plan.contentHash,
        spec: {
          title: plan.title,
          slug: plan.slug,
          overview: plan.overview,
          isProject: plan.isProject,
          todosTotal: totalTodos,
          todosCompleted: completedTodos,
          todoItems: plan.todos,
        },
        dryRun: opts.dryRun,
      })
      if (result.duplicate) {
        duplicates++
      } else {
        uploaded++
      }
    } catch (err) {
      if (opts.verbose) {
        console.error(`  [cursor-plan-err] ${plan.slug}: ${err}`)
      }
      errors++
    }
  }

  return { uploaded, duplicates, errors }
}

// ── Public API ───────────────────────────────────────────────

export async function ingestCursor(opts: IngestOptions): Promise<IngestResult> {
  const db = openCursorDb()

  try {
    const conversations = queryConversations(db, opts.since)
    console.error(`  Found ${conversations.length} conversations`)

    const commits = queryScoredCommits(db, opts.since)
    console.error(`  Found ${commits.length} scored commits`)

    const conversationEvents = buildConversationEvents(conversations)
    const commitEvents = buildCommitEvents(commits)

    let allEvents = [...conversationEvents, ...commitEvents]
    if (allEvents.length > opts.limit) {
      allEvents = allEvents.slice(0, opts.limit)
    }

    console.error(
      `  Parsed ${allEvents.length} events (${conversationEvents.length} sessions, ${commitEvents.length} commits)`
    )

    const result = await sendBatch(allEvents, opts)

    // Upload Cursor plans
    if (getCursorPlansDir()) {
      const planResult = await uploadCursorPlans({
        dryRun: opts.dryRun,
        verbose: opts.verbose,
      })
      console.error(
        `  Plans: ${planResult.uploaded} uploaded, ${planResult.duplicates} duplicates, ${planResult.errors} errors`
      )
    }

    return result
  } finally {
    db.close()
  }
}
