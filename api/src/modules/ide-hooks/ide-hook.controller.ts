/**
 * IDE Hook Events — receives telemetry from Claude Code & Cursor hook scripts,
 * stores as org.webhook_event records linked to the authenticated principal.
 * Also dual-writes to org.channel + org.thread + org.thread_turn.
 *
 * POST  /ide-hooks/events   — ingest a hook event
 * GET   /ide-hooks/events   — query hook events (with filters)
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { channel, thread, threadTurn, webhookEvent } from "../../db/schema/org"
import { recordWebhookEvent } from "../../lib/webhook-events"
import { logger } from "../../logger"
import {
  autoAttachSlackSurface,
  detachSurfaces,
  findThreadBySessionId,
  postToSurface,
} from "../thread-surfaces/slack-surface"

const log = logger.child({ module: "ide-hooks" })

const VALID_SOURCES = ["claude-code", "cursor", "conductor"] as const

// ── Dual-write helpers ────────────────────────────────────────

/** Upsert a channel for the session's working directory or workspace.
 *
 * For conductor sessions: always uses conductor-workspace channel (keyed by workspaceId).
 * For claude-code/cursor: if the cwd is inside a conductor workspace, looks up the
 * existing conductor-workspace channel instead of creating a separate ide channel.
 */
async function upsertChannel(
  db: Database,
  source: string,
  payload: Record<string, any>
): Promise<string | null> {
  let kind: string
  let externalId: string
  let name: string | undefined
  let repoSlug: string | undefined

  if (source === "conductor" && payload.workspaceId) {
    kind = "conductor-workspace"
    externalId = payload.workspaceId
    name = payload.directoryName ?? payload.workspaceId
    repoSlug = payload.repoSlug
  } else if (payload.cwd) {
    // Check if cwd is inside a conductor workspace (~/conductor/workspaces/{repo}/{city}/...)
    // If so, merge into the conductor-workspace channel instead of creating a separate IDE channel.
    const wsMatch = payload.cwd.match(
      /\/conductor\/workspaces\/([^/]+)\/([^/]+)/
    )
    if (wsMatch) {
      const cityName = wsMatch[2]
      const wsRoot = payload.cwd.slice(
        0,
        payload.cwd.indexOf(wsMatch[0]) + wsMatch[0].length
      )

      // Look up conductor-workspace channel by city name + repo_slug for disambiguation
      const conditions = [
        eq(channel.kind, "conductor-workspace"),
        eq(channel.name, cityName),
      ]
      if (payload.repoSlug)
        conditions.push(eq(channel.repoSlug, payload.repoSlug))
      const existingWs = await (db as any)
        .select({ id: channel.id })
        .from(channel)
        .where(and(...conditions))
        .limit(1)

      if (existingWs.length > 0) {
        const patch = JSON.stringify({
          cwd: wsRoot,
          gitRemoteUrl: payload.gitRemoteUrl,
          lastActiveAt: new Date(),
        })
        await (db as any)
          .update(channel)
          .set({
            spec: sql`COALESCE(${channel.spec}, '{}'::jsonb) || ${patch}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(channel.id, existingWs[0].id))
        return existingWs[0].id
      }

      // No conductor-workspace channel yet — create an IDE channel keyed by the workspace root
      // (not the subdirectory cwd) so all sessions in the same workspace share one channel
      kind = "ide"
      externalId = wsRoot
      name = cityName
      repoSlug = payload.repoSlug
    } else {
      kind = "ide"
      externalId = payload.cwd
      name = payload.cwd.split("/").slice(-2).join("/")
      repoSlug = payload.repoSlug
    }
  } else {
    return null
  }

  // Try to find existing
  const existing = await (db as any)
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.kind, kind), eq(channel.externalId, externalId)))
    .limit(1)

  if (existing.length > 0) {
    const patch = JSON.stringify({
      cwd: kind === "ide" ? externalId : undefined,
      gitRemoteUrl: payload.gitRemoteUrl,
      lastActiveAt: new Date(),
    })
    await (db as any)
      .update(channel)
      .set({
        spec: sql`COALESCE(${channel.spec}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(channel.id, existing[0].id))
    return existing[0].id
  }

  const [row] = await (db as any)
    .insert(channel)
    .values({
      kind,
      externalId,
      name,
      repoSlug,
      spec: {
        cwd: kind === "ide" ? externalId : undefined,
        gitRemoteUrl: payload.gitRemoteUrl,
        lastActiveAt: new Date(),
      } as any,
    })
    .returning({ id: channel.id })

  return row.id
}

/** Upsert a thread from a thread.summary event. */
async function upsertThread(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string,
  channelId: string | null
): Promise<string | null> {
  const sessionId = payload.sessionId
  if (!sessionId) return null

  // Check for existing thread by externalId (regardless of source) so that
  // conductor and claude-code events for the same session merge into one thread
  const existing = await (db as any)
    .select({ id: thread.id, source: thread.source, spec: thread.spec })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (existing.length > 0) {
    const existingSpec = (existing[0].spec ?? {}) as Record<string, any>
    const newSpec = buildThreadSpec(payload)

    // Merge: conductor provides orchestrator metadata (title, workspaceId, agentType, etc.)
    // while claude-code provides richer conversation data (token usage, tool calls).
    // Prefer non-null values from the incoming payload, but preserve existing fields
    // that the new source doesn't provide.
    const mergedSpec = { ...existingSpec }
    for (const [k, v] of Object.entries(newSpec)) {
      if (v !== undefined && v !== null) mergedSpec[k] = v
    }

    // Track which sources have contributed to this thread
    const existingSources = Array.isArray(existingSpec.sources)
      ? (existingSpec.sources as string[])
      : [existing[0].source]
    if (!existingSources.includes(source)) {
      mergedSpec.sources = [...existingSources, source]
    } else {
      mergedSpec.sources = existingSources
    }

    await (db as any)
      .update(thread)
      .set({
        status: payload.endedAt ? "completed" : undefined,
        endedAt: payload.endedAt ? new Date(payload.endedAt) : undefined,
        channelId: channelId ?? undefined,
        spec: mergedSpec as any,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, existing[0].id))
    return existing[0].id
  }

  const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date()
  const endedAt = payload.endedAt ? new Date(payload.endedAt) : null

  const [row] = await (db as any)
    .insert(thread)
    .values({
      type: "ide-session",
      source,
      externalId: sessionId,
      principalId,
      status: endedAt ? "completed" : "active",
      channelId,
      repoSlug: payload.repoSlug ?? null,
      branch: payload.gitBranch ?? payload.branch ?? null,
      startedAt,
      endedAt,
      spec: { ...buildThreadSpec(payload), sources: [source] } as any,
    })
    .returning({ id: thread.id })

  return row.id
}

// ── Model normalization (mirrors cli/src/lib/ingest/common.ts) ─────

function normalizeModel(raw: string | undefined | null): string {
  if (!raw) return "unknown"
  const m = raw.trim().toLowerCase()
  if (!m || m === "unknown" || m === "<synthetic>") return "unknown"

  if (m === "opus" || m === "claude-opus-4-6") return "claude-opus-4-6"
  if (m === "sonnet" || m === "claude-sonnet-4-6") return "claude-sonnet-4-6"
  if (m.startsWith("claude-haiku-4-5")) return "claude-haiku-4-5"
  if (m.includes("opus") && m.includes("thinking")) return "claude-opus-4-6"
  if (m.startsWith("claude-")) return m

  if (
    m.startsWith("gpt-4o") ||
    m === "o3" ||
    m === "o4-mini" ||
    m.startsWith("o3-") ||
    m.startsWith("o4-")
  )
    return m
  if (m === "codex" || m.startsWith("codex-")) return m

  if (m === "default") return "cursor-default"
  if (m === "composer-2") return "cursor-composer-2"
  if (m === "composer-2-fast") return "cursor-composer-2-fast"

  if (m.startsWith("gemini-")) return m

  return m
}

function buildThreadSpec(p: Record<string, any>): Record<string, any> {
  return {
    title: p.title,
    model: normalizeModel(p.model),
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
    workspaceId: p.workspaceId,
    directoryName: p.directoryName,
    targetBranch: p.targetBranch,
    prTitle: p.prTitle,
    workspaceState: p.workspaceState,
    agentType: p.agentType,
  }
}

/** Insert a thread turn from a thread_turn.completed event. */
async function insertTurn(
  db: Database,
  source: string,
  payload: Record<string, any>
): Promise<void> {
  const sessionId = payload.sessionId
  if (!sessionId) return

  // Find the thread by externalId (regardless of source) so that turns from
  // either conductor or claude-code attach to the same merged thread
  const threads = await (db as any)
    .select({ id: thread.id })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (threads.length === 0) return // Thread not yet created; will be backfilled

  const threadId = threads[0].id
  const turnIndex = payload.turnIndex ?? 0

  // Check for existing turn (idempotent)
  const existing = await (db as any)
    .select({ id: threadTurn.id })
    .from(threadTurn)
    .where(
      and(
        eq(threadTurn.threadId, threadId),
        eq(threadTurn.turnIndex, turnIndex)
      )
    )
    .limit(1)

  if (existing.length > 0) return

  await (db as any).insert(threadTurn).values({
    threadId,
    turnIndex,
    role: "user",
    spec: {
      prompt: payload.prompt,
      responseSummary: payload.responseSummary,
      model: payload.model,
      tokenUsage: payload.tokenUsage,
      toolCalls: payload.toolCalls,
      toolErrors: payload.toolErrors,
      timestamp: payload.timestamp,
    } as any,
  })
}

// ── Live hook event handlers ──────────────────────────────

/** Create a thread from a session.start event. */
async function handleSessionStart(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const sessionId = payload.sessionId
  if (!sessionId) return

  // Check if thread already exists (idempotent)
  const existing = await (db as any)
    .select({ id: thread.id })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (existing.length > 0) return

  const channelId = await upsertChannel(db, source, payload)

  await (db as any).insert(thread).values({
    type: "ide-session",
    source,
    externalId: sessionId,
    principalId,
    status: "active",
    channelId,
    repoSlug: payload.repoSlug ?? null,
    branch: payload.gitBranch ?? payload.branch ?? null,
    startedAt: new Date(),
    spec: {
      cwd: payload.cwd,
      gitRemoteUrl: payload.gitRemoteUrl,
      repoName: payload.repoName,
      model: payload.model ? normalizeModel(payload.model) : undefined,
      permissionMode: payload.permissionMode,
      sources: [source],
    } as any,
  })
}

/** Ensure a thread exists for a session, auto-creating if needed (turn arrived before session.start). */
async function ensureThread(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<string | null> {
  const sessionId = payload.sessionId
  if (!sessionId) return null

  const existing = await (db as any)
    .select({ id: thread.id })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (existing.length > 0) return existing[0].id

  // Auto-create thread (turn arrived before session.start)
  const channelId = await upsertChannel(db, source, payload)
  const [row] = await (db as any)
    .insert(thread)
    .values({
      type: "ide-session",
      source,
      externalId: sessionId,
      principalId,
      status: "active",
      channelId,
      repoSlug: payload.repoSlug ?? null,
      branch: payload.gitBranch ?? payload.branch ?? null,
      startedAt: new Date(),
      spec: {
        cwd: payload.cwd,
        sources: [source],
      } as any,
    })
    .returning({ id: thread.id })

  return row.id
}

/** Insert a turn from a prompt.submit event (user turn). */
async function handlePromptSubmit(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  // Get next turn index
  const lastTurn = await (db as any)
    .select({ turnIndex: threadTurn.turnIndex })
    .from(threadTurn)
    .where(eq(threadTurn.threadId, threadId))
    .orderBy(desc(threadTurn.turnIndex))
    .limit(1)

  const nextIndex = lastTurn.length > 0 ? lastTurn[0].turnIndex + 1 : 0

  await (db as any).insert(threadTurn).values({
    threadId,
    turnIndex: nextIndex,
    role: "user",
    spec: {
      prompt:
        typeof payload.prompt === "string"
          ? payload.prompt.slice(0, 4096)
          : undefined,
      timestamp: payload.timestamp,
    } as any,
  })
}

/** Insert a turn from a tool.post event (tool result). */
async function handleToolPost(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  const lastTurn = await (db as any)
    .select({ turnIndex: threadTurn.turnIndex })
    .from(threadTurn)
    .where(eq(threadTurn.threadId, threadId))
    .orderBy(desc(threadTurn.turnIndex))
    .limit(1)

  const nextIndex = lastTurn.length > 0 ? lastTurn[0].turnIndex + 1 : 0

  await (db as any).insert(threadTurn).values({
    threadId,
    turnIndex: nextIndex,
    role: "tool",
    spec: {
      toolName: payload.tool_name,
      toolInput:
        typeof payload.tool_input === "string"
          ? payload.tool_input.slice(0, 2048)
          : JSON.stringify(payload.tool_input ?? "").slice(0, 2048),
      timestamp: payload.timestamp,
    } as any,
  })
}

/**
 * Finalize a thread from agent.stop or session.end event.
 *
 * The hook script parses the local transcript JSONL and sends token usage, model,
 * turn count, and tool stats in the payload. This means we get rich metadata
 * without needing `dx scan`. Falls back to server-side materialization from
 * webhook events if the transcript stats are missing.
 */
async function handleSessionEnd(
  db: Database,
  payload: Record<string, any>
): Promise<void> {
  const sessionId = payload.sessionId
  if (!sessionId) return

  const threads = await (db as any)
    .select({ id: thread.id, startedAt: thread.startedAt, spec: thread.spec })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (threads.length === 0) return

  const threadRow = threads[0]
  const now = new Date()
  const existingSpec = (threadRow.spec ?? {}) as Record<string, any>
  const patch: Record<string, any> = {}

  // Prefer transcript-parsed stats from the hook payload (parsed locally on the user's machine)
  const hasTranscriptStats =
    payload.tokenUsage || payload.turnCount || payload.model

  if (hasTranscriptStats) {
    if (payload.model && !existingSpec.model)
      patch.model = normalizeModel(payload.model)
    if (payload.tokenUsage && !existingSpec.tokenUsage)
      patch.tokenUsage = payload.tokenUsage
    if (payload.turnCount && !existingSpec.turnCount)
      patch.turnCount = payload.turnCount
    if (payload.toolCallCount && !existingSpec.toolCallCount)
      patch.toolCallCount = payload.toolCallCount
    if (payload.toolsUsed?.length && !existingSpec.toolsUsed)
      patch.toolsUsed = payload.toolsUsed
  } else {
    // Fallback: materialize from webhook events stored on the server
    const materialized = await materializeFromWebhookEvents(db, sessionId)
    if (!existingSpec.turnCount && materialized.turnCount > 0)
      patch.turnCount = materialized.turnCount
    if (!existingSpec.toolCallCount && materialized.toolCallCount > 0)
      patch.toolCallCount = materialized.toolCallCount
    if (!existingSpec.toolsUsed && materialized.toolsUsed.length > 0)
      patch.toolsUsed = materialized.toolsUsed
  }

  if (!existingSpec.durationMinutes) {
    const durationMs = now.getTime() - new Date(threadRow.startedAt).getTime()
    patch.durationMinutes = Math.round(durationMs / 60000)
  }

  if (payload.stop_reason) patch.stopReason = payload.stop_reason
  if (payload.end_reason) patch.endReason = payload.end_reason

  await (db as any)
    .update(thread)
    .set({
      status: "completed",
      endedAt: now,
      spec:
        Object.keys(patch).length > 0
          ? sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`
          : undefined,
      updatedAt: now,
    })
    .where(eq(thread.id, threadRow.id))
}

/** Handle agent.stop — enriches thread with transcript stats but does NOT mark as completed. */
async function handleAgentStop(
  db: Database,
  payload: Record<string, any>
): Promise<void> {
  const sessionId = payload.sessionId
  if (!sessionId) return

  const threads = await (db as any)
    .select({ id: thread.id, spec: thread.spec })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (threads.length === 0) return

  const existingSpec = (threads[0].spec ?? {}) as Record<string, any>
  const patch: Record<string, any> = {}

  // Enrich with transcript stats from the hook but don't finalize — the session might continue
  if (payload.model && !existingSpec.model)
    patch.model = normalizeModel(payload.model)
  if (payload.tokenUsage) patch.tokenUsage = payload.tokenUsage // Always update: tokens grow each turn
  if (payload.turnCount) patch.turnCount = payload.turnCount
  if (payload.toolCallCount) patch.toolCallCount = payload.toolCallCount
  if (payload.toolsUsed?.length) patch.toolsUsed = payload.toolsUsed
  if (payload.stop_reason) patch.stopReason = payload.stop_reason

  if (Object.keys(patch).length > 0) {
    await (db as any)
      .update(thread)
      .set({
        spec: sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, threads[0].id))
  }
}

/**
 * Fallback: aggregate stats from raw webhook_event records for a session.
 * Used when the hook script didn't send transcript-parsed stats (e.g. older hook version).
 */
async function materializeFromWebhookEvents(
  db: Database,
  sessionId: string
): Promise<{ turnCount: number; toolCallCount: number; toolsUsed: string[] }> {
  const turnCountResult = await (db as any)
    .select({ count: sql<number>`count(*)` })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.eventType, "prompt.submit"),
        sql`${webhookEvent.spec}->'payload'->>'sessionId' = ${sessionId}`
      )
    )

  const toolEvents = await (db as any)
    .select({
      toolName: sql<string>`${webhookEvent.spec}->'payload'->>'tool_name'`,
    })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.eventType, "tool.post"),
        sql`${webhookEvent.spec}->'payload'->>'sessionId' = ${sessionId}`
      )
    )

  const toolNames = toolEvents
    .map((r: any) => r.toolName as string)
    .filter(Boolean)
  return {
    turnCount: Number(turnCountResult[0]?.count ?? 0),
    toolCallCount: toolEvents.length,
    toolsUsed: [...new Set<string>(toolNames)],
  }
}

const IngestBody = t.Object({
  source: t.Union([
    t.Literal("claude-code"),
    t.Literal("cursor"),
    t.Literal("conductor"),
  ]),
  deliveryId: t.String(),
  eventType: t.String(),
  action: t.Optional(t.String()),
  sessionId: t.String(),
  timestamp: t.String(),
  cwd: t.Optional(t.String()),
  project: t.Optional(t.String()),
  payload: t.Optional(t.Any()),
})

export function ideHookController(db: Database) {
  return (
    new Elysia({ prefix: "/ide-hooks" })

      // --- Ingest hook event ---
      .post(
        "/events",
        async (ctx) => {
          const { body, set } = ctx
          const principalId = (ctx as any).principalId as string

          if (!principalId) {
            set.status = 401
            return { success: false, error: "unauthenticated" }
          }

          const eventId = await recordWebhookEvent(db, {
            source: body.source,
            providerId: principalId,
            deliveryId: body.deliveryId,
            eventType: body.eventType,
            normalizedEventType: body.eventType,
            actorId: principalId,
            action: body.action,
            payload: {
              sessionId: body.sessionId,
              timestamp: body.timestamp,
              cwd: body.cwd,
              project: body.project,
              ...((body.payload as Record<string, unknown>) ?? {}),
            },
          })

          if (eventId === null) {
            // Duplicate — idempotent success
            set.status = 200
            return { success: true, duplicate: true }
          }

          log.info(
            {
              source: body.source,
              eventType: body.eventType,
              principalId,
              eventId,
            },
            "ide hook event recorded"
          )

          const payload = {
            sessionId: body.sessionId,
            timestamp: body.timestamp,
            cwd: body.cwd,
            project: body.project,
            ...((body.payload as Record<string, unknown>) ?? {}),
          }

          // Dual-write to thread entities (best-effort, don't fail the event)
          try {
            if (body.eventType === "thread.summary") {
              const channelId = await upsertChannel(db, body.source, payload)
              await upsertThread(
                db,
                body.source,
                payload,
                principalId,
                channelId
              )
            } else if (body.eventType === "thread_turn.completed") {
              await insertTurn(db, body.source, payload)
            } else if (body.eventType === "session.start") {
              await handleSessionStart(db, body.source, payload, principalId)
            } else if (body.eventType === "prompt.submit") {
              await handlePromptSubmit(db, body.source, payload, principalId)
            } else if (body.eventType === "tool.post") {
              await handleToolPost(db, body.source, payload, principalId)
            } else if (body.eventType === "agent.stop") {
              await handleAgentStop(db, payload)
            } else if (body.eventType === "session.end") {
              await handleSessionEnd(db, payload)
            }
          } catch (err) {
            log.warn({ err, eventId }, "dual-write to thread entities failed")
          }

          // Slack surface mirroring (best-effort, non-blocking)
          try {
            if (body.eventType === "session.start") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                await autoAttachSlackSurface(
                  db,
                  thrd.id,
                  principalId,
                  body.source,
                  payload
                )
              }
            } else if (body.eventType === "prompt.submit") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const p = payload as Record<string, any>
                const prompt = typeof p.prompt === "string" ? p.prompt : ""
                await postToSurface(db, thrd.id, prompt, "user")
              }
            } else if (body.eventType === "agent.stop") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const p = payload as Record<string, any>
                await postToSurface(
                  db,
                  thrd.id,
                  p.responseSummary ?? "",
                  "assistant",
                  {
                    source: body.source,
                    stats: {
                      turnCount: p.turnCount,
                      toolCallCount: p.toolCallCount,
                      toolsUsed: p.toolsUsed,
                    },
                  }
                )
              }
            } else if (body.eventType === "session.end") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                await postToSurface(db, thrd.id, "", "end", {
                  threadSpec: thrd.spec,
                })
                await detachSurfaces(db, thrd.id)
              }
            }
          } catch (err) {
            log.warn({ err, eventId }, "slack surface posting failed")
          }

          set.status = 202
          return { success: true, eventId }
        },
        {
          body: IngestBody,
          detail: {
            tags: ["IDE Hooks"],
            summary: "Ingest a hook event from Claude Code or Cursor",
          },
        }
      )

      // --- Query hook events ---
      .get(
        "/events",
        async (ctx) => {
          const { query } = ctx
          const principalId = (ctx as any).principalId as string
          const conditions = [
            inArray(webhookEvent.source, [...VALID_SOURCES]),
            // Default scope: own events only. Pass ?principalId=* for all (future: admin check).
            eq(webhookEvent.providerId, query.principalId ?? principalId),
          ]

          if (query.source) {
            conditions.push(eq(webhookEvent.source, query.source))
          }
          if (query.eventType) {
            conditions.push(eq(webhookEvent.eventType, query.eventType))
          }
          if (query.from) {
            conditions.push(gte(webhookEvent.createdAt, new Date(query.from)))
          }
          if (query.to) {
            conditions.push(lte(webhookEvent.createdAt, new Date(query.to)))
          }

          const limit = Math.min(Number(query.limit ?? 50), 200)
          const offset = Number(query.offset ?? 0)

          const rows = await db
            .select()
            .from(webhookEvent)
            .where(and(...conditions))
            .orderBy(desc(webhookEvent.createdAt))
            .limit(limit)
            .offset(offset)

          return { events: rows, count: rows.length }
        },
        {
          query: t.Object({
            source: t.Optional(t.String()),
            principalId: t.Optional(t.String()),
            eventType: t.Optional(t.String()),
            from: t.Optional(t.String()),
            to: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
          detail: { tags: ["IDE Hooks"], summary: "Query IDE hook events" },
        }
      )
  )
}
