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
  classifyToolError,
  extractTextFromContent,
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
import {
  sendBatch,
  sendMessages,
  uploadDocument,
  uploadDocumentVersion,
} from "./send.js"
import { parseClaudeCodeSession } from "@smp/factory-shared/adapters/claude-code.adapter"

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
    stop_reason?: string
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

// ── Session parsing (hook-compatible replay) ────────────────
//
// Walks the JSONL transcript and emits the same fine-grained events that
// the live hook script would have sent: session.start, prompt.submit,
// tool.pre, tool.post, agent.stop, subagent.start/stop, session.end.
//
// Delivery IDs are deterministic so re-running scan is idempotent:
//   cc-{eventType}-{sessionId}-{sequenceIndex}

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
  let model: string | undefined

  // Counters for deterministic delivery IDs per event type
  const seq: Record<string, number> = {}
  function nextDeliveryId(eventType: string): string {
    const n = seq[eventType] ?? 0
    seq[eventType] = n + 1
    return `cc-${eventType.replace(/\./g, "-")}-${sessionId}-${n}`
  }

  // Accumulate token usage for session.end summary
  const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let turnCount = 0
  let toolCallCount = 0
  const toolNames = new Set<string>()
  const toolErrors: ToolError[] = []
  const toolUseIdToName = new Map<string, string>()

  // Track seen tool_use IDs to avoid duplicate tool.pre from progress entries
  const emittedToolPre = new Set<string>()

  // Build events by walking the transcript
  const events: IngestEvent[] = []
  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined

  function makeEvent(
    eventType: string,
    timestamp: string,
    payload: Record<string, unknown>
  ): IngestEvent {
    const ts = fixLocalTimestamp(timestamp) ?? timestamp
    if (!firstTimestamp) firstTimestamp = ts
    lastTimestamp = ts
    return {
      source: "claude-code",
      deliveryId: nextDeliveryId(eventType),
      eventType,
      sessionId,
      timestamp: ts,
      cwd,
      project,
      payload: { sessionId, ...payload },
    }
  }

  // First pass: extract metadata
  for (const entry of entries) {
    if (!cwd && entry.cwd) cwd = entry.cwd
    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch
    if (!version && entry.version) version = entry.version
  }

  const repoCtx = cwd ? resolveRepoContext(cwd) : {}
  if (cwd) {
    project = repoCtx.repoSlug ?? cwd.split("/").slice(-2).join("/")
  }

  // Second pass: emit events
  let sessionStartEmitted = false

  for (const entry of entries) {
    const ts = entry.timestamp ?? ""

    // Emit session.start on first meaningful entry
    if (
      !sessionStartEmitted &&
      (entry.type === "user" || entry.type === "assistant")
    ) {
      sessionStartEmitted = true
      events.push(
        makeEvent("session.start", ts, {
          model: entry.message?.model,
          source: "startup",
          cwd,
          gitBranch,
          gitRemoteUrl: repoCtx.gitRemoteUrl,
          repoSlug: repoCtx.repoSlug,
          repoName: repoCtx.repoName,
        })
      )
    }

    if (entry.type === "user" && entry.message) {
      const content = entry.message.content
      const isToolResult =
        Array.isArray(content) &&
        content.some((c: any) => c?.type === "tool_result")

      if (isToolResult && Array.isArray(content)) {
        // tool.post events for each tool_result
        for (const c of content as any[]) {
          if (c?.type !== "tool_result") continue
          const toolName = toolUseIdToName.get(c.tool_use_id) ?? "unknown"
          const output =
            typeof c.content === "string"
              ? c.content
              : Array.isArray(c.content)
                ? (c.content as any[]).map((b: any) => b.text ?? "").join("")
                : ""
          const isError = c.is_error === true

          if (isError) {
            events.push(
              makeEvent("tool.post_failure", ts, {
                tool_name: toolName,
                tool_input: undefined,
                error: truncText(output),
              })
            )
            toolErrors.push({
              toolName,
              error: output,
              errorClass: classifyToolError(output),
            })
          } else {
            events.push(
              makeEvent("tool.post", ts, {
                tool_name: toolName,
                tool_input: undefined,
                tool_output: truncText(output),
              })
            )
          }
        }
      } else {
        // prompt.submit — real user prompt
        const promptText =
          typeof content === "string"
            ? content
            : extractTextFromContent(content)
        const clean = stripSystemTags(promptText)
        if (clean) {
          turnCount++
          events.push(
            makeEvent("prompt.submit", ts, {
              prompt: truncText(clean),
            })
          )
        }
      }
    } else if (entry.type === "assistant" && entry.message) {
      const msg = entry.message
      if (!model && msg.model) model = msg.model

      // Accumulate usage
      if (msg.usage) {
        totalTokens.input += msg.usage.input_tokens ?? 0
        totalTokens.output += msg.usage.output_tokens ?? 0
        totalTokens.cacheRead += msg.usage.cache_read_input_tokens ?? 0
        totalTokens.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0
      }

      // Emit tool.pre for each tool_use in this message
      if (Array.isArray(msg.content)) {
        for (const c of msg.content as any[]) {
          if (c?.type === "tool_use" && c.id && c.name) {
            toolUseIdToName.set(c.id, c.name)
            toolCallCount++
            toolNames.add(c.name)

            if (!emittedToolPre.has(c.id)) {
              emittedToolPre.add(c.id)

              // Subagent start
              if (c.name === "Agent") {
                events.push(
                  makeEvent("subagent.start", ts, {
                    agent_id: c.id,
                    agent_type: c.input?.subagent_type ?? "general-purpose",
                    description: c.input?.description,
                  })
                )
              }

              events.push(
                makeEvent("tool.pre", ts, {
                  tool_name: c.name,
                  tool_input:
                    typeof c.input === "string"
                      ? c.input.slice(0, 2048)
                      : JSON.stringify(c.input ?? "").slice(0, 2048),
                })
              )
            }
          }
        }
      }

      // Emit agent.stop when the assistant message has stop_reason
      if (msg.stop_reason) {
        const responseText = extractTextFromContent(msg.content)
        events.push(
          makeEvent("agent.stop", ts, {
            stop_reason: msg.stop_reason,
            model: normalizeModel(msg.model),
            tokenUsage: { ...totalTokens },
            turnCount,
            toolCallCount,
            toolsUsed: [...toolNames],
            responseSummary: truncSummary(responseText),
          })
        )
      }
    } else if (
      entry.type === "progress" &&
      entry.data?.type === "assistant" &&
      entry.data?.message
    ) {
      const msg = entry.data.message
      if (!model && msg.model) model = msg.model

      if (msg.usage) {
        totalTokens.input += msg.usage.input_tokens ?? 0
        totalTokens.output += msg.usage.output_tokens ?? 0
        totalTokens.cacheRead += msg.usage.cache_read_input_tokens ?? 0
        totalTokens.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0
      }

      if (Array.isArray(msg.content)) {
        for (const c of msg.content as any[]) {
          if (c?.type === "tool_use" && c.id && c.name) {
            toolUseIdToName.set(c.id, c.name)

            if (!emittedToolPre.has(c.id)) {
              emittedToolPre.add(c.id)
              toolCallCount++
              toolNames.add(c.name)

              if (c.name === "Agent") {
                events.push(
                  makeEvent("subagent.start", ts, {
                    agent_id: c.id,
                    agent_type: c.input?.subagent_type ?? "general-purpose",
                    description: c.input?.description,
                  })
                )
              }

              events.push(
                makeEvent("tool.pre", ts, {
                  tool_name: c.name,
                  tool_input:
                    typeof c.input === "string"
                      ? c.input.slice(0, 2048)
                      : JSON.stringify(c.input ?? "").slice(0, 2048),
                })
              )
            }
          }
        }
      }
    }
  }

  if (events.length === 0) return null

  // Emit session.end with aggregated stats
  const startedAt = firstTimestamp ?? ""
  const endedAt = lastTimestamp ?? ""
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : 0

  const errorsByTool: Record<string, number> = {}
  const errorsByClass: Record<string, number> = {}
  for (const err of toolErrors) {
    errorsByTool[err.toolName] = (errorsByTool[err.toolName] ?? 0) + 1
    errorsByClass[err.errorClass] = (errorsByClass[err.errorClass] ?? 0) + 1
  }

  events.push(
    makeEvent("session.end", endedAt || new Date().toISOString(), {
      model: normalizeModel(model),
      tokenUsage: totalTokens,
      turnCount,
      toolCallCount,
      toolsUsed: [...toolNames],
      toolErrorCount: toolErrors.length,
      toolErrorsByTool:
        Object.keys(errorsByTool).length > 0 ? errorsByTool : undefined,
      toolErrorsByClass:
        Object.keys(errorsByClass).length > 0 ? errorsByClass : undefined,
      durationMinutes: Math.round(durationMs / 60000),
      startedAt,
      endedAt,
      cwd,
      gitBranch,
      gitRemoteUrl: repoCtx.gitRemoteUrl,
      repoSlug: repoCtx.repoSlug,
      repoName: repoCtx.repoName,
      version,
    })
  )

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

function flattenThreadMessages(
  thread: ReturnType<typeof parseClaudeCodeSession>
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = thread.messages as any[]
  for (const child of thread.childThreads) {
    msgs.push(...flattenThreadMessages(child))
  }
  return msgs
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

  // Message-path: parse sessions via adapter and send to /messages/ingest
  // This populates org.message + org.tool_call + org.exchange (lossless)
  console.error(`  Ingesting messages via IR adapter...`)
  let msgInserted = 0
  let msgErrors = 0
  for (const file of files) {
    try {
      const sessionId = basename(file, ".jsonl")
      const irThread = parseClaudeCodeSession(file, sessionId)
      const allMessages = flattenThreadMessages(irThread)
      if (allMessages.length > 0) {
        const result = await sendMessages(
          irThread.id,
          allMessages as unknown as Record<string, unknown>[],
          opts
        )
        msgInserted += result.inserted
      }
    } catch (err) {
      msgErrors++
      if (opts.verbose) console.error(`  [msg-err] ${basename(file)}: ${err}`)
    }
  }
  console.error(`  Messages: ${msgInserted} inserted, ${msgErrors} errors`)

  return sendBatch(allEvents, opts)
}
