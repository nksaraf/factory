/**
 * Chat surface helpers — auto-attach and post to chat threads
 * that mirror IDE sessions (Claude Code, Cursor, Conductor).
 *
 * Adapter-agnostic: resolves which Chat SDK adapter to use from `channel.kind`.
 * Works with Slack, Discord, Teams, WhatsApp — any adapter in the Chat SDK.
 */
import { and, eq, inArray, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  channel,
  identityLink,
  thread,
  threadChannel,
} from "../../db/schema/org"
import { logger } from "../../logger"
import { adapters, bot } from "../chat/bot"
import { ensureChannel, parseSlackThreadId } from "../chat/handlers"

const log = logger.child({ module: "chat-surface" })

// ── Adapter resolution ──────────────────────────────────────

/**
 * Resolve a Chat SDK adapter by channel kind.
 * `channel.kind` maps directly to adapter name ("slack", "discord", "teams", etc.)
 */
function getAdapter(channelKind: string): any | null {
  return adapters[channelKind] ?? null
}

/** Check if any chat adapters are configured. */
function hasAdapters(): boolean {
  return Object.keys(adapters).length > 0
}

// ── Tool name mapping ───────────────────────────────────────

const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "running command",
  bash: "running command",
  Read: "reading file",
  read_file: "reading file",
  Write: "writing file",
  write_file: "writing file",
  Edit: "editing file",
  edit_file: "editing file",
  Grep: "searching code",
  grep: "searching code",
  Glob: "finding files",
  glob: "finding files",
  Agent: "delegating to agent",
  WebSearch: "searching web",
  WebFetch: "fetching page",
  Skill: "running skill",
  ToolSearch: "searching tools",
  EnterPlanMode: "planning",
  ExitPlanMode: "planning",
  TaskCreate: "tracking tasks",
  TaskUpdate: "tracking tasks",
  TaskList: "tracking tasks",
  ScheduleWakeup: "scheduling",
  NotebookEdit: "editing notebook",
}

export function humanizeToolName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] ?? toolName.toLowerCase()
}

// ── Message formatting ───────────────────────────────────────

/**
 * Build the thread-parent status message. Called at creation and on every update.
 * Shows source, cwd/branch, the first prompt, and live stats.
 */
function formatStatusMessage(opts: {
  source: string
  cwd?: string
  branch?: string
  prompt?: string
  turnCount?: number
  toolCallCount?: number
  toolsUsed?: string[]
}): string {
  const cwdStr = opts.cwd
    ? `\`${opts.cwd.split("/").slice(-2).join("/")}\``
    : ""
  const branchStr = opts.branch ? ` on \`${opts.branch}\`` : ""
  let msg = `:large_green_circle: *${opts.source}* session — ${cwdStr}${branchStr}`

  if (opts.prompt) {
    const cleaned = extractUserPrompt(opts.prompt)
    const truncated =
      cleaned.length > 200 ? cleaned.slice(0, 197) + "..." : cleaned
    msg += `\n> ${truncated.replace(/\n/g, "\n> ")}`
  }

  const stats: string[] = []
  if (opts.turnCount) stats.push(`${opts.turnCount} turns`)
  if (opts.toolCallCount) stats.push(`${opts.toolCallCount} tool calls`)
  if (opts.toolsUsed?.length) {
    const humanized = opts.toolsUsed.map(humanizeToolName).slice(0, 5)
    stats.push(humanized.join(", "))
  }
  if (stats.length > 0) {
    msg += `\n:bar_chart: ${stats.join(" · ")}`
  }

  return msg
}

/**
 * Strip system instructions and XML tags from prompts.
 * IDE clients (Conductor, Claude Code) prepend system prompts to user messages —
 * we want only the human-authored part.
 */
function extractUserPrompt(raw: string): string {
  let cleaned = raw.replace(
    /<system_instruction>[\s\S]*?<\/system_instruction>/g,
    ""
  )
  cleaned = cleaned.replace(/<system[_-]?\w*>[\s\S]*?<\/system[_-]?\w*>/g, "")
  cleaned = cleaned.trim()
  return cleaned || "(no prompt)"
}

function formatUserMessage(prompt: string): string {
  const userPrompt = extractUserPrompt(prompt)
  const truncated =
    userPrompt.length > 500 ? userPrompt.slice(0, 497) + "..." : userPrompt
  return `> ${truncated.replace(/\n/g, "\n> ")}`
}

function formatAssistantMessage(
  summary: string,
  source?: string
): string | null {
  if (!summary) return null
  const truncated =
    summary.length > 3000 ? summary.slice(0, 2997) + "..." : summary
  const label = source ?? "Assistant"
  return `*${label}:*\n${truncated}`
}

function formatEndMessage(spec: Record<string, any>): string {
  const turns = spec.turnCount ? `${spec.turnCount} turns` : ""
  const duration = spec.durationMinutes ? `${spec.durationMinutes}m` : ""
  const details = [turns, duration].filter(Boolean).join(", ")
  return `:red_circle: Session ended${details ? ` (${details})` : ""}`
}

// ── Core helpers ─────────────────────────────────────────────

/**
 * Look up a principal's chat identity via the identityLink table.
 * Returns the first identity that has a configured adapter.
 */
async function lookupChatIdentity(
  db: Database,
  principalId: string
): Promise<{ type: string; externalId: string } | null> {
  const configured = Object.keys(adapters)
  if (configured.length === 0) return null

  const rows = await db
    .select({
      type: identityLink.type,
      externalId: identityLink.externalId,
    })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.principalId, principalId),
        inArray(identityLink.type, configured)
      )
    )
    .limit(1)

  return rows[0] ?? null
}

/**
 * Find the thread row for a given session ID.
 */
export async function findThreadBySessionId(
  db: Database,
  sessionId: string
): Promise<{
  id: string
  spec: Record<string, any>
  branch: string | null
  source: string | null
} | null> {
  const rows = await db
    .select({
      id: thread.id,
      spec: thread.spec,
      branch: thread.branch,
      source: thread.source,
    })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (rows.length === 0) return null
  return {
    id: rows[0].id,
    spec: (rows[0].spec ?? {}) as Record<string, any>,
    branch: rows[0].branch,
    source: rows[0].source,
  }
}

// ── Thread surface lookup ──────────────────────────────────

/**
 * Find a connected mirror surface on THIS thread.
 * Used by autoAttachSurface to detect compactions — same session_id means
 * same thread row, so a surface already exists. Different conversations
 * get different threads and different Slack threads.
 */
async function findThreadSurface(
  db: Database,
  threadId: string
): Promise<{ chatSdkThreadId: string; channelRowId: string } | null> {
  const rows = await db
    .select({
      spec: threadChannel.spec,
      channelId: threadChannel.channelId,
    })
    .from(threadChannel)
    .where(
      and(
        eq(threadChannel.threadId, threadId),
        eq(threadChannel.role, "mirror"),
        eq(threadChannel.status, "connected")
      )
    )
    .limit(1)

  if (rows.length === 0) return null
  const spec = (rows[0].spec ?? {}) as Record<string, any>
  const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
  if (!chatSdkThreadId) return null
  return { chatSdkThreadId, channelRowId: rows[0].channelId }
}

// ── Surface query (shared by postToSurface + startTypingOnSurface) ──

interface SurfaceRow {
  id: string
  spec: Record<string, any> | null
  channelKind: string
}

async function getConnectedSurfaces(
  db: Database,
  threadId: string
): Promise<SurfaceRow[]> {
  return db
    .select({
      id: threadChannel.id,
      spec: threadChannel.spec,
      channelKind: channel.kind,
    })
    .from(threadChannel)
    .innerJoin(channel, eq(threadChannel.channelId, channel.id))
    .where(
      and(
        eq(threadChannel.threadId, threadId),
        eq(threadChannel.status, "connected")
      )
    )
}

// ── Typing indicator with debounce ──────────────────────────

const lastTypingUpdate = new Map<string, number>()
const TYPING_DEBOUNCE_MS = 2000

/**
 * Show typing indicator on all connected surfaces for a thread.
 * On Slack, uses assistant.threads.setStatus for custom status text.
 * Auto-clears when a message is posted.
 */
export async function startTypingOnSurface(
  db: Database,
  threadId: string,
  status?: string
): Promise<void> {
  if (!hasAdapters()) return

  const surfaces = await getConnectedSurfaces(db, threadId)
  if (surfaces.length === 0) return

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) continue

    // Debounce: skip if < 2s since last update for this thread
    const now = Date.now()
    const lastUpdate = lastTypingUpdate.get(chatSdkThreadId) ?? 0
    if (now - lastUpdate < TYPING_DEBOUNCE_MS) continue
    lastTypingUpdate.set(chatSdkThreadId, now)

    const adapter = getAdapter(surface.channelKind)
    if (!adapter) continue

    try {
      await adapter.startTyping(chatSdkThreadId, status)
    } catch (err) {
      log.debug(
        { err, threadChannelId: surface.id, chatSdkThreadId },
        "Failed to set typing indicator"
      )
    }
  }
}

// ── Update status message (thread parent) ──────────────────

/**
 * Edit the thread-parent message on all connected surfaces.
 * The thread parent doubles as a live status card — showing the prompt,
 * turn count, tool calls, and tools used.
 */
export async function updateSurfaceStatus(
  db: Database,
  threadId: string,
  opts: {
    source: string
    cwd?: string
    branch?: string
    prompt?: string
    turnCount?: number
    toolCallCount?: number
    toolsUsed?: string[]
  }
): Promise<void> {
  if (!hasAdapters()) return

  const surfaces = await getConnectedSurfaces(db, threadId)
  if (surfaces.length === 0) return

  const message = formatStatusMessage(opts)

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) continue

    // The thread parent message ID is the last segment of chatSdkThreadId
    // Format: "slack:C12345:1234567890.123456" → messageId = "1234567890.123456"
    const parts = chatSdkThreadId.split(":")
    const statusMessageId = parts.slice(2).join(":")
    if (!statusMessageId) continue

    const adapter = getAdapter(surface.channelKind)
    if (!adapter) continue

    try {
      await adapter.editMessage(chatSdkThreadId, statusMessageId, message)
    } catch (err) {
      log.debug(
        { err, threadChannelId: surface.id, chatSdkThreadId },
        "Failed to update status message"
      )
    }
  }
}

// ── Auto-attach surface ─────────────────────────────────────

/**
 * Auto-attach a chat surface to a thread.
 *
 * Called on session.start. Looks up whether THIS thread already has a
 * connected surface (compaction case — same session_id, same thread row).
 * If yes, no-op. If not, creates a new Slack thread.
 *
 * Each conversation gets its own session_id → its own thread → its own
 * Slack thread. Multiple conversations for the same principal stay separate.
 *
 * Returns the thread_channel ID, or null if no identity / adapter.
 */
export async function autoAttachSurface(
  db: Database,
  threadId: string,
  principalId: string,
  source: string,
  payload: Record<string, any>
): Promise<string | null> {
  if (!hasAdapters()) {
    log.debug("No chat adapters configured — skipping auto-attach")
    return null
  }

  // If this thread already has a surface, we're done (compaction / duplicate session.start)
  const existing = await findThreadSurface(db, threadId)
  if (existing) {
    log.info(
      { threadId, chatSdkThreadId: existing.chatSdkThreadId },
      "Thread already has a surface — skipping"
    )
    return null
  }

  const identity = await lookupChatIdentity(db, principalId)
  if (!identity) {
    log.debug({ principalId }, "No chat identity — skipping auto-attach")
    return null
  }

  // New conversation — create a new Slack thread
  await bot.initialize()
  const dmThread = await bot.openDM(identity.externalId)
  const startMsg = formatStatusMessage({
    source,
    cwd: payload.cwd,
    branch: payload.gitBranch ?? payload.branch,
  })
  const sent = await dmThread.post(startMsg)

  const { slackChannelId } = parseSlackThreadId(dmThread.id)
  const chatSdkThreadId = `${identity.type}:${slackChannelId}:${sent.id}`
  const channelRowId = await ensureChannel(slackChannelId)

  log.info(
    { threadId, principalId, chatSdkThreadId },
    "Created new surface for conversation"
  )

  const surfaceSpec = {
    chatSdkThreadId,
    adapterName: identity.type,
    connectedAt: new Date().toISOString(),
  }

  const [row] = await db
    .insert(threadChannel)
    .values({
      threadId,
      channelId: channelRowId,
      role: "mirror",
      status: "connected",
      spec: surfaceSpec as any,
    })
    .onConflictDoUpdate({
      target: [threadChannel.threadId, threadChannel.channelId],
      set: {
        status: "connected",
        spec: surfaceSpec as any,
        updatedAt: new Date(),
      },
    })
    .returning({ id: threadChannel.id })

  return row.id
}

// ── Post to surfaces ────────────────────────────────────────

/**
 * Post a message to all connected surfaces for a thread.
 * Resolves the adapter from channel.kind — works across all Chat SDK adapters.
 */
export async function postToSurface(
  db: Database,
  threadId: string,
  message: string,
  role: "user" | "assistant" | "end",
  opts?: {
    source?: string
    threadSpec?: Record<string, any>
    stats?: Record<string, any>
  }
): Promise<void> {
  if (!hasAdapters()) {
    log.debug({ threadId, role }, "postToSurface: no adapters")
    return
  }

  const surfaces = await getConnectedSurfaces(db, threadId)
  if (surfaces.length === 0) return

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) {
      log.warn(
        { surfaceId: surface.id },
        "postToSurface: no chatSdkThreadId in spec"
      )
      continue
    }

    let formatted: string | null
    switch (role) {
      case "user":
        formatted = formatUserMessage(message)
        break
      case "assistant":
        formatted = formatAssistantMessage(message, opts?.source)
        break
      case "end":
        formatted = formatEndMessage(opts?.threadSpec ?? {})
        break
    }

    // Skip posting if there's nothing to say (e.g. agent.stop with no summary)
    if (!formatted) continue

    const adapter = getAdapter(surface.channelKind)
    if (!adapter) continue

    try {
      await adapter.postMessage(chatSdkThreadId, formatted)
    } catch (err) {
      log.warn(
        { err, threadChannelId: surface.id, chatSdkThreadId },
        "Failed to post to chat surface"
      )
    }
  }
}

// ── Detach surfaces ─────────────────────────────────────────

/**
 * Detach all active surfaces for a thread.
 * Called on session.end to mark surfaces as detached.
 */
export async function detachSurfaces(
  db: Database,
  threadId: string
): Promise<void> {
  const detachedAt = new Date().toISOString()
  await db
    .update(threadChannel)
    .set({
      status: "detached",
      spec: sql`COALESCE(${threadChannel.spec}, '{}'::jsonb) || ${JSON.stringify({ detachedAt })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(threadChannel.threadId, threadId),
        eq(threadChannel.status, "connected")
      )
    )
}

// ── Mirrored thread detection ───────────────────────────────

/**
 * Check if a Chat SDK thread ID corresponds to a mirrored IDE session.
 * Used by chat handlers to detect replies to mirrored threads.
 */
export async function findMirroredIdeThread(
  db: Database,
  chatSdkThreadId: string
): Promise<{ threadId: string; externalId: string } | null> {
  const rows = await db
    .select({
      threadId: threadChannel.threadId,
      externalId: thread.externalId,
    })
    .from(threadChannel)
    .innerJoin(thread, eq(threadChannel.threadId, thread.id))
    .where(
      and(
        eq(threadChannel.role, "mirror"),
        eq(threadChannel.status, "connected"),
        sql`${threadChannel.spec}->>'chatSdkThreadId' = ${chatSdkThreadId}`
      )
    )
    .limit(1)

  if (rows.length === 0) return null
  return {
    threadId: rows[0].threadId,
    externalId: rows[0].externalId as string,
  }
}
