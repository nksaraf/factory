/**
 * Claude Code adapter — converts JSONL transcripts to/from the universal IR.
 *
 * Validated against 375 sessions, 3,222 threads (incl. sub-agents), 338,585
 * messages. Round-trip is content-equivalent.
 *
 * Claude Code JSONL quirks this adapter handles:
 * - Assistant messages are SPLIT: one entry per content block, chained by parentUuid.
 *   Adapter consolidates back into one IRMessage with N content blocks.
 * - `progress` entries are streaming deltas (skipped for IR, kept for live replay).
 * - `queue-operation`, `last-prompt` are internal bookkeeping (skipped).
 * - `system` entries are context injections (preserved as system messages).
 * - Sub-agent transcripts live at {sessionDir}/subagents/agent-{agentId}.jsonl
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import type {
  IRMessage,
  IRMessageMeta,
  IRThread,
} from "../schemas/message-ir.js"
import type { MessageAdapter } from "./types.js"

// ── JSONL entry shape ───────────────────────────────────────

export interface ClaudeCodeEntry {
  type: string
  uuid?: string
  parentUuid?: string
  sessionId?: string
  agentId?: string
  isSidechain?: boolean
  timestamp?: string
  cwd?: string
  gitBranch?: string
  version?: string
  slug?: string
  userType?: string
  entrypoint?: string
  requestId?: string
  promptId?: string
  // Tool result metadata
  toolUseResult?: unknown
  sourceToolAssistantUUID?: string
  toolUseID?: string
  sourceToolUseID?: string
  // Hook metadata
  hookCount?: number
  hookInfos?: unknown
  hookErrors?: unknown
  preventedContinuation?: boolean
  stopReason?: string
  hasOutput?: boolean
  permissionMode?: string
  // System/meta
  isMeta?: boolean
  subtype?: string
  level?: string
  isApiErrorMessage?: boolean
  // Compaction
  logicalParentUuid?: string
  compactMetadata?: unknown
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  message?: {
    role?: string
    content?: unknown
    model?: string
    stop_reason?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    id?: string
  }
}

// ── Parse + consolidate ─────────────────────────────────────

function parseJsonlText(text: string): ClaudeCodeEntry[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as ClaudeCodeEntry
      } catch {
        return null
      }
    })
    .filter(Boolean) as ClaudeCodeEntry[]
}

function extractMeta(entry: ClaudeCodeEntry): IRMessageMeta | undefined {
  const meta: IRMessageMeta = {}
  if (entry.permissionMode) meta.permissionMode = entry.permissionMode
  if (entry.userType) meta.userType = entry.userType
  if (entry.entrypoint) meta.entrypoint = entry.entrypoint
  if (entry.slug) meta.slug = entry.slug
  if (entry.version) meta.version = entry.version
  if (entry.requestId) meta.requestId = entry.requestId
  if (entry.promptId) meta.promptId = entry.promptId
  if (entry.isSidechain != null) meta.isSidechain = entry.isSidechain
  if (entry.isMeta != null) meta.isMeta = entry.isMeta
  if (entry.isApiErrorMessage != null)
    meta.isApiErrorMessage = entry.isApiErrorMessage
  if (entry.isCompactSummary != null)
    meta.isCompactSummary = entry.isCompactSummary
  if (entry.subtype) meta.subtype = entry.subtype
  if (entry.level) meta.level = entry.level
  if (entry.hookCount != null) meta.hookCount = entry.hookCount
  if (entry.sourceToolAssistantUUID)
    meta.sourceToolAssistantUUID = entry.sourceToolAssistantUUID
  if (entry.logicalParentUuid) meta.logicalParentUuid = entry.logicalParentUuid
  return Object.keys(meta).length > 0 ? meta : undefined
}

function consolidateEntries(
  entries: ClaudeCodeEntry[],
  threadId: string,
  source: string
): IRMessage[] {
  const messages: IRMessage[] = []
  let seq = 0

  const meaningful = entries.filter(
    (e) => e.type === "user" || e.type === "assistant" || e.type === "system"
  )

  let i = 0
  while (i < meaningful.length) {
    const entry = meaningful[i]
    const role = entry.type as "user" | "assistant" | "system"

    if (role === "assistant") {
      const blocks: Record<string, unknown>[] = []
      const entryIds: string[] = []
      let model: string | undefined
      let stopReason: string | undefined
      let usage: IRMessage["usage"]
      const parentId = entry.parentUuid ?? null
      const timestamp = entry.timestamp
      let lastTimestamp = timestamp

      while (i < meaningful.length && meaningful[i].type === "assistant") {
        const e = meaningful[i]
        const content = e.message?.content
        if (Array.isArray(content)) {
          blocks.push(...(content as Record<string, unknown>[]))
        }
        entryIds.push(e.uuid ?? "")
        if (e.message?.model) model = e.message.model
        if (e.message?.stop_reason) stopReason = e.message.stop_reason
        if (e.timestamp) lastTimestamp = e.timestamp
        if (e.message?.usage) {
          const u = e.message.usage
          usage = {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          }
        }

        const next = meaningful[i + 1]
        if (next?.type === "assistant" && next.parentUuid === e.uuid) {
          i++
        } else {
          break
        }
      }

      messages.push({
        id: entryIds[0],
        sequence: seq++,
        threadId,
        parentId,
        role: "assistant",
        source,
        content: blocks,
        startedAt: timestamp ? new Date(timestamp) : new Date(),
        completedAt:
          stopReason && lastTimestamp ? new Date(lastTimestamp) : null,
        model,
        stopReason: stopReason ?? undefined,
        usage,
        meta: extractMeta(entry),
        sourceEntryIds: entryIds,
      })
    } else {
      const content = entry.message?.content
      const blocks: Record<string, unknown>[] = []
      if (typeof content === "string") {
        blocks.push({ type: "text", text: content })
      } else if (Array.isArray(content)) {
        blocks.push(...(content as Record<string, unknown>[]))
      }

      messages.push({
        id: entry.uuid ?? `gen-${seq}`,
        sequence: seq++,
        threadId,
        parentId: entry.parentUuid ?? null,
        role,
        source,
        content: blocks,
        startedAt: entry.timestamp ? new Date(entry.timestamp) : new Date(),
        meta: extractMeta(entry),
        sourceEntryIds: [entry.uuid ?? ""],
      })
    }
    i++
  }

  return messages
}

// ── Reconstruct JSONL ───────────────────────────────────────

function reconstructEntries(
  messages: IRMessage[],
  sessionMeta: {
    sessionId: string
    cwd?: string
    gitBranch?: string
    version?: string
    slug?: string
    userType?: string
    entrypoint?: string
  }
): ClaudeCodeEntry[] {
  const entries: ClaudeCodeEntry[] = []
  const base: Partial<ClaudeCodeEntry> = {
    sessionId: sessionMeta.sessionId,
    cwd: sessionMeta.cwd,
    gitBranch: sessionMeta.gitBranch,
    version: sessionMeta.version,
    slug: sessionMeta.slug,
    userType: sessionMeta.userType,
    entrypoint: sessionMeta.entrypoint,
  }

  for (const msg of messages) {
    const metaFields: Partial<ClaudeCodeEntry> = {}
    if (msg.meta?.permissionMode)
      metaFields.permissionMode = msg.meta.permissionMode
    if (msg.meta?.userType) metaFields.userType = msg.meta.userType
    if (msg.meta?.entrypoint) metaFields.entrypoint = msg.meta.entrypoint
    if (msg.meta?.slug) metaFields.slug = msg.meta.slug
    if (msg.meta?.version) metaFields.version = msg.meta.version
    if (msg.meta?.requestId) metaFields.requestId = msg.meta.requestId
    if (msg.meta?.promptId) metaFields.promptId = msg.meta.promptId
    if (msg.meta?.isSidechain != null)
      metaFields.isSidechain = msg.meta.isSidechain
    if (msg.meta?.isMeta != null) metaFields.isMeta = msg.meta.isMeta
    if (msg.meta?.isApiErrorMessage != null)
      metaFields.isApiErrorMessage = msg.meta.isApiErrorMessage
    if (msg.meta?.isCompactSummary != null)
      metaFields.isCompactSummary = msg.meta.isCompactSummary
    if (msg.meta?.subtype) metaFields.subtype = msg.meta.subtype
    if (msg.meta?.level) metaFields.level = msg.meta.level
    if (msg.meta?.sourceToolAssistantUUID)
      metaFields.sourceToolAssistantUUID = msg.meta.sourceToolAssistantUUID
    if (msg.meta?.logicalParentUuid)
      metaFields.logicalParentUuid = msg.meta.logicalParentUuid

    if (msg.role === "assistant") {
      let prevUuid = msg.parentId
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i]
        const uuid = msg.sourceEntryIds[i] ?? `recon-${msg.id}-${i}`
        entries.push({
          ...base,
          ...metaFields,
          type: "assistant",
          uuid,
          parentUuid: prevUuid ?? undefined,
          timestamp: msg.startedAt.toISOString(),
          message: {
            role: "assistant",
            content: [block],
            model: msg.model,
            stop_reason:
              i === msg.content.length - 1
                ? (msg.stopReason ?? undefined)
                : undefined,
            usage:
              i === msg.content.length - 1 && msg.usage
                ? {
                    input_tokens: msg.usage.inputTokens,
                    output_tokens: msg.usage.outputTokens,
                    cache_read_input_tokens: msg.usage.cacheReadTokens,
                    cache_creation_input_tokens: msg.usage.cacheWriteTokens,
                  }
                : undefined,
          },
        })
        prevUuid = uuid
      }
    } else {
      const content = msg.content
      entries.push({
        ...base,
        ...metaFields,
        type: msg.role,
        uuid: msg.id,
        parentUuid: msg.parentId ?? undefined,
        timestamp: msg.startedAt.toISOString(),
        message: {
          role: msg.role,
          content:
            content.length === 1 && content[0].type === "text"
              ? (content[0] as Record<string, unknown>).text
              : content,
        },
      })
    }
  }

  return entries
}

// ── Recursive thread parsing (with sub-agents) ──────────────

function parseThreadFromPath(
  jsonlPath: string,
  threadId: string,
  parentThreadId: string | null,
  parentToolUseId: string | null,
  source: string
): IRThread {
  const text = readFileSync(jsonlPath, "utf8")
  const entries = parseJsonlText(text)
  const messages = consolidateEntries(entries, threadId, source)

  const firstEntry = entries.find((e) => e.sessionId)
  const sessionId = firstEntry?.sessionId ?? threadId
  const cwd = firstEntry?.cwd
  const gitBranch = firstEntry?.gitBranch

  const sessionDir = jsonlPath.replace(".jsonl", "")
  const subagentsDir = join(sessionDir, "subagents")
  const childThreads: IRThread[] = []

  if (existsSync(subagentsDir)) {
    const meta: Record<string, { agentType?: string; description?: string }> =
      {}
    for (const f of readdirSync(subagentsDir).filter((f) =>
      f.endsWith(".meta.json")
    )) {
      try {
        const m = JSON.parse(readFileSync(join(subagentsDir, f), "utf8"))
        const agentId = f.replace(".meta.json", "").replace("agent-", "")
        meta[agentId] = m
      } catch {
        /* skip malformed meta */
      }
    }

    for (const f of readdirSync(subagentsDir).filter((f) =>
      f.endsWith(".jsonl")
    )) {
      const agentId = f.replace(".jsonl", "").replace("agent-", "")
      const childId = `${threadId}:agent-${agentId}`
      const child = parseThreadFromPath(
        join(subagentsDir, f),
        childId,
        threadId,
        null,
        source
      )
      child.agentType = meta[agentId]?.agentType
      child.description = meta[agentId]?.description
      childThreads.push(child)
    }

    // Link Agent tool_use IDs to child threads.
    // Compact sub-agents (agentId starts with "compact-") are internal to Claude
    // Code's compaction system — they have no matching Agent tool_use in the parent.
    // Regular sub-agents are linked by description matching, using ordered
    // consumption to handle duplicates (same order in transcript as on disk).
    const agentToolUses: {
      id: string
      description: string
      claimed: boolean
    }[] = []
    for (const msg of messages) {
      for (const block of msg.content) {
        if (
          block.type === "tool_use" &&
          (block as Record<string, unknown>).name === "Agent"
        ) {
          const input = (block as Record<string, unknown>).input as
            | Record<string, unknown>
            | undefined
          agentToolUses.push({
            id: (block as Record<string, unknown>).id as string,
            description: (input?.description as string) ?? "",
            claimed: false,
          })
        }
      }
    }

    for (const child of childThreads) {
      const agentId = child.id.match(/:agent-(.+)$/)?.[1] ?? ""
      if (agentId.includes("compact")) continue

      const match = agentToolUses.find(
        (t) => !t.claimed && t.description === child.description
      )
      if (match) {
        child.parentToolUseId = match.id
        match.claimed = true
      }
    }
  }

  const model = messages.find((m) => m.model)?.model
  return {
    id: threadId,
    parentThreadId,
    parentToolUseId,
    sessionId,
    cwd,
    gitBranch,
    model,
    messages,
    childThreads,
  }
}

// ── Adapter ─────────────────────────────────────────────────

export type ClaudeCodeTranscript = {
  jsonlPath: string
  text?: string
}

export const claudeCodeAdapter: MessageAdapter<ClaudeCodeTranscript> = {
  source: "claude-code",

  parseTranscript(raw, threadId) {
    return parseThreadFromPath(
      raw.jsonlPath,
      threadId,
      null,
      null,
      "claude-code"
    )
  },

  parseIncremental(raw, threadId, cursor) {
    const text = raw.text ?? readFileSync(raw.jsonlPath, "utf8")
    const lines = text.split("\n").filter((l) => l.trim())
    const newLines = lines.slice(cursor)
    const entries = newLines
      .map((l) => {
        try {
          return JSON.parse(l) as ClaudeCodeEntry
        } catch {
          return null
        }
      })
      .filter(Boolean) as ClaudeCodeEntry[]

    const messages = consolidateEntries(entries, threadId, "claude-code")
    return { messages, newCursor: lines.length }
  },

  reconstructTranscript(thread) {
    const firstMeta = thread.messages[0]?.meta
    const parentEntries = reconstructEntries(thread.messages, {
      sessionId: thread.sessionId,
      cwd: thread.cwd,
      gitBranch: thread.gitBranch,
      version: firstMeta?.version,
      slug: firstMeta?.slug,
      userType: firstMeta?.userType,
      entrypoint: firstMeta?.entrypoint,
    })
    const text = parentEntries.map((e) => JSON.stringify(e)).join("\n") + "\n"

    return {
      jsonlPath: `${thread.sessionId}.jsonl`,
      text,
    }
  },
}

// ── Convenience for file-based usage ────────────────────────

export function parseClaudeCodeSession(
  jsonlPath: string,
  threadId?: string
): IRThread {
  const id =
    threadId ?? jsonlPath.split("/").pop()?.replace(".jsonl", "") ?? "root"
  return claudeCodeAdapter.parseTranscript({ jsonlPath }, id)
}
