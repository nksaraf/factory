#!/usr/bin/env bun
/**
 * Claude Code hook script — handles ALL hook events.
 *
 * Usage in ~/.claude/settings.json:
 *   "hooks": {
 *     "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bun run /path/to/claude-code-hook.ts SessionStart" }] }],
 *     ...
 *   }
 *
 * Receives hook payload as JSON on stdin. Event type comes from CLI arg.
 *
 * On Stop/SessionEnd, parses the local transcript JSONL to extract token usage,
 * model, and turn count — so the server gets rich metadata without needing `dx scan`.
 */
import { readFileSync, appendFileSync, mkdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { sendHookEvent } from "./lib/send-event"

const HOOK_STATE_DIR = join(homedir(), ".claude", "hook-state")

/**
 * Deterministic per-session, per-event-type delivery IDs so scan-backfill and
 * live hooks produce the same IDs and deduplicate at the ingest layer. Format
 * matches scan output: cc-{eventType-with-dashes}-{sessionId}-{n}.
 *
 * Concurrency: Claude Code fans out hook subprocesses in parallel. A
 * read-modify-write JSON counter races. Instead, maintain a marker file per
 * (session, eventType): appendFileSync of a single byte is atomic on POSIX, so
 * the post-append size uniquely identifies this invocation's slot (n = size - 1).
 */
function nextDeliveryId(sessionId: string, eventType: string): string {
  try {
    mkdirSync(HOOK_STATE_DIR, { recursive: true })
    const marker = join(HOOK_STATE_DIR, `${sessionId}.${eventType}`)
    appendFileSync(marker, ".")
    const n = statSync(marker).size - 1
    return `cc-${eventType.replace(/\./g, "-")}-${sessionId}-${n}`
  } catch {
    return `cc-${eventType.replace(/\./g, "-")}-${sessionId}-${crypto.randomUUID()}`
  }
}

const EVENT_TYPE_MAP: Record<string, string> = {
  SessionStart: "session.start",
  SessionEnd: "session.end",
  UserPromptSubmit: "prompt.submit",
  PreToolUse: "tool.pre",
  PostToolUse: "tool.post",
  PostToolUseFailure: "tool.post_failure",
  Stop: "agent.stop",
  StopFailure: "agent.stop_failure",
  SubagentStart: "subagent.start",
  SubagentStop: "subagent.stop",
  PreCompact: "context.pre_compact",
  PostCompact: "context.post_compact",
}

async function main() {
  const hookEvent = process.argv[2]
  if (!hookEvent) return

  const eventType = EVENT_TYPE_MAP[hookEvent]
  if (!eventType) return

  // Read JSON payload from stdin
  let input: Record<string, unknown> = {}
  try {
    const stdinText = await Bun.stdin.text()
    if (stdinText.trim()) {
      input = JSON.parse(stdinText)
    }
  } catch {
    // No stdin or invalid JSON — proceed with empty payload
  }

  const sessionId = (input.session_id as string) ?? crypto.randomUUID()

  await sendHookEvent({
    source: "claude-code",
    deliveryId: nextDeliveryId(sessionId, eventType),
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    cwd: input.cwd as string | undefined,
    project: input.project as string | undefined,
    payload: buildPayload(hookEvent, input),
  })
}

function buildPayload(
  hookEvent: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  // Common metadata available on all hooks
  const base: Record<string, unknown> = {}
  if (input.permission_mode) base.permissionMode = input.permission_mode

  switch (hookEvent) {
    case "SessionStart":
      return {
        ...base,
        model: input.model, // Available since Claude Code sends model on session start
        source: input.source, // "startup" | "resume" | "clear" | "compact"
      }

    case "UserPromptSubmit":
      return {
        ...base,
        prompt: input.prompt ?? input.message,
      }

    case "PreToolUse":
      return {
        ...base,
        tool_name: input.tool_name,
        tool_input: input.tool_input,
      }

    case "PostToolUse":
      return {
        ...base,
        tool_name: input.tool_name,
        tool_input: input.tool_input,
        tool_output: input.tool_output,
      }

    case "PostToolUseFailure":
      return {
        ...base,
        tool_name: input.tool_name,
        tool_input: input.tool_input,
        error: input.error,
      }

    case "Stop": {
      const transcriptStats = parseTranscriptStats(
        input.transcript_path as string | undefined
      )
      return {
        ...base,
        stop_reason: input.stop_reason, // "tool_use" | "end_turn" | "max_tokens"
        ...transcriptStats,
      }
    }

    case "StopFailure":
      return {
        ...base,
        error_type: input.error_type, // "rate_limit" | "authentication_failed" | "billing_error" | etc.
        error_message: input.error_message,
      }

    case "SubagentStart":
      return {
        ...base,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
      }

    case "SubagentStop":
      return {
        ...base,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
      }

    case "PreCompact":
      return {
        ...base,
        trigger: input.trigger, // "manual" | "auto"
      }

    case "PostCompact":
      return {
        ...base,
        trigger: input.trigger,
      }

    case "SessionEnd": {
      const transcriptStats = parseTranscriptStats(
        input.transcript_path as string | undefined
      )
      return {
        ...base,
        end_reason: input.end_reason,
        ...transcriptStats,
      }
    }

    default:
      return base
  }
}

/**
 * Parse the local transcript JSONL to extract token usage, model, and turn count.
 * This runs on the user's machine where the file exists.
 * Best-effort: returns empty object if anything fails.
 */
function parseTranscriptStats(
  transcriptPath: string | undefined
): Record<string, unknown> {
  if (!transcriptPath) return {}

  try {
    const text = readFileSync(transcriptPath, "utf8")
    const lines = text.split("\n").filter((l) => l.trim())

    let model: string | undefined
    let turnCount = 0
    let toolCallCount = 0
    const toolNames = new Set<string>()
    const tokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

    for (const line of lines) {
      let entry: any
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      // Count user prompts as turns
      if (
        entry.type === "user" &&
        entry.message?.content &&
        !(
          Array.isArray(entry.message.content) &&
          entry.message.content.some((c: any) => c?.type === "tool_result")
        )
      ) {
        turnCount++
      }

      // Extract model and token usage from assistant messages
      if (entry.type === "assistant" && entry.message) {
        if (!model && entry.message.model) model = entry.message.model
        const usage = entry.message.usage
        if (usage) {
          tokenUsage.input += usage.input_tokens ?? 0
          tokenUsage.output += usage.output_tokens ?? 0
          tokenUsage.cacheRead += usage.cache_read_input_tokens ?? 0
          tokenUsage.cacheWrite += usage.cache_creation_input_tokens ?? 0
        }
        // Count tool calls
        if (Array.isArray(entry.message.content)) {
          for (const c of entry.message.content) {
            if (c?.type === "tool_use") {
              toolCallCount++
              if (c.name) toolNames.add(c.name)
            }
          }
        }
      }

      // Also check progress events for usage
      if (
        entry.type === "progress" &&
        entry.data?.type === "assistant" &&
        entry.data?.message
      ) {
        const msg = entry.data.message
        if (!model && msg.model) model = msg.model
        const usage = msg.usage
        if (usage) {
          tokenUsage.input += usage.input_tokens ?? 0
          tokenUsage.output += usage.output_tokens ?? 0
          tokenUsage.cacheRead += usage.cache_read_input_tokens ?? 0
          tokenUsage.cacheWrite += usage.cache_creation_input_tokens ?? 0
        }
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c?.type === "tool_use") {
              toolCallCount++
              if (c.name) toolNames.add(c.name)
            }
          }
        }
      }
    }

    return {
      model,
      turnCount,
      toolCallCount,
      toolsUsed: [...toolNames],
      tokenUsage,
    }
  } catch {
    return {}
  }
}

main()
