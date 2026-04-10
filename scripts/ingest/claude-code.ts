#!/usr/bin/env bun
/**
 * Backfill Claude Code chat histories from ~/.claude/projects/ JSONL files
 * into Factory webhook_events.
 */
import { readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import {
  type IngestEvent,
  type IngestOptions,
  type ToolCall,
  type ToolResult,
  classifyToolError,
  extractTextFromContent,
  extractToolCalls,
  extractToolNames,
  extractToolResults,
  fixLocalTimestamp,
  progress,
  resolveRepoContext,
  stripSystemTags,
  truncSummary,
  truncText,
} from "./lib/common"
import { sendBatch } from "./lib/ingest-client"

type JournalEntry = {
  type: string
  parentUuid?: string | null
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  gitBranch?: string
  version?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  data?: {
    type?: string
    message?: {
      type?: string
      model?: string
      content?: unknown
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    }
  }
  content?: string // queue-operation user prompt
}

type ToolError = {
  toolName: string
  error: string
  errorClass: string
}

type Turn = {
  index: number
  userText: string
  assistantText: string
  model?: string
  tokenUsage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  toolCalls: Array<{ name: string; input?: string }>
  toolErrors: ToolError[]
  timestamp: string
}

type SubagentInvocation = {
  toolUseId: string
  index: number
  description: string
  subagentType: string
  prompt: string
  resultText: string
  resultLen: number
  timestamp: string
}

function findJsonlFiles(projectsDir: string, since?: Date): string[] {
  const files: string[] = []
  if (!statSync(projectsDir, { throwIfNoEntry: false })?.isDirectory())
    return files

  for (const projectDir of readdirSync(projectsDir)) {
    const projectPath = join(projectsDir, projectDir)
    if (!statSync(projectPath).isDirectory()) continue

    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith(".jsonl")) continue
      const filePath = join(projectPath, file)
      if (since) {
        const stat = statSync(filePath)
        if (stat.mtime < since) continue
      }
      files.push(filePath)
    }
  }

  return files
}

function parseSession(
  filePath: string
): { events: IngestEvent[]; sessionId: string } | null {
  const sessionId = basename(filePath, ".jsonl")
  const fileContent = Bun.file(filePath)

  // Read and parse all lines
  const text = require("node:fs").readFileSync(filePath, "utf8") as string
  const lines = text.split("\n").filter((l: string) => l.trim())

  const entries: JournalEntry[] = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) return null

  // Extract session metadata from first entry with session info
  let cwd: string | undefined
  let gitBranch: string | undefined
  let version: string | undefined
  let project: string | undefined

  // In Claude Code JSONL, the message chain looks like:
  //   user(string prompt) → assistant(thinking) → assistant(tool_use) → user(tool_result) → ...repeat... → assistant(text)
  // The user(tool_result) entries are NOT real user prompts — they're automated tool responses.
  // A "real user prompt" has string content, not an array of tool_result blocks.
  //
  // We walk the entries linearly, starting a new turn each time we see a real user prompt.

  type RawEntry = {
    type: "user-prompt" | "user-tool-result" | "assistant"
    text: string
    model?: string
    usage?: JournalEntry["message"]["usage"]
    toolCalls: ToolCall[]
    toolResults: ToolResult[]
    timestamp: string
  }

  const timeline: RawEntry[] = []

  // Map tool_use_id -> tool_name for correlating errors with tool names
  const toolUseIdToName = new Map<string, string>()

  // Track Agent tool_use calls for subagent extraction
  const agentToolUses = new Map<
    string,
    {
      description: string
      subagentType: string
      prompt: string
      timestamp: string
    }
  >()
  const subagentInvocations: SubagentInvocation[] = []

  for (const entry of entries) {
    // Capture metadata from any entry that has it
    if (!cwd && entry.cwd) cwd = entry.cwd
    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch
    if (!version && entry.version) version = entry.version

    if (entry.type === "user" && entry.message) {
      const content = entry.message.content
      // Real user prompt: content is a string
      // Tool result: content is an array with tool_result blocks
      const isToolResult =
        Array.isArray(content) &&
        content.some((c: any) => c?.type === "tool_result")

      if (isToolResult) {
        // Check for Agent tool_result blocks → subagent completions
        if (Array.isArray(content)) {
          for (const c of content as any[]) {
            if (c?.type === "tool_result" && agentToolUses.has(c.tool_use_id)) {
              const info = agentToolUses.get(c.tool_use_id)!
              const resultText =
                typeof c.content === "string"
                  ? c.content
                  : Array.isArray(c.content)
                    ? (c.content as any[])
                        .map((b: any) => b.text ?? "")
                        .join("")
                    : ""
              subagentInvocations.push({
                toolUseId: c.tool_use_id,
                index: subagentInvocations.length,
                description: info.description,
                subagentType: info.subagentType,
                prompt: info.prompt,
                resultText,
                resultLen: resultText.length,
                timestamp: info.timestamp,
              })
            }
          }
        }
        timeline.push({
          type: "user-tool-result",
          text: "",
          toolCalls: [],
          toolResults: extractToolResults(content),
          timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
        })
      } else {
        // Real user prompt — extract text
        const text =
          typeof content === "string"
            ? content
            : extractTextFromContent(content)
        timeline.push({
          type: "user-prompt",
          text,
          toolCalls: [],
          toolResults: [],
          timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
        })
      }
    } else if (entry.type === "assistant" && entry.message) {
      const content = entry.message.content
      const calls = extractToolCalls(content)
      // Track tool_use_id -> name for error correlation, and Agent calls for subagent extraction
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "tool_use" && c.id && c.name) {
            toolUseIdToName.set(c.id, c.name)
            if (c.name === "Agent") {
              agentToolUses.set(c.id, {
                description: c.input?.description ?? "",
                subagentType: c.input?.subagent_type ?? "general-purpose",
                prompt: c.input?.prompt ?? "",
                timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
              })
            }
          }
        }
      }
      timeline.push({
        type: "assistant",
        text: extractTextFromContent(content),
        model: entry.message.model,
        usage: entry.message.usage,
        toolCalls: calls,
        toolResults: [],
        timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
      })
    } else if (
      entry.type === "progress" &&
      entry.data?.type === "assistant" &&
      entry.data?.message
    ) {
      const msg = entry.data.message
      // Also check progress entries for Agent tool_use
      if (Array.isArray(msg.content)) {
        for (const c of msg.content as any[]) {
          if (c?.type === "tool_use" && c.id && c.name) {
            toolUseIdToName.set(c.id, c.name)
            if (c.name === "Agent") {
              agentToolUses.set(c.id, {
                description: c.input?.description ?? "",
                subagentType: c.input?.subagent_type ?? "general-purpose",
                prompt: c.input?.prompt ?? "",
                timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
              })
            }
          }
        }
      }
      timeline.push({
        type: "assistant",
        text: extractTextFromContent(msg.content),
        model: msg.model,
        usage: msg.usage,
        toolCalls: extractToolCalls(msg.content),
        toolResults: [],
        timestamp: fixLocalTimestamp(entry.timestamp) ?? "",
      })
    }
  }

  // Resolve repo context from cwd
  const repoCtx = cwd ? resolveRepoContext(cwd) : {}
  if (cwd) {
    project = repoCtx.repoSlug ?? cwd.split("/").slice(-2).join("/")
  }

  // Group into turns: a turn starts at each "user-prompt" and includes all entries until the next "user-prompt"
  const turns: Turn[] = []
  let currentTurnStart = -1

  for (let i = 0; i <= timeline.length; i++) {
    const isNewPrompt =
      i < timeline.length && timeline[i].type === "user-prompt"
    const isEnd = i === timeline.length

    // When we hit a new prompt (or end), flush the previous turn
    if ((isNewPrompt || isEnd) && currentTurnStart >= 0) {
      const promptEntry = timeline[currentTurnStart]
      const turnEntries = timeline.slice(currentTurnStart + 1, i)

      const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      const allToolCalls: Turn["toolCalls"] = []
      const allToolErrors: ToolError[] = []
      let model: string | undefined
      let assistantText = ""

      for (const e of turnEntries) {
        if (e.type === "assistant") {
          if (e.usage) {
            totalUsage.input += e.usage.input_tokens ?? 0
            totalUsage.output += e.usage.output_tokens ?? 0
            totalUsage.cacheRead += e.usage.cache_read_input_tokens ?? 0
            totalUsage.cacheWrite += e.usage.cache_creation_input_tokens ?? 0
          }
          allToolCalls.push(...e.toolCalls)
          if (!model && e.model) model = e.model
          if (e.text) assistantText += (assistantText ? "\n" : "") + e.text
        } else if (e.type === "user-tool-result") {
          // Collect tool errors from tool_result blocks
          for (const tr of e.toolResults) {
            if (tr.isError && tr.error) {
              const toolName = toolUseIdToName.get(tr.toolUseId) ?? "unknown"
              allToolErrors.push({
                toolName,
                error: tr.error,
                errorClass: classifyToolError(tr.error),
              })
            }
          }
        }
      }

      // Strip system tags from the prompt text
      const cleanPrompt = stripSystemTags(promptEntry.text)

      // Skip empty turns (no real content)
      if (!cleanPrompt && !assistantText && allToolCalls.length === 0) continue

      turns.push({
        index: turns.length,
        userText: cleanPrompt,
        assistantText,
        model,
        tokenUsage: totalUsage,
        toolCalls: allToolCalls,
        toolErrors: allToolErrors,
        timestamp: promptEntry.timestamp,
      })
    }

    if (isNewPrompt) currentTurnStart = i
  }

  if (turns.length === 0) return null

  // Build events
  const events: IngestEvent[] = []

  // Session summary
  const allToolNames = [
    ...new Set(turns.flatMap((t) => t.toolCalls.map((tc) => tc.name))),
  ]
  const allErrors = turns.flatMap((t) => t.toolErrors)
  const totalTokens = turns.reduce(
    (acc, t) => ({
      input: acc.input + t.tokenUsage.input,
      output: acc.output + t.tokenUsage.output,
      cacheRead: acc.cacheRead + t.tokenUsage.cacheRead,
      cacheWrite: acc.cacheWrite + t.tokenUsage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )

  // Aggregate error stats for session summary
  const errorsByTool: Record<string, number> = {}
  const errorsByClass: Record<string, number> = {}
  for (const err of allErrors) {
    errorsByTool[err.toolName] = (errorsByTool[err.toolName] ?? 0) + 1
    errorsByClass[err.errorClass] = (errorsByClass[err.errorClass] ?? 0) + 1
  }

  const startedAt = turns[0].timestamp
  const endedAt = turns[turns.length - 1].timestamp
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : 0

  events.push({
    source: "claude-code",
    providerId: "local-backfill",
    deliveryId: `cc-session-${sessionId}`,
    eventType: "thread.summary",
    sessionId,
    timestamp: startedAt || new Date().toISOString(),
    cwd,
    project,
    payload: {
      sessionId,
      model: turns.find((t) => t.model)?.model ?? "unknown",
      project: project ?? cwd,
      gitBranch,
      gitRemoteUrl: repoCtx.gitRemoteUrl,
      repoSlug: repoCtx.repoSlug,
      repoName: repoCtx.repoName,
      cwd,
      startedAt,
      endedAt,
      durationMinutes: Math.round(durationMs / 60000),
      turnCount: turns.length,
      tokenUsage: totalTokens,
      toolsUsed: allToolNames,
      toolCallCount: turns.reduce((sum, t) => sum + t.toolCalls.length, 0),
      toolErrorCount: allErrors.length,
      toolErrorsByTool:
        Object.keys(errorsByTool).length > 0 ? errorsByTool : undefined,
      toolErrorsByClass:
        Object.keys(errorsByClass).length > 0 ? errorsByClass : undefined,
      version,
    },
  })

  // Turn events
  for (const turn of turns) {
    events.push({
      source: "claude-code",
      providerId: "local-backfill",
      deliveryId: `cc-turn-${sessionId}-${turn.index}`,
      eventType: "thread_turn.completed",
      sessionId,
      timestamp: turn.timestamp || startedAt,
      cwd,
      project,
      payload: {
        sessionId,
        turnIndex: turn.index,
        prompt: truncText(turn.userText),
        responseSummary: truncSummary(turn.assistantText),
        model: turn.model ?? "unknown",
        tokenUsage: turn.tokenUsage,
        toolCalls: turn.toolCalls.slice(0, 50),
        toolErrors: turn.toolErrors.length > 0 ? turn.toolErrors : undefined,
        timestamp: turn.timestamp,
      },
    })
  }

  // Subagent invocation events
  for (const sub of subagentInvocations) {
    events.push({
      source: "claude-code",
      providerId: "local-backfill",
      deliveryId: `cc-subagent-${sessionId}-${sub.index}`,
      eventType: "thread.subagent_summary",
      sessionId,
      timestamp: sub.timestamp || startedAt,
      cwd,
      project,
      payload: {
        parentSessionId: sessionId,
        subagentIndex: sub.index,
        subagentType: sub.subagentType,
        description: sub.description,
        prompt: truncText(sub.prompt),
        resultSummary: truncSummary(sub.resultText),
        resultLength: sub.resultLen,
        timestamp: sub.timestamp,
        cwd,
        gitBranch,
        gitRemoteUrl: repoCtx.gitRemoteUrl,
        repoSlug: repoCtx.repoSlug,
        repoName: repoCtx.repoName,
      },
    })
  }

  return { events, sessionId }
}

export async function ingestClaudeCode(opts: IngestOptions) {
  const projectsDir = join(homedir(), ".claude", "projects")
  console.error(`Scanning ${projectsDir} for JSONL session files...`)

  const files = findJsonlFiles(projectsDir, opts.since)
  console.error(`Found ${files.length} session files`)

  const allEvents: IngestEvent[] = []
  let processed = 0

  for (const file of files) {
    if (allEvents.length >= opts.limit) break

    try {
      const result = parseSession(file)
      if (result) {
        const remaining = opts.limit - allEvents.length
        allEvents.push(...result.events.slice(0, remaining))
      }
    } catch (err) {
      console.error(`  [skip] ${basename(file)}: ${err}`)
    }

    processed++
    progress(processed, files.length, basename(file))
  }

  console.error(`\nParsed ${allEvents.length} events from ${processed} files`)

  const result = await sendBatch(allEvents, opts)
  console.error(
    `Done: ${result.sent} sent, ${result.duplicates} duplicates, ${result.errors} errors`
  )
  return result
}
