#!/usr/bin/env bun
/**
 * Backfill Conductor chat histories from conductor.db SQLite
 * into Factory webhook_events.
 */
import { Database } from "bun:sqlite"
import { statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  type IngestEvent,
  type IngestOptions,
  extractTextFromContent,
  extractToolCalls,
  fixLocalTimestamp,
  progress,
  remoteUrlToSlug,
  truncSummary,
  truncText,
} from "./lib/common"
import { sendBatch } from "./lib/ingest-client"

type SessionRow = {
  id: string
  title: string | null
  model: string | null
  status: string | null
  created_at: string
  updated_at: string
  workspace_id: string | null
  agent_type: string | null
  context_token_count: number | null
  thinking_enabled: number | null
  permission_mode: string | null
  // workspace join
  directory_name: string | null
  branch: string | null
  root_path: string | null
  repo_name: string | null
  remote_url: string | null
  intended_target_branch: string | null
  pr_title: string | null
  workspace_state: string | null
  derived_status: string | null
}

type MessageRow = {
  id: string
  session_id: string
  role: string | null
  content: string | null
  sent_at: string | null
  full_message: string | null
  model: string | null
  turn_id: string | null
}

function openConductorDb(): Database {
  const dbPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.conductor.app",
    "conductor.db"
  )
  if (!statSync(dbPath, { throwIfNoEntry: false })) {
    throw new Error(`Conductor DB not found at ${dbPath}`)
  }
  return new Database(dbPath, { readonly: true })
}

function querySessions(db: Database, since?: Date): SessionRow[] {
  let sql = `
    SELECT
      s.id, s.title, s.model, s.status, s.created_at, s.updated_at,
      s.workspace_id, s.agent_type, s.context_token_count,
      s.thinking_enabled, s.permission_mode,
      w.directory_name, w.branch, w.intended_target_branch,
      w.pr_title, w.state as workspace_state, w.derived_status,
      r.root_path, r.name as repo_name, r.remote_url
    FROM sessions s
    LEFT JOIN workspaces w ON s.workspace_id = w.id
    LEFT JOIN repos r ON w.repository_id = r.id
    WHERE s.is_hidden = 0
  `
  const params: any[] = []
  if (since) {
    sql += ` AND s.created_at >= ?`
    params.push(since.toISOString())
  }
  sql += ` ORDER BY s.created_at`
  return db.prepare(sql).all(...params) as SessionRow[]
}

function queryMessages(db: Database, sessionId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT id, session_id, role, content, sent_at, full_message, model, turn_id
       FROM session_messages
       WHERE session_id = ?
       ORDER BY sent_at`
    )
    .all(sessionId) as MessageRow[]
}

function parseMessageContent(msg: MessageRow): {
  text: string
  model?: string
  usage?: { input: number; output: number }
  toolCalls: Array<{ name: string; input?: string }>
  isSystem: boolean
} {
  const empty = {
    text: "",
    toolCalls: [] as Array<{ name: string; input?: string }>,
    isSystem: false,
  }

  // The content field in Conductor is JSON with a top-level `type` field:
  // - "system" = system/hook init messages (skip these)
  // - "assistant" = Claude API message with nested message.content array
  // - "user" = user message or tool result
  if (msg.content) {
    try {
      const parsed = JSON.parse(msg.content)

      // Skip system init messages
      if (parsed.type === "system") {
        return { ...empty, isSystem: true }
      }

      // Conductor wraps messages: { type: "assistant", message: { model, content: [...], usage: {...} } }
      if (parsed.message) {
        const inner = parsed.message
        const content = inner.content
        const usage = inner.usage
        return {
          text: extractTextFromContent(content),
          model: inner.model ?? msg.model ?? undefined,
          usage: usage
            ? {
                input: usage.input_tokens ?? 0,
                output: usage.output_tokens ?? 0,
              }
            : undefined,
          toolCalls: extractToolCalls(content),
          isSystem: false,
        }
      }

      // Array of content blocks directly
      if (Array.isArray(parsed)) {
        return {
          text: extractTextFromContent(parsed),
          toolCalls: extractToolCalls(parsed),
          isSystem: false,
        }
      }
    } catch {}
  }

  // Try full_message as fallback
  if (msg.full_message) {
    try {
      const fm = JSON.parse(msg.full_message)
      const content = fm.content ?? fm.message?.content
      const usage = fm.usage ?? fm.message?.usage
      return {
        text: extractTextFromContent(content) || msg.content || "",
        model: fm.model ?? fm.message?.model ?? msg.model ?? undefined,
        usage: usage
          ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 }
          : undefined,
        toolCalls: extractToolCalls(content),
        isSystem: false,
      }
    } catch {}
  }

  return {
    text: msg.content || "",
    toolCalls: [],
    isSystem: false,
  }
}

type Turn = {
  turnId: string
  index: number
  userText: string
  assistantText: string
  model?: string
  tokenUsage: { input: number; output: number }
  toolCalls: Array<{ name: string; input?: string }>
  timestamp: string
}

function groupIntoTurns(messages: MessageRow[]): Turn[] {
  // Group by turn_id
  const turnMap = new Map<string, MessageRow[]>()
  const turnOrder: string[] = []

  for (const msg of messages) {
    const turnId = msg.turn_id || msg.id
    if (!turnMap.has(turnId)) {
      turnMap.set(turnId, [])
      turnOrder.push(turnId)
    }
    turnMap.get(turnId)!.push(msg)
  }

  const turns: Turn[] = []
  let index = 0

  for (const turnId of turnOrder) {
    const msgs = turnMap.get(turnId)!

    // Parse all messages and filter out system init messages
    const parsedMsgs = msgs.map((m) => ({
      msg: m,
      parsed: parseMessageContent(m),
    }))
    const userParsed = parsedMsgs.filter(
      (p) => p.msg.role === "user" && !p.parsed.isSystem
    )
    const assistantParsed = parsedMsgs.filter(
      (p) => p.msg.role === "assistant" && !p.parsed.isSystem
    )

    // Skip turns with no real user message
    if (userParsed.length === 0) continue

    let userText = ""
    let assistantText = ""
    let model: string | undefined
    const totalUsage = { input: 0, output: 0 }
    const allToolCalls: Turn["toolCalls"] = []

    for (const { parsed } of userParsed) {
      if (parsed.text) userText += (userText ? "\n" : "") + parsed.text
    }

    for (const { parsed } of assistantParsed) {
      if (parsed.text)
        assistantText += (assistantText ? "\n" : "") + parsed.text
      if (!model && parsed.model) model = parsed.model
      if (parsed.usage) {
        totalUsage.input += parsed.usage.input
        totalUsage.output += parsed.usage.output
      }
      allToolCalls.push(...parsed.toolCalls)
    }

    const rawTimestamp =
      userParsed[0]?.msg.sent_at || assistantParsed[0]?.msg.sent_at || ""
    const timestamp = fixLocalTimestamp(rawTimestamp) ?? rawTimestamp

    turns.push({
      turnId,
      index,
      userText,
      assistantText,
      model,
      tokenUsage: totalUsage,
      toolCalls: allToolCalls,
      timestamp,
    })
    index++
  }

  return turns
}

function buildSessionEvents(session: SessionRow, turns: Turn[]): IngestEvent[] {
  const events: IngestEvent[] = []

  const repoSlug = session.remote_url
    ? remoteUrlToSlug(session.remote_url)
    : undefined
  const project =
    repoSlug ??
    (session.root_path
      ? session.root_path.split("/").slice(-2).join("/")
      : undefined) ??
    session.directory_name ??
    undefined

  const allToolNames = [
    ...new Set(turns.flatMap((t) => t.toolCalls.map((tc) => tc.name))),
  ]
  const totalTokens = turns.reduce(
    (acc, t) => ({
      input: acc.input + t.tokenUsage.input,
      output: acc.output + t.tokenUsage.output,
    }),
    { input: 0, output: 0 }
  )

  const startedAt = fixLocalTimestamp(session.created_at) ?? session.created_at
  const endedAt = fixLocalTimestamp(session.updated_at) ?? session.updated_at
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime()

  // Session summary
  events.push({
    source: "conductor",
    providerId: "local-backfill",
    deliveryId: `conductor-session-${session.id}`,
    eventType: "thread.summary",
    sessionId: session.id,
    timestamp: startedAt,
    cwd: session.root_path ?? undefined,
    project,
    payload: {
      sessionId: session.id,
      title: session.title ?? undefined,
      model: session.model ?? turns.find((t) => t.model)?.model ?? "unknown",
      project,
      gitBranch: session.branch ?? undefined,
      gitRemoteUrl: session.remote_url ?? undefined,
      repoSlug,
      repoName: session.repo_name ?? undefined,
      targetBranch: session.intended_target_branch ?? undefined,
      prTitle: session.pr_title ?? undefined,
      workspaceState: session.workspace_state ?? undefined,
      derivedStatus: session.derived_status ?? undefined,
      cwd: session.root_path ?? undefined,
      startedAt,
      endedAt,
      durationMinutes: Math.round(durationMs / 60000),
      turnCount: turns.length,
      tokenUsage: totalTokens,
      toolsUsed: allToolNames,
      agentType: session.agent_type ?? undefined,
      contextTokenCount: session.context_token_count ?? undefined,
      workspaceId: session.workspace_id ?? undefined,
      directoryName: session.directory_name ?? undefined,
    },
  })

  // Turn events
  for (const turn of turns) {
    events.push({
      source: "conductor",
      providerId: "local-backfill",
      deliveryId: `conductor-turn-${session.id}-${turn.turnId}`,
      eventType: "thread_turn.completed",
      sessionId: session.id,
      timestamp: turn.timestamp || startedAt,
      cwd: session.root_path ?? undefined,
      project,
      payload: {
        sessionId: session.id,
        turnIndex: turn.index,
        prompt: truncText(turn.userText),
        responseSummary: truncSummary(turn.assistantText),
        model: turn.model ?? session.model ?? "unknown",
        tokenUsage: turn.tokenUsage,
        toolCalls: turn.toolCalls.slice(0, 50),
        timestamp: turn.timestamp,
      },
    })
  }

  return events
}

export async function ingestConductor(opts: IngestOptions) {
  console.error("Opening Conductor database (read-only)...")
  const db = openConductorDb()

  try {
    const sessions = querySessions(db, opts.since)
    console.error(`Found ${sessions.length} sessions`)

    const allEvents: IngestEvent[] = []
    let processed = 0

    for (const session of sessions) {
      if (allEvents.length >= opts.limit) break

      const messages = queryMessages(db, session.id)
      if (messages.length === 0) {
        processed++
        continue
      }

      const turns = groupIntoTurns(messages)
      const events = buildSessionEvents(session, turns)
      const remaining = opts.limit - allEvents.length
      allEvents.push(...events.slice(0, remaining))

      processed++
      progress(processed, sessions.length, session.title || session.id)
    }

    console.error(
      `\nParsed ${allEvents.length} events from ${processed} sessions`
    )

    const result = await sendBatch(allEvents, opts)
    console.error(
      `Done: ${result.sent} sent, ${result.duplicates} duplicates, ${result.errors} errors`
    )
    return result
  } finally {
    db.close()
  }
}
