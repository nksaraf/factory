#!/usr/bin/env bun
/**
 * Backfill Cursor AI tracking data from ~/.cursor/ai-tracking/ai-code-tracking.db
 * into Factory webhook_events.
 *
 * Note: Cursor does NOT store full chat messages locally — only code tracking metadata.
 * We ingest: session summaries per conversation + commit score events.
 */

import { Database } from "bun:sqlite"
import { join } from "node:path"
import { homedir } from "node:os"
import { statSync } from "node:fs"
import { type IngestEvent, type IngestOptions, progress, resolveRepoContext } from "./lib/common"
import { sendBatch } from "./lib/ingest-client"

type CodeHashRow = {
  hash: string
  source: string
  fileExtension: string | null
  fileName: string | null
  conversationId: string | null
  requestId: string | null
  timestamp: number
  createdAt: number
  model: string | null
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

function openCursorDb(): Database {
  const dbPath = join(homedir(), ".cursor", "ai-tracking", "ai-code-tracking.db")
  if (!statSync(dbPath, { throwIfNoEntry: false })) {
    throw new Error(`Cursor tracking DB not found at ${dbPath}`)
  }
  return new Database(dbPath, { readonly: true })
}

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
    model: (r.models as string)?.split(",").filter((m: string) => m && m !== "")[0] ?? "unknown",
    sources: (r.sources as string)?.split(",").filter(Boolean) ?? [],
    fileExtensions: (r.fileExtensions as string)?.split(",").filter(Boolean) ?? [],
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

function buildConversationEvents(convos: ConversationSummary[]): IngestEvent[] {
  return convos.map((c) => {
    // Derive repo from first absolute file path
    const absFile = c.fileNames.find((f) => f.startsWith("/"))
    const repoCtx = absFile ? resolveRepoContext(absFile.replace(/\/[^/]+$/, "")) : {}

    return {
      source: "cursor" as const,
      providerId: "local-backfill",
      deliveryId: `cursor-session-${c.conversationId}`,
      eventType: "session.summary",
      sessionId: c.conversationId,
      timestamp: new Date(c.startedAt).toISOString(),
      cwd: absFile ? absFile.replace(/\/[^/]+$/, "") : undefined,
      project: repoCtx.repoSlug,
      payload: {
        sessionId: c.conversationId,
        model: c.model,
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

export async function ingestCursor(opts: IngestOptions) {
  console.error("Opening Cursor tracking database (read-only)...")
  const db = openCursorDb()

  try {
    const conversations = queryConversations(db, opts.since)
    console.error(`Found ${conversations.length} conversations`)

    const commits = queryScoredCommits(db, opts.since)
    console.error(`Found ${commits.length} scored commits`)

    const conversationEvents = buildConversationEvents(conversations)
    const commitEvents = buildCommitEvents(commits)

    let allEvents = [...conversationEvents, ...commitEvents]
    if (allEvents.length > opts.limit) {
      allEvents = allEvents.slice(0, opts.limit)
    }

    console.error(`\nParsed ${allEvents.length} events (${conversationEvents.length} sessions, ${commitEvents.length} commits)`)

    const result = await sendBatch(allEvents, opts)
    console.error(`Done: ${result.sent} sent, ${result.duplicates} duplicates, ${result.errors} errors`)
    return result
  } finally {
    db.close()
  }
}
