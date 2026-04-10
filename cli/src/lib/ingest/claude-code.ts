/**
 * Claude Code JSONL session parser.
 * Reads ~/.claude/projects/ JSONL files and produces IngestEvents.
 * Adapted from scripts/ingest/claude-code.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import {
  type IngestEvent,
  type IngestOptions,
  type IngestResult,
  type ToolCall,
  type ToolResult,
  classifyToolError,
  extractTextFromContent,
  extractToolCalls,
  extractToolResults,
  fixLocalTimestamp,
  getClaudeCodeProjectsDir,
  normalizeModel,
  resolveRepoContext,
  stripSystemTags,
  truncSummary,
  truncText,
} from "./common.js"
import {
  type GroupedPlan,
  type PlanEditSummary,
  type PlanSnapshot,
  extractPlansFromTranscript,
  groupPlanSnapshots,
} from "./plan-extractor.js"
import { sendBatch, uploadDocument, uploadDocumentVersion } from "./send.js"

// ── Types ────────────────────────────────────────────────────

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
  content?: string
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

// ── File discovery ───────────────────────────────────────────

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

// ── Session parsing ──────────────────────────────────────────

function parseSession(
  filePath: string
): { events: IngestEvent[]; sessionId: string } | null {
  const sessionId = basename(filePath, ".jsonl")
  const text = readFileSync(filePath, "utf8")
  const lines = text.split("\n").filter((l) => l.trim())

  const entries: JournalEntry[] = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {}
  }

  if (entries.length === 0) return null

  let cwd: string | undefined
  let gitBranch: string | undefined
  let version: string | undefined
  let project: string | undefined

  type RawEntry = {
    type: "user-prompt" | "user-tool-result" | "assistant"
    text: string
    model?: string
    usage?: NonNullable<JournalEntry["message"]>["usage"]
    toolCalls: ToolCall[]
    toolResults: ToolResult[]
    timestamp: string
  }

  const timeline: RawEntry[] = []
  const toolUseIdToName = new Map<string, string>()
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
    if (!cwd && entry.cwd) cwd = entry.cwd
    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch
    if (!version && entry.version) version = entry.version

    if (entry.type === "user" && entry.message) {
      const content = entry.message.content
      const isToolResult =
        Array.isArray(content) &&
        content.some((c: any) => c?.type === "tool_result")

      if (isToolResult) {
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

  // Resolve repo context
  const repoCtx = cwd ? resolveRepoContext(cwd) : {}
  if (cwd) {
    project = repoCtx.repoSlug ?? cwd.split("/").slice(-2).join("/")
  }

  // Group into turns
  const turns: Turn[] = []
  let currentTurnStart = -1

  for (let i = 0; i <= timeline.length; i++) {
    const isNewPrompt =
      i < timeline.length && timeline[i].type === "user-prompt"
    const isEnd = i === timeline.length

    if ((isNewPrompt || isEnd) && currentTurnStart >= 0) {
      const promptEntry = timeline[currentTurnStart]
      const turnEntries = timeline.slice(currentTurnStart + 1, i)

      const totalUsage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      }
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

      const cleanPrompt = stripSystemTags(promptEntry.text)
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

  // Session summary
  events.push({
    source: "claude-code",

    deliveryId: `cc-session-${sessionId}`,
    eventType: "thread.summary",
    sessionId,
    timestamp: startedAt || new Date().toISOString(),
    cwd,
    project,
    payload: {
      sessionId,
      model: normalizeModel(turns.find((t) => t.model)?.model),
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
        model: normalizeModel(turn.model),
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

// ── Plan upload ──────────────────────────────────────────────

async function uploadPlans(
  plans: GroupedPlan[],
  opts: { dryRun: boolean; verbose: boolean }
): Promise<{ uploaded: number; duplicates: number; errors: number }> {
  let uploaded = 0
  let duplicates = 0
  let errors = 0

  for (const plan of plans) {
    // Upsert the document identity (no content — content lives in versions)
    try {
      const result = await uploadDocument({
        slug: plan.slug,
        type: "plan",
        source: "claude-code",
        title: plan.title,
        contentHash: plan.versions[plan.versions.length - 1]?.contentHash,
        spec: {
          title: plan.title,
          slug: plan.slug,
          project: plan.versions[plan.versions.length - 1]?.project,
          titleHistory: plan.titleHistory,
          editCount: plan.totalEdits,
          sessionsInvolved: plan.sessionsInvolved,
        },
        dryRun: opts.dryRun,
      })
      if (result.duplicate) {
        duplicates++
      } else {
        uploaded++
      }

      // Upload each version snapshot
      for (const version of plan.versions) {
        try {
          await uploadDocumentVersion({
            slug: plan.slug,
            content: version.content,
            source: "claude-code",
            spec: {
              title: version.title,
              project: version.project,
            },
            dryRun: opts.dryRun,
          })
        } catch (err) {
          if (opts.verbose)
            console.error(
              `  [plan-err] ${plan.slug} v${version.version}: ${err}`
            )
          errors++
        }
      }
    } catch (err) {
      if (opts.verbose) console.error(`  [plan-err] ${plan.slug}: ${err}`)
      errors++
    }
  }

  return { uploaded, duplicates, errors }
}

// ── Public API ───────────────────────────────────────────────

export function countSessions(): number {
  const dir = getClaudeCodeProjectsDir()
  if (!dir) return 0
  return findJsonlFiles(dir).length
}

export async function ingestClaudeCode(
  opts: IngestOptions
): Promise<IngestResult> {
  const projectsDir = getClaudeCodeProjectsDir()
  if (!projectsDir) return { sent: 0, duplicates: 0, errors: 0 }
  const files = findJsonlFiles(projectsDir, opts.since)

  if (files.length === 0) {
    return { sent: 0, duplicates: 0, errors: 0 }
  }

  console.error(`  Found ${files.length} session files`)

  const allEvents: IngestEvent[] = []
  const allPlanSnapshots: PlanSnapshot[] = []
  const allPlanEdits: PlanEditSummary[] = []
  let processed = 0

  for (const file of files) {
    if (allEvents.length >= opts.limit) break

    const sessionId = basename(file, ".jsonl")
    // Derive project from directory structure: ~/.claude/projects/{projectDir}/{sessionId}.jsonl
    const projectDir = basename(join(file, ".."))

    try {
      const result = parseSession(file)
      if (result) {
        const remaining = opts.limit - allEvents.length
        allEvents.push(...result.events.slice(0, remaining))
      }
    } catch (err) {
      if (opts.verbose) console.error(`  [skip] ${basename(file)}: ${err}`)
    }

    // Extract plans from this session
    try {
      const planResult = extractPlansFromTranscript(file, sessionId, projectDir)
      allPlanSnapshots.push(...planResult.snapshots)
      allPlanEdits.push(...planResult.edits)
    } catch (err) {
      if (opts.verbose) console.error(`  [plan-skip] ${basename(file)}: ${err}`)
    }

    processed++
    if (processed % 50 === 0 || processed === files.length) {
      console.error(
        `  [${processed}/${files.length}] ${basename(files[processed - 1])}`
      )
    }
  }

  console.error(`  Parsed ${allEvents.length} events from ${processed} files`)

  // Group and upload plans
  const groupedPlans = groupPlanSnapshots(allPlanSnapshots, allPlanEdits)
  if (groupedPlans.length > 0) {
    console.error(
      `  Found ${groupedPlans.length} plans (${allPlanSnapshots.length} versioned snapshots)`
    )
    const planResult = await uploadPlans(groupedPlans, opts)
    console.error(
      `  Plans: ${planResult.uploaded} uploaded, ${planResult.duplicates} duplicates, ${planResult.errors} errors`
    )
  }

  return sendBatch(allEvents, opts)
}
