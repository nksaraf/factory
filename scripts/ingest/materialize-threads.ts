#!/usr/bin/env bun
/**
 * Materialize webhook_events into org.channel + org.thread + org.thread_turn.
 *
 * Merges conductor and claude-code data for the same session into a single thread.
 * Conductor-workspace channels are canonical — claude-code sessions in workspace
 * paths are assigned to the matching conductor-workspace channel.
 *
 * Usage:
 *   bun run scripts/ingest/materialize-threads.ts [--dry-run] [--verbose] [--since 2026-01-01]
 */
import { Database as SQLiteDB } from "bun:sqlite"
import { and, eq, inArray, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  channel,
  thread,
  threadTurn,
  webhookEvent,
} from "../../api/src/db/schema/org"
import { newId } from "../../api/src/lib/id"
import { parseArgs } from "./lib/common"

// ── DB connection ─────────────────────────────────────────────

function getDbUrl(): string {
  return (
    process.env.DATABASE_URL ??
    process.env.FACTORY_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:54111/postgres"
  )
}

const db = drizzle(getDbUrl())

// ── Types ─────────────────────────────────────────────────────

type SessionEvent = {
  id: string
  source: string
  providerId: string
  deliveryId: string
  actorId: string | null
  spec: Record<string, any>
  createdAt: Date
}

type TurnEvent = SessionEvent

// ── Conductor workspace lookup ────────────────────────────────

type WorkspaceInfo = {
  workspaceId: string
  directoryName: string
  repoName: string
  repoSlug?: string
  rootPath: string
}

/**
 * Build a lookup from workspace directory paths to workspace info.
 * Uses Conductor's SQLite DB to map cwd → workspace.
 */
function buildWorkspaceLookup(): Map<string, WorkspaceInfo> {
  const lookup = new Map<string, WorkspaceInfo>()
  const dbPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.conductor.app",
    "conductor.db"
  )
  if (!statSync(dbPath, { throwIfNoEntry: false })) return lookup

  const sdb = new SQLiteDB(dbPath, { readonly: true })
  try {
    const rows = sdb
      .prepare(
        `
      SELECT w.id, w.directory_name, r.root_path, r.name as repo_name, r.remote_url
      FROM workspaces w
      LEFT JOIN repos r ON w.repository_id = r.id
      WHERE w.directory_name IS NOT NULL
    `
      )
      .all() as any[]

    for (const r of rows) {
      if (!r.root_path || !r.directory_name) continue
      // Workspace path pattern: ~/conductor/workspaces/{repo_name}/{directory_name}
      const wsPath = join(
        homedir(),
        "conductor",
        "workspaces",
        r.repo_name,
        r.directory_name
      )
      const repoSlug = r.remote_url ? extractRepoSlug(r.remote_url) : undefined
      lookup.set(wsPath, {
        workspaceId: r.id,
        directoryName: r.directory_name,
        repoName: r.repo_name,
        repoSlug,
        rootPath: r.root_path,
      })
    }
  } finally {
    sdb.close()
  }

  console.error(
    `Loaded ${lookup.size} workspace path mappings from Conductor DB`
  )
  return lookup
}

function extractRepoSlug(url: string): string | undefined {
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return match?.[1]
}

// ── Channel resolution ────────────────────────────────────────

type ChannelInfo = {
  kind: string
  externalId: string
  name?: string
  repoSlug?: string
}
type ChannelKey = string // "kind:externalId"

function channelKey(kind: string, externalId: string): ChannelKey {
  return `${kind}:${externalId}`
}

function resolveChannelInfo(
  source: string,
  payload: Record<string, any>,
  wsLookup: Map<string, WorkspaceInfo>
): ChannelInfo | null {
  // Conductor sessions: always use conductor-workspace channel
  if (source === "conductor") {
    const workspaceId = payload.workspaceId
    if (workspaceId) {
      return {
        kind: "conductor-workspace",
        externalId: workspaceId,
        name: payload.directoryName ?? workspaceId,
        repoSlug: payload.repoSlug,
      }
    }
  }

  // Claude-code and Cursor: check if cwd is a conductor workspace
  const cwd = payload.cwd
  if (!cwd) return null

  const ws = wsLookup.get(cwd)
  if (ws) {
    // This session ran inside a Conductor workspace — use workspace channel
    return {
      kind: "conductor-workspace",
      externalId: ws.workspaceId,
      name: ws.directoryName,
      repoSlug: ws.repoSlug ?? payload.repoSlug,
    }
  }

  // Not a workspace path — use ide channel
  return {
    kind: "ide",
    externalId: cwd,
    name: cwd.split("/").slice(-2).join("/"),
    repoSlug: payload.repoSlug,
  }
}

// ── Thread mapping ────────────────────────────────────────────

type ThreadData = {
  type: string
  source: string
  externalId: string
  status: string
  channelId: string | null
  repoSlug: string | null
  branch: string | null
  startedAt: Date
  endedAt: Date | null
  spec: Record<string, any>
}

function mapSessionToThread(
  event: SessionEvent,
  channelId: string | null
): ThreadData {
  const p = event.spec.payload ?? event.spec
  const source = event.source
  const sessionId = p.sessionId ?? event.deliveryId

  const startedAt = p.startedAt ? new Date(p.startedAt) : event.createdAt
  const endedAt = p.endedAt ? new Date(p.endedAt) : null
  const status = endedAt ? "completed" : "active"

  return {
    type: "ide-session",
    source,
    externalId: sessionId,
    status,
    channelId,
    repoSlug: p.repoSlug ?? null,
    branch: p.gitBranch ?? p.branch ?? null,
    startedAt,
    endedAt,
    spec: {
      title: p.title,
      model: p.model,
      cwd: p.cwd,
      gitRemoteUrl: p.gitRemoteUrl,
      repoName: p.repoName,
      durationMinutes: p.durationMinutes,
      turnCount: p.turnCount,
      tokenUsage: p.tokenUsage,
      toolsUsed: p.toolsUsed,
      toolCallCount: p.toolCallCount,
      toolErrorCount: p.toolErrorCount,
      toolErrorsByTool: p.toolErrorsByTool,
      toolErrorsByClass: p.toolErrorsByClass,
      version: p.version,
      permissionMode: p.permissionMode,
      // Conductor-specific
      workspaceId: p.workspaceId,
      directoryName: p.directoryName,
      targetBranch: p.targetBranch,
      prTitle: p.prTitle,
      workspaceState: p.workspaceState,
      agentType: p.agentType,
      // Cursor-specific
      cursorSources: p.sources,
      fileExtensions: p.fileExtensions,
      filesModified: p.filesModified,
      codeHashCount: p.codeHashCount,
      // Provenance
      webhookEventId: event.id,
      backfilledAt: new Date().toISOString(),
    },
  }
}

/** Truncate a string to maxLen characters. */
function trunc(s: unknown, maxLen = 2000): string | undefined {
  if (typeof s !== "string") return undefined
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s
}

/** Truncate tool call inputs to keep spec size reasonable. */
function truncToolCalls(calls: any[] | undefined): any[] | undefined {
  if (!Array.isArray(calls)) return calls
  return calls.slice(0, 50).map((tc) => ({
    name: tc.name,
    input: trunc(
      typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
      200
    ),
  }))
}

function mapTurnToThreadTurn(
  event: TurnEvent,
  threadId: string
): {
  threadId: string
  turnIndex: number
  role: string
  spec: Record<string, any>
} {
  const p = event.spec.payload ?? event.spec
  return {
    threadId,
    turnIndex: p.turnIndex ?? 0,
    role: "user",
    spec: {
      prompt: trunc(p.prompt, 2000),
      responseSummary: trunc(p.responseSummary, 2000),
      model: p.model,
      tokenUsage: p.tokenUsage,
      toolCalls: truncToolCalls(p.toolCalls),
      toolErrors: p.toolErrors?.slice(0, 20),
      timestamp: p.timestamp,
    },
  }
}

/**
 * Merge conductor spec enrichments into an existing thread spec.
 * Conductor has: title, workspaceId, agentType, targetBranch, prTitle, workspaceState.
 */
function mergeCondcutorSpec(
  existing: Record<string, any>,
  conductor: Record<string, any>
): Record<string, any> {
  return {
    ...existing,
    // Conductor enrichments (prefer conductor values for these fields)
    title: conductor.title ?? existing.title,
    workspaceId: conductor.workspaceId ?? existing.workspaceId,
    directoryName: conductor.directoryName ?? existing.directoryName,
    agentType: conductor.agentType ?? existing.agentType,
    targetBranch: conductor.targetBranch ?? existing.targetBranch,
    prTitle: conductor.prTitle ?? existing.prTitle,
    workspaceState: conductor.workspaceState ?? existing.workspaceState,
    // Track both sources
    sources: [
      ...new Set([
        ...(existing.sources ?? [existing.webhookEventId ? "claude-code" : ""]),
        "conductor",
      ]),
    ].filter(Boolean),
    conductorWebhookEventId: conductor.webhookEventId,
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const opts = parseArgs(args)

  console.error("=== Materialize Threads from Webhook Events ===")
  if (opts.dryRun) console.error("Mode: DRY RUN")
  if (opts.since) console.error(`Since: ${opts.since.toISOString()}`)
  console.error()

  // Build workspace lookup from Conductor DB
  const wsLookup = buildWorkspaceLookup()

  // Step 1: Fetch all thread.summary events
  console.error("Fetching thread.summary events...")
  const sessionEvents = (await db
    .select()
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.eventType, "thread.summary"),
        inArray(webhookEvent.source, ["claude-code", "conductor", "cursor"])
      )
    )
    .orderBy(webhookEvent.createdAt)) as SessionEvent[]

  console.error(`Found ${sessionEvents.length} session events`)

  // Step 2: Fetch all thread_turn.completed events
  console.error("Fetching thread_turn.completed events...")
  const turnEvents = (await db
    .select()
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.eventType, "thread_turn.completed"),
        inArray(webhookEvent.source, ["claude-code", "conductor", "cursor"])
      )
    )
    .orderBy(webhookEvent.createdAt)) as TurnEvent[]

  console.error(`Found ${turnEvents.length} turn events`)

  // Group turn events by sessionId + source for fast lookup
  type TurnKey = string // "source:sessionId"
  const turnsByKey = new Map<TurnKey, TurnEvent[]>()
  for (const te of turnEvents) {
    const p = te.spec?.payload ?? te.spec
    const sid = p?.sessionId
    if (!sid) continue
    const key = `${te.source}:${sid}`
    if (!turnsByKey.has(key)) turnsByKey.set(key, [])
    turnsByKey.get(key)!.push(te)
  }

  // Group session events by sessionId to detect overlaps
  const sessionsByExternalId = new Map<string, SessionEvent[]>()
  for (const se of sessionEvents) {
    const p = se.spec?.payload ?? se.spec
    const sessionId = p.sessionId ?? se.deliveryId
    if (!sessionsByExternalId.has(sessionId))
      sessionsByExternalId.set(sessionId, [])
    sessionsByExternalId.get(sessionId)!.push(se)
  }

  // Identify overlapping sessions (same external_id from multiple sources)
  const overlappingSessions = new Set<string>()
  for (const [sid, events] of sessionsByExternalId) {
    const sources = new Set(events.map((e) => e.source))
    if (sources.size > 1) overlappingSessions.add(sid)
  }
  console.error(
    `Found ${overlappingSessions.size} overlapping sessions (conductor + claude-code)`
  )

  // Step 3: Upsert channels (dedup by kind + external_id)
  console.error("\nUpserting channels...")
  const channelMap = new Map<ChannelKey, string>() // key → channel id
  let channelsCreated = 0
  let channelsSkipped = 0

  for (const se of sessionEvents) {
    const p = se.spec?.payload ?? se.spec
    const info = resolveChannelInfo(se.source, p, wsLookup)
    if (!info) continue

    const key = channelKey(info.kind, info.externalId)
    if (channelMap.has(key)) continue

    if (opts.dryRun) {
      channelMap.set(key, newId("chan"))
      channelsCreated++
      if (opts.verbose)
        console.error(`  [dry] channel ${info.kind}:${info.name}`)
      continue
    }

    const existing = await db
      .select({ id: channel.id })
      .from(channel)
      .where(
        and(
          eq(channel.kind, info.kind),
          eq(channel.externalId, info.externalId)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      channelMap.set(key, existing[0].id)
      channelsSkipped++
      continue
    }

    const [row] = await db
      .insert(channel)
      .values({
        kind: info.kind,
        externalId: info.externalId,
        name: info.name,
        repoSlug: info.repoSlug,
        spec: {
          cwd: info.kind === "ide" ? info.externalId : undefined,
          gitRemoteUrl: p.gitRemoteUrl,
          lastActiveAt: se.createdAt,
        } as any,
      })
      .returning({ id: channel.id })

    channelMap.set(key, row.id)
    channelsCreated++
    if (opts.verbose)
      console.error(`  [new] channel ${info.kind}:${info.name} → ${row.id}`)
  }

  console.error(
    `Channels: ${channelsCreated} created, ${channelsSkipped} existing`
  )

  // Step 4: Create threads and turns (with merging)
  //
  // Strategy: Process events grouped by external_id.
  // For overlapping sessions, create ONE thread using the richest data:
  // - Conductor provides: title, workspaceId, agentType, prTitle, targetBranch
  // - Claude-code provides: richer turn data (tool calls from JSONL), subagent info, version
  // - For turns: prefer claude-code source (richer data); fall back to conductor
  // - Source field: use "claude-code" when we have JSONL data, "conductor" when conductor-only

  console.error("\nCreating threads and turns...")
  let threadsCreated = 0
  let threadsSkipped = 0
  let threadsMerged = 0
  let turnsCreated = 0
  let turnsSkipped = 0

  const processedSessions = new Set<string>()
  // Track created thread IDs for subagent parent linking
  const sessionToThreadId = new Map<string, string>()

  for (let i = 0; i < sessionEvents.length; i++) {
    const se = sessionEvents[i]
    const p = se.spec?.payload ?? se.spec
    const sessionId = p.sessionId ?? se.deliveryId

    // Skip if we already processed this session (from the other source)
    if (processedSessions.has(sessionId)) continue
    processedSessions.add(sessionId)

    const isOverlapping = overlappingSessions.has(sessionId)
    const allEvents = sessionsByExternalId.get(sessionId) ?? [se]

    // Find the conductor and claude-code events for this session
    const conductorEvent = allEvents.find((e) => e.source === "conductor")
    const ccEvent = allEvents.find((e) => e.source === "claude-code")
    const cursorEvent = allEvents.find((e) => e.source === "cursor")

    // Pick the primary event: prefer claude-code for richer data, then conductor, then cursor
    const primaryEvent = ccEvent ?? conductorEvent ?? cursorEvent ?? se
    const primaryPayload = primaryEvent.spec.payload ?? primaryEvent.spec

    // Resolve channel using primary event
    const chanInfo = resolveChannelInfo(
      primaryEvent.source,
      primaryPayload,
      wsLookup
    )
    let channelId: string | null = null
    if (chanInfo) {
      channelId =
        channelMap.get(channelKey(chanInfo.kind, chanInfo.externalId)) ?? null
    }
    // If primary didn't resolve a channel, try conductor's workspace channel
    if (!channelId && conductorEvent) {
      const condPayload = conductorEvent.spec.payload ?? conductorEvent.spec
      const condChanInfo = resolveChannelInfo(
        "conductor",
        condPayload,
        wsLookup
      )
      if (condChanInfo) {
        channelId =
          channelMap.get(
            channelKey(condChanInfo.kind, condChanInfo.externalId)
          ) ?? null
      }
    }

    // Build merged thread data
    const threadData = mapSessionToThread(primaryEvent, channelId)

    // If overlapping, merge conductor enrichments into spec
    if (isOverlapping && conductorEvent && primaryEvent !== conductorEvent) {
      const condData = mapSessionToThread(conductorEvent, channelId)
      threadData.spec = mergeCondcutorSpec(threadData.spec, condData.spec)
      // Use conductor's channel if primary didn't resolve one
      if (!threadData.channelId) threadData.channelId = condData.channelId
    }

    // For merged threads, set source to "claude-code" (has richer data)
    if (isOverlapping) {
      threadData.source = ccEvent ? "claude-code" : "conductor"
    }

    if (opts.dryRun) {
      threadsCreated++
      if (isOverlapping) threadsMerged++
      continue
    }

    // Check if thread already exists
    const existing = await db
      .select({ id: thread.id })
      .from(thread)
      .where(and(eq(thread.externalId, threadData.externalId)))
      .limit(1)

    if (existing.length > 0) {
      threadsSkipped++
      sessionToThreadId.set(sessionId, existing[0].id)
      continue
    }

    // Insert thread
    let threadRow: { id: string }
    try {
      const [row] = await db
        .insert(thread)
        .values({
          type: threadData.type,
          source: threadData.source,
          externalId: threadData.externalId,
          principalId: null,
          status: threadData.status,
          channelId: threadData.channelId,
          repoSlug: threadData.repoSlug,
          branch: threadData.branch,
          startedAt: threadData.startedAt,
          endedAt: threadData.endedAt,
          spec: threadData.spec as any,
        })
        .returning({ id: thread.id })
      threadRow = row
    } catch (err: any) {
      console.error(
        `  [warn] thread insert failed for ${threadData.source}:${sessionId}: ${err.message?.slice(0, 200) ?? err}`
      )
      continue
    }

    threadsCreated++
    if (isOverlapping) threadsMerged++
    sessionToThreadId.set(sessionId, threadRow.id)

    // Insert turns — prefer claude-code turns (richer), fall back to conductor
    const ccTurns = turnsByKey.get(`claude-code:${sessionId}`) ?? []
    const condTurns = turnsByKey.get(`conductor:${sessionId}`) ?? []
    const sessionTurns = ccTurns.length > 0 ? ccTurns : condTurns

    for (const te of sessionTurns) {
      const turnData = mapTurnToThreadTurn(te, threadRow.id)
      try {
        await db.insert(threadTurn).values(turnData as any)
        turnsCreated++
      } catch (err: any) {
        console.error(
          `  [warn] turn insert failed for thread ${threadRow.id} turn ${turnData.turnIndex}: ${err.message?.slice(0, 200) ?? err}`
        )
      }
    }

    if (opts.verbose || (i + 1) % 50 === 0 || i + 1 === sessionEvents.length) {
      const mergeTag = isOverlapping ? " [merged]" : ""
      console.error(
        `  [${processedSessions.size}/${sessionsByExternalId.size}] ${threadData.source}:${sessionId} → ${threadRow.id} (${sessionTurns.length} turns)${mergeTag}`
      )
    }
  }

  // Step 5: Create subagent threads
  console.error("\nFetching subagent.summary events...")
  const subagentEvents = (await db
    .select()
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.eventType, "thread.subagent_summary"),
        inArray(webhookEvent.source, ["claude-code"])
      )
    )
    .orderBy(webhookEvent.createdAt)) as SessionEvent[]

  console.error(`Found ${subagentEvents.length} subagent events`)

  let subagentThreadsCreated = 0
  let subagentThreadsSkipped = 0
  let subagentTurnsCreated = 0

  // Also load any existing thread mappings for parent linking
  if (!opts.dryRun) {
    const allThreads = await db
      .select({ id: thread.id, externalId: thread.externalId })
      .from(thread)
      .where(eq(thread.type, "ide-session"))
    for (const t of allThreads) {
      if (t.externalId && !sessionToThreadId.has(t.externalId)) {
        sessionToThreadId.set(t.externalId, t.id)
      }
    }
  }

  for (let i = 0; i < subagentEvents.length; i++) {
    const se = subagentEvents[i]
    const p = se.spec?.payload ?? se.spec
    const parentSessionId = p.parentSessionId
    const subagentIndex = p.subagentIndex ?? 0
    const externalId = `${parentSessionId}-subagent-${subagentIndex}`

    if (opts.dryRun) {
      subagentThreadsCreated++
      subagentTurnsCreated++
      continue
    }

    // Check if already exists
    const existing = await db
      .select({ id: thread.id })
      .from(thread)
      .where(
        and(eq(thread.source, "claude-code"), eq(thread.externalId, externalId))
      )
      .limit(1)

    if (existing.length > 0) {
      subagentThreadsSkipped++
      continue
    }

    const parentThreadId = sessionToThreadId.get(parentSessionId) ?? null

    // Resolve channel — use workspace lookup
    let channelId: string | null = null
    if (p.cwd) {
      const ws = wsLookup.get(p.cwd)
      if (ws) {
        const key = channelKey("conductor-workspace", ws.workspaceId)
        channelId = channelMap.get(key) ?? null
      } else {
        const key = channelKey("ide", p.cwd)
        channelId = channelMap.get(key) ?? null
      }
    }

    const startedAt = p.timestamp ? new Date(p.timestamp) : se.createdAt

    let threadRow: { id: string }
    try {
      const [row] = await db
        .insert(thread)
        .values({
          type: "autonomous",
          source: "claude-code",
          externalId,
          principalId: null,
          status: "completed",
          channelId,
          repoSlug: p.repoSlug ?? null,
          branch: p.gitBranch ?? null,
          startedAt,
          endedAt: startedAt,
          parentThreadId,
          spec: {
            title: p.description,
            subagentType: p.subagentType,
            resultLength: p.resultLength,
            cwd: p.cwd,
            gitRemoteUrl: p.gitRemoteUrl,
            repoName: p.repoName,
            webhookEventId: se.id,
            backfilledAt: new Date().toISOString(),
          } as any,
        })
        .returning({ id: thread.id })
      threadRow = row
    } catch (err: any) {
      console.error(
        `  [warn] subagent thread insert failed for ${externalId}: ${err.message?.slice(0, 200) ?? err}`
      )
      continue
    }

    subagentThreadsCreated++

    try {
      await db.insert(threadTurn).values({
        threadId: threadRow.id,
        turnIndex: 0,
        role: "user",
        spec: {
          prompt: trunc(p.prompt, 4000),
          responseSummary: trunc(p.resultSummary, 4000),
          timestamp: p.timestamp,
        } as any,
      })
      subagentTurnsCreated++
    } catch (err: any) {
      console.error(
        `  [warn] subagent turn insert failed for ${threadRow.id}: ${err.message?.slice(0, 200) ?? err}`
      )
    }

    if (
      opts.verbose ||
      (i + 1) % 100 === 0 ||
      i + 1 === subagentEvents.length
    ) {
      console.error(
        `  [${i + 1}/${subagentEvents.length}] subagent ${p.subagentType}:${p.description?.slice(0, 40)} → ${threadRow.id}`
      )
    }
  }

  console.error(`\n=== Results ===`)
  console.error(
    `Channels:         ${channelsCreated} created, ${channelsSkipped} existing`
  )
  console.error(
    `Threads:          ${threadsCreated} created, ${threadsSkipped} existing (${threadsMerged} merged from conductor+claude-code)`
  )
  console.error(
    `Turns:            ${turnsCreated} created, ${turnsSkipped} existing`
  )
  console.error(
    `Subagent threads: ${subagentThreadsCreated} created, ${subagentThreadsSkipped} existing`
  )
  console.error(`Subagent turns:   ${subagentTurnsCreated} created`)
}

main().catch((err) => {
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
