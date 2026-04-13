/**
 * Chat surface helpers — auto-attach and post to chat threads
 * that mirror IDE sessions (Claude Code, Cursor, Conductor).
 *
 * Adapter-agnostic: resolves which Chat SDK adapter to use from `channel.kind`.
 * Works with Slack, Discord, Teams, WhatsApp — any adapter in the Chat SDK.
 */
import { and, eq, inArray, sql } from "drizzle-orm"

import { Card, CardText, Divider, LinkButton, Actions } from "chat"
import type { CardChild, CardElement } from "chat"

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

/** Parse chatSdkThreadId ("slack:C12345:1234567890.123456") into parts. */
function parseChatSdkThreadId(chatSdkThreadId: string): {
  adapterName: string
  channelId: string
  threadTs: string
} | null {
  const parts = chatSdkThreadId.split(":")
  if (parts.length < 3) return null
  return {
    adapterName: parts[0],
    channelId: parts[1],
    threadTs: parts.slice(2).join(":"),
  }
}

// ── Title generation (Gemini Flash) ──────────────────────────

/**
 * Generate a short thread title from the initial prompt using Gemini Flash.
 * Returns null if no API key is configured or generation fails.
 */
interface GeneratedTitle {
  topic: string
  description: string
}

async function generateThreadTitle(
  rawPrompt: string
): Promise<GeneratedTitle | null> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.LLM_API_KEY
  if (!apiKey) {
    log.warn(
      "No GOOGLE_GENERATIVE_AI_API_KEY or LLM_API_KEY — skipping title generation"
    )
    return null
  }

  const cleaned = extractUserPrompt(rawPrompt)
  if (!cleaned || cleaned === "(no prompt)") return null

  try {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
    const { generateObject } = await import("ai")
    const { z } = await import("zod")
    const google = createGoogleGenerativeAI({ apiKey })
    const { object } = await generateObject({
      model: google("gemini-2.5-flash"),
      prompt: `Summarize this coding task:\n\n${cleaned.slice(0, 1000)}`,
      schema: z.object({
        topic: z
          .string()
          .describe(
            "2-3 word topic, e.g. 'Status Card', 'Auth Refactor', 'CLI Migration'"
          ),
        description: z
          .string()
          .describe("6-10 word description of what the task is about"),
      }),
    })
    const topic = object.topic.replace(/[*_`#]/g, "").slice(0, 30)
    const description = object.description.replace(/[*_`#]/g, "").slice(0, 80)
    log.info({ topic, description }, "Generated thread title")
    return { topic, description }
  } catch (err) {
    log.warn({ err }, "Failed to generate thread title")
    return null
  }
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

/**
 * Build a human-friendly status string for a tool call.
 * Includes detail from tool_input when available — file names, commands, patterns.
 */
export function humanizeToolCall(
  toolName: string,
  toolInput?: Record<string, any>
): string {
  const base = TOOL_NAME_MAP[toolName] ?? toolName.toLowerCase()
  if (!toolInput) return base

  switch (toolName) {
    case "Read":
    case "read_file": {
      const fp = toolInput.file_path ?? toolInput.filePath
      if (fp) return `reading \`${basename(fp)}\``
      return base
    }
    case "Write":
    case "write_file": {
      const fp = toolInput.file_path ?? toolInput.filePath
      if (fp) return `writing \`${basename(fp)}\``
      return base
    }
    case "Edit":
    case "edit_file": {
      const fp = toolInput.file_path ?? toolInput.filePath
      if (fp) return `editing \`${basename(fp)}\``
      return base
    }
    case "Grep":
    case "grep": {
      const pat = toolInput.pattern
      if (pat) return `searching for \`${truncate(pat, 40)}\``
      return base
    }
    case "Glob":
    case "glob": {
      const pat = toolInput.pattern
      if (pat) return `finding \`${truncate(pat, 40)}\``
      return base
    }
    case "Bash":
    case "bash": {
      // Prefer the description field (Claude Code provides it), fall back to command
      const desc = toolInput.description
      if (desc) return truncate(desc.toLowerCase(), 60)
      const cmd = toolInput.command
      if (cmd) return `running \`${truncate(cmd, 50)}\``
      return base
    }
    case "Agent": {
      const desc = toolInput.description
      if (desc) return `agent: ${truncate(desc.toLowerCase(), 50)}`
      return base
    }
    case "WebSearch": {
      const q = toolInput.query
      if (q) return `searching "${truncate(q, 40)}"`
      return base
    }
    case "WebFetch": {
      const url = toolInput.url
      if (url) return `fetching ${truncate(url, 50)}`
      return base
    }
    default:
      return base
  }
}

/** @deprecated Use humanizeToolCall for richer output */
export function humanizeToolName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] ?? toolName.toLowerCase()
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

// ── Status card options ─────────────────────────────────────

export interface StatusCardOpts {
  source: string
  cwd?: string
  branch?: string
  host?: string
  title?: string
  prompt?: string
  model?: string
  mode?: string
  turnCount?: number
  toolCallCount?: number
  tokenUsage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  contextWindow?: number
  durationMinutes?: number
  links?: Array<{ label: string; url: string }>
  generatedTopic?: string
  generatedDescription?: string
  activeStatus?: string
}

// ── Status card (Block Kit via Chat SDK Card) ───────────────

/**
 * Build the thread-parent status card. Returns a CardElement that renders
 * as Slack Block Kit (sections, fields, dividers, action buttons).
 *
 * Layout:
 *   Title:    :claude: First prompt (truncated)
 *   Subtitle: factory/colombo · feature-branch
 *   ─────────────────────────────────
 *   > Latest user prompt
 *   ─────────────────────────────────
 *   Turns    Tool Calls    Duration
 *   182      921           58m
 *
 *   Model         Context      Mode
 *   opus 4.6      149M tokens  executing
 *   ─────────────────────────────────
 *   [View Plan ↗] [Preview ↗]
 */
function buildStatusCard(opts: StatusCardOpts): CardElement {
  const children: CardChild[] = []

  // ── Active status indicator (top of card) ──
  if (opts.activeStatus) {
    children.push(CardText(`:loading:  *${opts.activeStatus}*`))
  } else {
    children.push(CardText(`:large_green_circle:  Agent has responded`))
  }

  // ── Links (preview URLs, plan documents, etc.) ──
  if (opts.links?.length) {
    children.push(Divider())
    children.push(
      Actions(opts.links.map((l) => LinkButton({ url: l.url, label: l.label })))
    )
  }

  // ── Card title + subtitle ──
  const emoji = sourceEmoji(opts.source)
  let titleText: string
  if (opts.generatedDescription) {
    titleText = `${emoji}  ${opts.generatedDescription}`
  } else if (opts.title) {
    const cleaned = extractUserPrompt(opts.title)
    titleText = `${emoji}  ${cleaned.length > 70 ? cleaned.slice(0, 67) + "..." : cleaned}`
  } else {
    titleText = `${emoji}  ${opts.source} session`
  }

  // Subtitle: host · repo · branch · model/mode · context · duration · tools
  const subtitleParts: string[] = []
  if (opts.host) subtitleParts.push(`💻 ${opts.host}`)
  if (opts.cwd)
    subtitleParts.push(`📂 ${opts.cwd.split("/").slice(-2).join("/")}`)
  if (opts.branch) subtitleParts.push(`🌿 ${opts.branch}`)
  const modelParts: string[] = []
  if (opts.model) modelParts.push(formatModel(opts.model))
  if (opts.mode) modelParts.push(opts.mode)
  if (modelParts.length > 0) subtitleParts.push(`🧠 ${modelParts.join(" · ")}`)
  if (opts.contextWindow && opts.contextWindow > 0)
    subtitleParts.push(`📊 ${formatTokens(opts.contextWindow)}`)
  if (opts.durationMinutes)
    subtitleParts.push(`⏱️ ${formatDuration(opts.durationMinutes)}`)
  if (opts.toolCallCount)
    subtitleParts.push(`🔧 ${commaNumber(opts.toolCallCount)}`)

  return Card({
    title: titleText,
    subtitle: subtitleParts.join("  ·  ") || undefined,
    children,
  })
}

function commaNumber(n: number): string {
  return n.toLocaleString("en-US")
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatModel(model: string): string {
  return model.replace("claude-", "").replace(/-/g, " ")
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K tokens`
  return `${n} tokens`
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

// ── Source → emoji mapping ───────────────────────────────────

const SOURCE_EMOJI: Record<string, string> = {
  "claude-code": ":claude:",
  cursor: ":cursor:",
  conductor: ":conductor:",
}

function sourceEmoji(source?: string): string {
  if (!source) return ":robot_face:"
  return SOURCE_EMOJI[source] ?? ":robot_face:"
}

function formatUserMessage(prompt: string): string {
  const userPrompt = extractUserPrompt(prompt)
  const truncated =
    userPrompt.length > 500 ? userPrompt.slice(0, 497) + "..." : userPrompt
  return `> :bust_in_silhouette: ${truncated.replace(/\n/g, "\n> ")}`
}

function formatAssistantMessage(
  summary: string,
  source?: string
): string | null {
  if (!summary) return null
  const truncated =
    summary.length > 3000 ? summary.slice(0, 2997) + "..." : summary
  return `${sourceEmoji(source)} ${truncated}`
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
  startedAt: Date | null
} | null> {
  const rows = await db
    .select({
      id: thread.id,
      spec: thread.spec,
      branch: thread.branch,
      source: thread.source,
      startedAt: thread.startedAt,
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
    startedAt: rows[0].startedAt,
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

// ── Card activity indicator with longer debounce ────────────

const lastCardActivityUpdate = new Map<string, number>()
const CARD_ACTIVITY_DEBOUNCE_MS = 10_000

/**
 * Update the card's active status indicator. Debounced to avoid
 * hammering Slack on every tool call (~10s between card edits).
 * Pass `null` status to clear the indicator immediately (no debounce).
 */
export async function updateCardActivity(
  db: Database,
  threadId: string,
  opts: StatusCardOpts
): Promise<void> {
  if (!hasAdapters()) return

  const surfaces = await getConnectedSurfaces(db, threadId)
  if (surfaces.length === 0) return

  const now = Date.now()
  const clearing = !opts.activeStatus

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) continue

    if (!clearing) {
      const lastUpdate = lastCardActivityUpdate.get(chatSdkThreadId) ?? 0
      if (now - lastUpdate < CARD_ACTIVITY_DEBOUNCE_MS) continue
    }
    lastCardActivityUpdate.set(chatSdkThreadId, now)

    const parsed = parseChatSdkThreadId(chatSdkThreadId)
    if (!parsed) continue

    const adapter = getAdapter(surface.channelKind)
    if (!adapter) continue

    try {
      const card = buildStatusCard(opts)
      await adapter.editMessage(chatSdkThreadId, parsed.threadTs, card)
    } catch (err) {
      log.warn({ err }, "Failed to update card activity")
    }
  }
}

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
      // Use Slack's setAssistantStatus for richer status indicator
      const parsed = parseChatSdkThreadId(chatSdkThreadId)
      if (parsed && typeof adapter.setAssistantStatus === "function") {
        await adapter.setAssistantStatus(
          parsed.channelId,
          parsed.threadTs,
          status ?? "Thinking..."
        )
      } else {
        await adapter.startTyping(chatSdkThreadId, status)
      }
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
  opts: StatusCardOpts
): Promise<void> {
  if (!hasAdapters()) return

  const surfaces = await getConnectedSurfaces(db, threadId)
  if (surfaces.length === 0) return

  // Ensure generated topic + description exist before updating the card.
  if (!opts.generatedTopic && opts.title) {
    const generated = await ensureGeneratedTitle(db, threadId, opts.title)
    if (generated) {
      opts.generatedTopic = generated.topic
      opts.generatedDescription = generated.description
    }
  }

  const card = buildStatusCard(opts)

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) continue

    const parsed = parseChatSdkThreadId(chatSdkThreadId)
    if (!parsed) continue

    const adapter = getAdapter(surface.channelKind)
    if (!adapter) continue

    try {
      await adapter.editMessage(chatSdkThreadId, parsed.threadTs, card)
    } catch (err) {
      log.debug(
        { err, threadChannelId: surface.id, chatSdkThreadId },
        "Failed to update status message"
      )
    }

    // Set Slack assistant thread title (shown in History view) — use the description
    if (typeof adapter.setAssistantTitle === "function") {
      try {
        const historyTitle =
          opts.generatedTopic ??
          (opts.title
            ? extractUserPrompt(opts.title).slice(0, 60)
            : `${opts.source} session`)
        await adapter.setAssistantTitle(
          parsed.channelId,
          parsed.threadTs,
          historyTitle
        )
      } catch (err) {
        log.debug({ err }, "Failed to set assistant title")
      }
    }
  }
}

/**
 * Ensure a generated title exists for the thread. Idempotent.
 * Returns { topic, description } or null.
 */
async function ensureGeneratedTitle(
  db: Database,
  threadId: string,
  prompt: string
): Promise<GeneratedTitle | null> {
  // Re-check DB in case another event already generated one
  const [row] = await db
    .select({ spec: thread.spec })
    .from(thread)
    .where(eq(thread.id, threadId))
    .limit(1)
  const spec = (row?.spec ?? {}) as Record<string, any>
  if (spec.generatedTopic && spec.generatedDescription) {
    return {
      topic: spec.generatedTopic,
      description: spec.generatedDescription,
    }
  }

  const result = await generateThreadTitle(prompt)
  if (!result) return null

  await db
    .update(thread)
    .set({
      spec: sql`COALESCE(${thread.spec}, '{}'::jsonb) || ${JSON.stringify({
        generatedTopic: result.topic,
        generatedDescription: result.description,
      })}::jsonb`,
    })
    .where(eq(thread.id, threadId))

  return result
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
  const startCard = buildStatusCard({
    source,
    cwd: payload.cwd,
    branch: payload.gitBranch ?? payload.branch,
    title: payload.title,
    model: payload.model,
  })
  const sent = await dmThread.post(startCard)

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
