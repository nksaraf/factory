/**
 * IDE Hook Events — receives telemetry from Claude Code & Cursor hook scripts,
 * stores as org.webhook_event records linked to the authenticated principal.
 * Also dual-writes to org.channel + org.thread + org.thread_turn.
 *
 * POST  /ide-hooks/events   — ingest a hook event
 * GET   /ide-hooks/events   — query hook events (with filters)
 */
import { and, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import {
  channel,
  document,
  documentVersion,
  thread,
  threadTurn,
  webhookEvent,
} from "../../db/schema/org"
import { newId } from "../../lib/id"
import { recordWebhookEvent } from "../../lib/webhook-events"
import { logger } from "../../logger"
import {
  autoAttachSurface,
  findThreadBySessionId,
  humanizeToolCall,
  postToSurface,
  startTypingOnSurface,
  updateCardActivity,
  updateSurfaceStatus,
} from "../thread-surfaces/chat-surface"

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
    hostname: p.hostname,
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
      hostname: payload.hostname,
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

  // Store the first prompt in thread.spec so the status card can reference it
  const prompt =
    typeof payload.prompt === "string"
      ? payload.prompt.slice(0, 4096)
      : undefined

  const existingSpec = await (db as any)
    .select({ spec: thread.spec })
    .from(thread)
    .where(eq(thread.id, threadId))
    .limit(1)

  if (prompt) {
    const specPatch: Record<string, any> = { lastPrompt: prompt }
    if (!(existingSpec[0]?.spec as any)?.firstPrompt) {
      specPatch.firstPrompt = prompt
    }
    await (db as any)
      .update(thread)
      .set({
        spec: sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify(specPatch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, threadId))
  }

  await insertThreadTurn(db, threadId, "user", {
    prompt,
    timestamp: payload.timestamp,
  })
}

/**
 * Atomic turn insert. Computes next turn_index inside the INSERT via
 * COALESCE(MAX(turn_index), -1) + 1, then uses ON CONFLICT DO NOTHING against
 * the (thread_id, turn_index) unique constraint to absorb concurrent-insert
 * races. Returns the index actually written (or null if conflicted).
 */
async function insertThreadTurn(
  db: Database,
  threadId: string,
  role: string,
  spec: Record<string, unknown>
): Promise<{ id: string; turnIndex: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const turnId = newId("turn")
    const rows = await db.execute(sql`
      INSERT INTO org.thread_turn (id, thread_id, turn_index, role, spec)
      VALUES (
        ${turnId},
        ${threadId},
        (SELECT COALESCE(MAX(turn_index), -1) + 1 FROM org.thread_turn WHERE thread_id = ${threadId}),
        ${role},
        ${JSON.stringify(spec)}::jsonb
      )
      ON CONFLICT (thread_id, turn_index) DO NOTHING
      RETURNING id, turn_index
    `)
    const row = (rows as any).rows?.[0]
    if (row && typeof row.turn_index === "number") {
      return { id: row.id as string, turnIndex: row.turn_index }
    }
  }
  log.warn({ threadId, role }, "insertThreadTurn: lost race 3 times, skipping")
  return null
}

/** Insert a turn from a tool.post_failure event (tool error). */
async function handleToolPostFailure(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  await insertThreadTurn(db, threadId, "tool", {
    toolName: payload.tool_name,
    toolInput:
      typeof payload.tool_input === "string"
        ? payload.tool_input.slice(0, 2048)
        : JSON.stringify(payload.tool_input ?? "").slice(0, 2048),
    error:
      typeof payload.error === "string"
        ? payload.error.slice(0, 2048)
        : JSON.stringify(payload.error ?? "").slice(0, 2048),
    failed: true,
    timestamp: payload.timestamp,
  })
}

/** Insert an assistant turn from agent.response (Cursor live, CC synthesized). */
async function handleAgentResponse(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  const content =
    typeof payload.content === "string"
      ? payload.content.slice(0, 4096)
      : undefined
  if (!content) return

  await insertThreadTurn(db, threadId, "assistant", {
    responseSummary: content,
    timestamp: payload.timestamp,
  })
}

/** Insert a thinking turn from agent.thought (not posted to Slack). */
async function handleAgentThought(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  const content =
    typeof payload.content === "string"
      ? payload.content.slice(0, 4096)
      : undefined
  if (!content) return

  await insertThreadTurn(db, threadId, "thinking", {
    content,
    timestamp: payload.timestamp,
  })
}

/** Record subagent start/stop as a turn; lets us trace nested work. */
async function handleSubagent(
  db: Database,
  source: string,
  payload: Record<string, any>,
  principalId: string,
  phase: "start" | "stop"
): Promise<void> {
  const threadId = await ensureThread(db, source, payload, principalId)
  if (!threadId) return

  await insertThreadTurn(db, threadId, "subagent", {
    phase,
    agentId: payload.agent_id,
    agentType: payload.agent_type,
    description: payload.description,
    timestamp: payload.timestamp,
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

  const turn = await insertThreadTurn(db, threadId, "tool", {
    toolName: payload.tool_name,
    toolInput:
      typeof payload.tool_input === "string"
        ? payload.tool_input.slice(0, 2048)
        : JSON.stringify(payload.tool_input ?? "").slice(0, 2048),
    timestamp: payload.timestamp,
  })

  if (turn && (payload.tool_name === "Write" || payload.tool_name === "Edit")) {
    try {
      await maybeHandlePlanFileWrite(db, threadId, source, payload, turn.id)
    } catch (err) {
      log.warn({ err, threadId }, "maybeHandlePlanFileWrite failed")
    }
  }
}

/**
 * Finalize a thread from agent.stop or session.end event.
 *
 * The hook script parses the local transcript JSONL and sends token usage, model,
 * turn count, and tool stats in the payload. This means we get rich metadata
 * without needing `dx scan`. Falls back to server-side materialization from
 * webhook events if the transcript stats are missing.
 */
// ── Plan document upsert ──────────────────────────────────

type PlanPathClass = {
  slug: string
  basename: string
  source: "claude-code" | "superpowers" | "context-plan"
}

/**
 * Resolve the Factory public base URL used for `viewUrl` links.
 */
function factoryBaseUrl(): string {
  return (
    process.env.FACTORY_URL ??
    process.env.BETTER_AUTH_BASE_URL ??
    "https://factory.lepton.software"
  ).replace(/\/$/, "")
}

function planViewUrl(slug: string): string {
  return `${factoryBaseUrl()}/api/v1/factory/documents/${encodeURIComponent(slug)}/view`
}

/**
 * Translate a qualified plan slug into a unique, filesystem-safe path.
 * Colon segments become directories so `superpowers:factory:foo` and
 * `superpowers_factory_foo` never collide on disk. Any residual unsafe
 * char becomes `_`.
 */
function planContentRoot(slug: string): string {
  const parts = slug
    .split(":")
    .map((p) => p.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .filter((p) => p.length > 0)
  return `plan/${parts.join("/")}`
}

/**
 * Match a plan file path to a known plan-authoring directory.
 * Returns a qualified slug + source, or null if not a plan.
 *
 * Patterns (leading slash optional, handles absolute and relative paths):
 *   .../.claude/plans/<name>.md            → claude-code:<name>
 *   .../docs/superpowers/plans/<name>.md   → superpowers:<project>:<name>
 *   .../.context/plans/<name>.md           → context-plan:<project>:<name>
 *
 * `<project>` is the directory segment immediately before the matched
 * plan directory root (e.g. `factory/docs/superpowers/plans/x.md` → `factory`),
 * so repo-scoped plans with the same filename don't collide across repos.
 */
function classifyPlanPath(filePath: string): PlanPathClass | null {
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

const TITLE_MAX_LENGTH = 200

function extractPlanTitle(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("# ")) {
      const title = trimmed
        .replace(/^#+\s*/, "")
        .replace(/^Plan:\s*/i, "")
        .trim()
      return title.length > TITLE_MAX_LENGTH
        ? title.slice(0, TITLE_MAX_LENGTH - 1) + "…"
        : title
    }
  }
  return "Untitled Plan"
}

/**
 * Upsert a plan document row (by slug) and return its id.
 * Uses ON CONFLICT to be safe under concurrent writes for the same slug.
 */
async function upsertPlanDocumentRow(
  db: Database,
  opts: {
    slug: string
    title: string
    contentPath: string
    contentHash: string | null
    sizeBytes: number | null
    threadId: string
    source: string
  }
): Promise<string> {
  const id = newId("doc")
  const { slug, title, contentPath, contentHash, sizeBytes, threadId, source } =
    opts
  const rows = await db.execute(sql`
    INSERT INTO org.document (id, slug, title, type, source, content_path, content_hash, size_bytes, thread_id)
    VALUES (${id}, ${slug}, ${title}, 'plan', ${source}, ${contentPath}, ${contentHash}, ${sizeBytes}, ${threadId})
    ON CONFLICT (slug) DO UPDATE SET
      title         = EXCLUDED.title,
      content_path  = EXCLUDED.content_path,
      content_hash  = COALESCE(EXCLUDED.content_hash, org.document.content_hash),
      size_bytes    = COALESCE(EXCLUDED.size_bytes, org.document.size_bytes),
      thread_id     = EXCLUDED.thread_id,
      updated_at    = NOW()
    RETURNING id
  `)
  return (rows as any).rows?.[0]?.id as string
}

/**
 * Upsert a plan document + new version. Hash-deduped: if the latest version
 * for this slug already matches `contentHash`, this is a no-op and returns
 * { created: false }. Otherwise inserts a new version.
 *
 * Concurrency-safe: the version insert is done inside a retry loop with
 * `ON CONFLICT (document_id, version) DO NOTHING`, so two concurrent writes
 * of the same plan file never duplicate-key crash — the loser retries with
 * the next max version.
 */
async function upsertPlanDocument(
  db: Database,
  opts: {
    slug: string
    title: string
    content: string
    contentHash: string
    threadId: string
    sourceTurnId: string | null
    source: string
  }
): Promise<{
  created: boolean
  docId: string
  version: number
  viewUrl: string
}> {
  const { slug, title, content, contentHash, threadId, sourceTurnId, source } =
    opts
  const sizeBytes = Buffer.byteLength(content, "utf-8")
  const contentRoot = planContentRoot(slug)
  const contentPath = `${contentRoot}.md`

  const { writeDocument } = await import("../documents/storage")

  const docId = await upsertPlanDocumentRow(db, {
    slug,
    title,
    contentPath,
    contentHash,
    sizeBytes,
    threadId,
    source,
  })

  // Hash-dedupe: if latest version matches this content, no-op.
  const [latest] = await db
    .select({
      version: documentVersion.version,
      contentHash: documentVersion.contentHash,
    })
    .from(documentVersion)
    .where(eq(documentVersion.documentId, docId))
    .orderBy(desc(documentVersion.version))
    .limit(1)

  if (latest && latest.contentHash === contentHash) {
    return {
      created: false,
      docId,
      version: latest.version,
      viewUrl: planViewUrl(slug),
    }
  }

  await writeDocument(contentPath, content)

  // Retry loop handles concurrent inserts racing for the same (docId, version).
  for (let attempt = 0; attempt < 3; attempt++) {
    const [maxRow] = await db
      .select({ maxVersion: max(documentVersion.version) })
      .from(documentVersion)
      .where(eq(documentVersion.documentId, docId))
    const nextVersion = (maxRow?.maxVersion ?? 0) + 1
    const versionPath = `${contentRoot}/v${nextVersion}.md`
    await writeDocument(versionPath, content)

    const rows = await db.execute(sql`
      INSERT INTO org.document_version
        (id, document_id, version, content_path, content_hash, size_bytes, source, thread_id, source_turn_id)
      VALUES (
        ${newId("docv")}, ${docId}, ${nextVersion}, ${versionPath},
        ${contentHash}, ${sizeBytes}, ${source}, ${threadId}, ${sourceTurnId}
      )
      ON CONFLICT (document_id, version) DO NOTHING
      RETURNING version
    `)
    const wrote = (rows as any).rows?.[0]?.version
    if (typeof wrote === "number") {
      return {
        created: true,
        docId,
        version: wrote,
        viewUrl: planViewUrl(slug),
      }
    }
  }

  // Lost the race 3x — treat as not-created but return best-known state.
  log.warn({ slug, docId }, "plan: version insert lost race 3 times, skipping")
  return {
    created: false,
    docId,
    version: latest?.version ?? 0,
    viewUrl: planViewUrl(slug),
  }
}

type PlanLink = { slug?: string; label: string; url: string }

async function linkPlanOnThreadSpec(
  db: Database,
  threadId: string,
  slug: string,
  title: string,
  viewUrl: string
): Promise<void> {
  const existingThread = await db
    .select({ id: thread.id, spec: thread.spec })
    .from(thread)
    .where(eq(thread.id, threadId))
    .limit(1)
  if (existingThread.length === 0) return
  const spec = (existingThread[0].spec ?? {}) as Record<string, any>
  const links: PlanLink[] = spec.links ?? []
  const planLink: PlanLink = { slug, label: `📄 ${title}`, url: viewUrl }
  // Match by explicit slug field first; fall back to URL-substring for entries
  // written before this code added the slug field.
  const idx = links.findIndex(
    (l) => l.slug === slug || l.url.includes(encodeURIComponent(slug))
  )
  if (idx >= 0) links[idx] = planLink
  else links.push(planLink)
  await db
    .update(thread)
    .set({
      spec: sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify({ links })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(thread.id, threadId))
}

/**
 * Best-effort: ensure a plan document row exists for this slug so it appears
 * in the plans index even if we only saw an Edit (no full content).
 * Increments `spec.editCount`. Does NOT create a version (no content available).
 */
async function ensurePlanStubOnEdit(
  db: Database,
  cls: PlanPathClass,
  threadId: string
): Promise<void> {
  const contentPath = `${planContentRoot(cls.slug)}.md`
  const [existing] = await db
    .select({ id: document.id, spec: document.spec })
    .from(document)
    .where(eq(document.slug, cls.slug))
    .limit(1)

  if (existing) {
    const spec = (existing.spec ?? {}) as Record<string, any>
    const editCount = ((spec.editCount as number) ?? 0) + 1
    await db
      .update(document)
      .set({
        spec: sql`COALESCE(${document.spec}, '{}'::jsonb) || ${JSON.stringify({ editCount })}::jsonb`,
        updatedAt: new Date(),
      } as any)
      .where(eq(document.id, existing.id))
    log.debug({ slug: cls.slug, editCount, threadId }, "plan: edit recorded")
    return
  }

  // No prior Write captured. Create a stub so the plan still shows up in the
  // index; the next Write (or ExitPlanMode) fills in content + version.
  const id = newId("doc")
  await db.execute(sql`
    INSERT INTO org.document
      (id, slug, title, type, source, content_path, thread_id, spec)
    VALUES (
      ${id}, ${cls.slug}, ${cls.basename}, 'plan', ${cls.source},
      ${contentPath}, ${threadId},
      ${JSON.stringify({ editCount: 1, stub: true })}::jsonb
    )
    ON CONFLICT (slug) DO UPDATE SET
      spec = COALESCE(org.document.spec, '{}'::jsonb)
           || jsonb_build_object('editCount', COALESCE((org.document.spec->>'editCount')::int, 0) + 1),
      updated_at = NOW()
  `)
  log.info(
    { slug: cls.slug, source: cls.source, threadId },
    "plan: stub created from edit (no prior write seen)"
  )
}

/**
 * Handle a Write/Edit to a known plan-authoring directory.
 * - Write: upsert the plan document + new version, tagged with sourceTurnId.
 * - Edit: bump editCount; create stub doc if none exists yet (best-effort).
 */
async function maybeHandlePlanFileWrite(
  db: Database,
  threadId: string,
  _source: string,
  payload: Record<string, any>,
  turnId: string
): Promise<void> {
  const toolInput =
    typeof payload.tool_input === "string"
      ? (() => {
          try {
            return JSON.parse(payload.tool_input)
          } catch {
            return null
          }
        })()
      : payload.tool_input
  if (!toolInput || typeof toolInput.file_path !== "string") return

  const cls = classifyPlanPath(toolInput.file_path)
  if (!cls) return

  if (payload.tool_name === "Write") {
    const content = toolInput.content
    if (typeof content !== "string" || content.length === 0) return

    const contentHash = new Bun.CryptoHasher("sha256")
      .update(content)
      .digest("hex")
    const title = extractPlanTitle(content)

    const result = await upsertPlanDocument(db, {
      slug: cls.slug,
      title,
      content,
      contentHash,
      threadId,
      sourceTurnId: turnId,
      source: cls.source,
    })

    if (!result.created) {
      log.debug(
        { slug: cls.slug, version: result.version },
        "plan: no-op write (same content hash)"
      )
      return
    }

    const msg = `:page_facing_up: *Plan: ${title}*${result.version > 1 ? ` (v${result.version})` : ""}\n<${result.viewUrl}|View plan>`
    try {
      await postToSurface(db, threadId, msg, "assistant")
    } catch (err) {
      log.warn({ err, threadId, slug: cls.slug }, "Failed to post plan link")
    }
    try {
      await linkPlanOnThreadSpec(db, threadId, cls.slug, title, result.viewUrl)
    } catch (err) {
      log.warn({ err, threadId, slug: cls.slug }, "Failed to store plan link")
    }

    log.info(
      { slug: cls.slug, version: result.version, source: cls.source, threadId },
      "plan: captured from file write"
    )
    return
  }

  if (payload.tool_name === "Edit") {
    await ensurePlanStubOnEdit(db, cls, threadId)
  }
}

async function handlePlanDocument(
  db: Database,
  threadId: string,
  sessionId: string,
  payload: Record<string, any>
): Promise<void> {
  const toolInput =
    typeof payload.tool_input === "string"
      ? JSON.parse(payload.tool_input)
      : payload.tool_input
  const planContent = toolInput?.plan
  if (!planContent || typeof planContent !== "string") return

  const title = extractPlanTitle(planContent)
  const contentHash = new Bun.CryptoHasher("sha256")
    .update(planContent)
    .digest("hex")

  // Hash-dedupe: if any existing plan doc already has this exact content as its
  // latest version (likely authored via the file-write path above), link to it
  // instead of creating a second plan-${sessionId} document.
  const existingByHash = await db
    .select({
      docSlug: document.slug,
      docTitle: document.title,
      version: documentVersion.version,
    })
    .from(documentVersion)
    .innerJoin(document, eq(documentVersion.documentId, document.id))
    .where(
      and(
        eq(document.type, "plan"),
        eq(documentVersion.contentHash, contentHash)
      )
    )
    .orderBy(desc(documentVersion.version))
    .limit(1)

  if (existingByHash.length > 0) {
    const existingSlug = existingByHash[0].docSlug
    const existingTitle = existingByHash[0].docTitle ?? title
    const existingVersion = existingByHash[0].version
    const viewUrl = planViewUrl(existingSlug)
    const msg = `:page_facing_up: *Plan: ${existingTitle}*${existingVersion > 1 ? ` (v${existingVersion})` : ""}\n<${viewUrl}|View plan>`
    try {
      await postToSurface(db, threadId, msg, "assistant")
    } catch (err) {
      log.warn(
        { err, threadId, slug: existingSlug },
        "Failed to re-post plan link to surface (dedupe)"
      )
    }
    try {
      await linkPlanOnThreadSpec(
        db,
        threadId,
        existingSlug,
        existingTitle,
        viewUrl
      )
    } catch (err) {
      log.warn(
        { err, threadId, slug: existingSlug },
        "Failed to store plan link on thread (dedupe)"
      )
    }
    log.info(
      { slug: existingSlug, version: existingVersion, threadId },
      "ExitPlanMode: linked to existing plan (hash dedupe)"
    )
    return
  }

  const slug = `plan-${sessionId}`
  const result = await upsertPlanDocument(db, {
    slug,
    title,
    content: planContent,
    contentHash,
    threadId,
    sourceTurnId: null,
    source: "claude-code",
  })

  const msg = `:page_facing_up: *Plan: ${title}*${result.version > 1 ? ` (v${result.version})` : ""}\n<${result.viewUrl}|View plan>`
  try {
    await postToSurface(db, threadId, msg, "assistant")
  } catch (err) {
    log.warn({ err, threadId, slug }, "Failed to post plan link to surface")
  }
  try {
    await linkPlanOnThreadSpec(db, threadId, slug, title, result.viewUrl)
  } catch (err) {
    log.warn({ err, threadId, slug }, "Failed to store plan link on thread")
  }

  log.info(
    { slug, version: result.version, threadId },
    "Plan document upserted"
  )
}

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
    if (payload.contextWindow) patch.contextWindow = payload.contextWindow
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
  if (payload.tokenUsage) patch.tokenUsage = payload.tokenUsage
  if (payload.contextWindow) patch.contextWindow = payload.contextWindow
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

  // Store assistant turn with response summary (mirrors prompt.submit → user turn)
  if (payload.responseSummary) {
    await insertThreadTurn(db, threads[0].id, "assistant", {
      responseSummary:
        typeof payload.responseSummary === "string"
          ? payload.responseSummary.slice(0, 4096)
          : undefined,
      toolCallCount: payload.toolCallCount,
      toolsUsed: payload.toolsUsed,
      tokenUsage: payload.tokenUsage,
      timestamp: payload.timestamp,
    })
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
              ...(body.payload as Record<string, unknown>),
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
            ...(body.payload as Record<string, unknown>),
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
            } else if (body.eventType === "tool.post_failure") {
              await handleToolPostFailure(db, body.source, payload, principalId)
            } else if (body.eventType === "agent.response") {
              await handleAgentResponse(db, body.source, payload, principalId)
            } else if (body.eventType === "agent.thought") {
              await handleAgentThought(db, body.source, payload, principalId)
            } else if (body.eventType === "subagent.start") {
              await handleSubagent(
                db,
                body.source,
                payload,
                principalId,
                "start"
              )
            } else if (body.eventType === "subagent.stop") {
              await handleSubagent(
                db,
                body.source,
                payload,
                principalId,
                "stop"
              )
            } else if (body.eventType === "agent.stop") {
              await handleAgentStop(db, payload)
            } else if (body.eventType === "session.end") {
              await handleSessionEnd(db, payload)
            }
          } catch (err) {
            log.warn({ err, eventId }, "dual-write to thread entities failed")
          }

          // Chat surface mirroring (best-effort, non-blocking)
          try {
            if (body.eventType === "session.start") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                await autoAttachSurface(
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
                // Ensure surface exists (creates on first prompt if session.start was missed)
                await autoAttachSurface(
                  db,
                  thrd.id,
                  principalId,
                  body.source,
                  payload
                )
                const p = payload as Record<string, any>
                const prompt = typeof p.prompt === "string" ? p.prompt : ""
                await postToSurface(db, thrd.id, prompt, "user")
                await startTypingOnSurface(db, thrd.id, "Thinking...")
                // Compute live duration from startedAt
                const liveDuration = thrd.startedAt
                  ? Math.round(
                      (Date.now() - new Date(thrd.startedAt).getTime()) / 60000
                    )
                  : thrd.spec.durationMinutes
                // Update the thread-parent status card with the prompt
                await updateSurfaceStatus(db, thrd.id, {
                  source: body.source ?? thrd.source,
                  cwd: thrd.spec.cwd,
                  branch: thrd.branch ?? undefined,
                  host: thrd.spec.hostname,
                  title: thrd.spec.firstPrompt,
                  prompt,
                  model: thrd.spec.model,
                  mode: thrd.spec.mode,
                  turnCount: thrd.spec.turnCount,
                  toolCallCount: thrd.spec.toolCallCount,
                  contextWindow: thrd.spec.contextWindow,
                  durationMinutes: liveDuration,
                  links: thrd.spec.links,
                  generatedTopic: thrd.spec.generatedTopic,
                  generatedDescription: thrd.spec.generatedDescription,
                  activeStatus: "Working...",
                })
              }
            } else if (body.eventType === "tool.pre") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const toolName = (payload as any).tool_name ?? "tool"
                const toolInput = (payload as any).tool_input
                const parsed =
                  typeof toolInput === "string"
                    ? (() => {
                        try {
                          return JSON.parse(toolInput)
                        } catch {
                          return undefined
                        }
                      })()
                    : toolInput
                const humanized = humanizeToolCall(toolName, parsed)
                await startTypingOnSurface(db, thrd.id, humanized)

                const liveDur = thrd.startedAt
                  ? Math.round(
                      (Date.now() - new Date(thrd.startedAt).getTime()) / 60000
                    )
                  : thrd.spec.durationMinutes
                await updateCardActivity(db, thrd.id, {
                  source: body.source ?? thrd.source,
                  cwd: thrd.spec.cwd,
                  branch: thrd.branch ?? undefined,
                  host: thrd.spec.hostname,
                  title: thrd.spec.firstPrompt,
                  prompt: thrd.spec.lastPrompt,
                  model: thrd.spec.model,
                  mode: thrd.spec.mode,
                  turnCount: thrd.spec.turnCount,
                  toolCallCount: thrd.spec.toolCallCount,
                  contextWindow: thrd.spec.contextWindow,
                  durationMinutes: liveDur,
                  links: thrd.spec.links,
                  generatedTopic: thrd.spec.generatedTopic,
                  generatedDescription: thrd.spec.generatedDescription,
                  activeStatus: humanized,
                })

                // Track mode transitions in thread spec
                if (
                  toolName === "EnterPlanMode" ||
                  toolName === "ExitPlanMode"
                ) {
                  const newMode =
                    toolName === "EnterPlanMode" ? "planning" : "executing"
                  await (db as any)
                    .update(thread)
                    .set({
                      spec: sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify({ mode: newMode })}::jsonb`,
                    })
                    .where(eq(thread.id, thrd.id))
                }
              }
            } else if (body.eventType === "tool.post") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                await startTypingOnSurface(db, thrd.id, "Thinking...")

                // Plan documents: upsert to document store and post link
                const toolName = (payload as any).tool_name
                if (toolName === "ExitPlanMode") {
                  await handlePlanDocument(db, thrd.id, body.sessionId, payload)
                }
              }
            } else if (body.eventType === "agent.response") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const content =
                  typeof (payload as any).content === "string"
                    ? (payload as any).content
                    : ""
                if (content) {
                  await postToSurface(db, thrd.id, content, "assistant", {
                    source: body.source,
                  })
                }
              }
            } else if (body.eventType === "tool.post_failure") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const p = payload as Record<string, any>
                const toolName = p.tool_name ?? "tool"
                const errMsg =
                  typeof p.error === "string"
                    ? p.error
                    : JSON.stringify(p.error ?? "").slice(0, 500)
                await startTypingOnSurface(
                  db,
                  thrd.id,
                  `:warning: ${toolName} failed: ${errMsg.slice(0, 200)}`
                )
              }
            } else if (
              body.eventType === "subagent.start" ||
              body.eventType === "subagent.stop"
            ) {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const p = payload as Record<string, any>
                const label =
                  body.eventType === "subagent.start"
                    ? `Spawning subagent${p.agent_type ? `: ${p.agent_type}` : ""}${p.description ? ` — ${String(p.description).slice(0, 80)}` : ""}`
                    : `Subagent done${p.agent_type ? `: ${p.agent_type}` : ""}`
                await startTypingOnSurface(db, thrd.id, label)
              }
            } else if (body.eventType === "agent.stop") {
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                const p = payload as Record<string, any>
                // For claude-code, agent.stop carries responseSummary (from
                // transcript parsing). For cursor, the assistant text arrives
                // earlier via agent.response — don't re-post here.
                if (body.source === "claude-code" && p.responseSummary) {
                  await postToSurface(
                    db,
                    thrd.id,
                    p.responseSummary,
                    "assistant",
                    { source: body.source }
                  )
                }
                // Compute live duration from startedAt
                const stopDuration = thrd.startedAt
                  ? Math.round(
                      (Date.now() - new Date(thrd.startedAt).getTime()) / 60000
                    )
                  : thrd.spec.durationMinutes
                // Update the thread-parent status card with fresh stats
                await updateSurfaceStatus(db, thrd.id, {
                  source: body.source ?? thrd.source,
                  cwd: thrd.spec.cwd,
                  branch: thrd.branch ?? undefined,
                  host: thrd.spec.hostname,
                  title: thrd.spec.firstPrompt,
                  prompt: thrd.spec.lastPrompt,
                  model: thrd.spec.model ?? p.model,
                  mode: thrd.spec.mode,
                  turnCount: thrd.spec.turnCount ?? p.turnCount,
                  toolCallCount: thrd.spec.toolCallCount ?? p.toolCallCount,
                  contextWindow: thrd.spec.contextWindow ?? p.contextWindow,
                  durationMinutes: stopDuration,
                  links: thrd.spec.links,
                  generatedTopic: thrd.spec.generatedTopic,
                  generatedDescription: thrd.spec.generatedDescription,
                })
              }
            } else if (body.eventType === "thread_turn.completed") {
              // Conductor ingests whole turns (prompt + response) as one event.
              // Mirror both sides to Slack.
              const thrd = await findThreadBySessionId(db, body.sessionId)
              if (thrd) {
                await autoAttachSurface(
                  db,
                  thrd.id,
                  principalId,
                  body.source,
                  payload
                )
                const p = payload as Record<string, any>
                const prompt = typeof p.prompt === "string" ? p.prompt : ""
                const response =
                  typeof p.responseSummary === "string" ? p.responseSummary : ""
                if (prompt) {
                  await postToSurface(db, thrd.id, prompt, "user")
                }
                if (response) {
                  await postToSurface(db, thrd.id, response, "assistant", {
                    source: body.source,
                  })
                }
              }
            }
            // session.end: intentionally no surface action.
            // Surfaces stay connected so the next compaction/subagent
            // reuses the same Slack thread.
          } catch (err) {
            log.warn({ err, eventId }, "chat surface posting failed")
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
