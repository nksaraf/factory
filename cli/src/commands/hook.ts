import { readFileSync } from "node:fs"

import type { DxBase } from "../dx-root.js"
import type { IngestEvent } from "../lib/ingest/common.js"
import { sendEvent } from "../lib/ingest/send.js"

/**
 * dx hook — called by IDE hook configs (Cursor, Claude Code), not by users directly.
 *
 * Usage:
 *   dx hook cursor <event>       (stdin: JSON payload)
 *   dx hook claude-code <event>  (stdin: JSON payload)
 *
 * This replaces the old `bun run scripts/ide-hooks/*.ts` approach so hooks
 * don't depend on the Factory repo source code being present.
 */
export function hookCommand(app: DxBase) {
  return app
    .sub("hook")
    .meta({
      description:
        "IDE hook handler (called by Cursor/Claude Code, not directly)",
    })
    .command("cursor", (c) =>
      c
        .meta({ description: "Handle a Cursor hook event" })
        .args([
          {
            name: "event",
            type: "string" as const,
            required: true,
            description: "Hook event name (e.g. sessionStart, preToolUse)",
          },
        ])
        .run(async ({ args }) => {
          await handleCursorEvent(args.event)
        })
    )
    .command("claude-code", (c) =>
      c
        .meta({ description: "Handle a Claude Code hook event" })
        .args([
          {
            name: "event",
            type: "string" as const,
            required: true,
            description: "Hook event name (e.g. SessionStart, PreToolUse)",
          },
        ])
        .run(async ({ args }) => {
          await handleClaudeCodeEvent(args.event)
        })
    )
}

// ── Stdin reader ──────────────────────────────────────────────

async function readStdinJson(): Promise<Record<string, unknown>> {
  try {
    const text = await Bun.stdin.text()
    if (text.trim()) return JSON.parse(text)
  } catch {
    // No stdin or invalid JSON
  }
  return {}
}

// ── Cursor ────────────────────────────────────────────────────

const CURSOR_EVENT_MAP: Record<string, string> = {
  sessionStart: "session.start",
  sessionEnd: "session.end",
  beforeSubmitPrompt: "prompt.submit",
  preToolUse: "tool.pre",
  postToolUse: "tool.post",
  postToolUseFailure: "tool.fail",
  beforeShellExecution: "shell.pre",
  afterShellExecution: "shell.post",
  beforeMCPExecution: "mcp.pre",
  afterMCPExecution: "mcp.post",
  beforeReadFile: "file.read",
  afterFileEdit: "file.edit",
  beforeTabFileRead: "tab.read",
  afterTabFileEdit: "tab.edit",
  subagentStart: "subagent.start",
  subagentStop: "subagent.stop",
  afterAgentResponse: "agent.response",
  afterAgentThought: "agent.thought",
  preCompact: "context.compact",
  stop: "agent.stop",
}

async function handleCursorEvent(hookEvent: string): Promise<void> {
  const eventType = CURSOR_EVENT_MAP[hookEvent]
  if (!eventType) return

  const input = await readStdinJson()

  const sessionId =
    (input.session_id as string) ??
    (input.sessionId as string) ??
    crypto.randomUUID()

  const event: IngestEvent = {
    source: "cursor",
    deliveryId: crypto.randomUUID(),
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    cwd: (input.cwd as string) ?? (input.workingDirectory as string),
    project: input.project as string | undefined,
    payload: buildCursorPayload(hookEvent, input),
  }

  try {
    await sendEvent(event)
  } catch {
    // Silent failure — never crash the IDE
  }
}

function buildCursorPayload(
  hookEvent: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  const model = input.model ?? input.modelName
  if (model) base.model = model
  const usage = input.usage ?? input.tokenUsage ?? input.token_usage
  if (usage) base.tokenUsage = usage

  switch (hookEvent) {
    case "sessionStart":
      return { ...base, source: input.source }

    case "beforeSubmitPrompt":
      return { ...base, prompt: input.prompt ?? input.message ?? input.content }

    case "preToolUse":
    case "postToolUse":
    case "postToolUseFailure":
      return {
        ...base,
        tool_name: input.tool_name ?? input.toolName,
        tool_input: input.tool_input ?? input.toolInput ?? input.input,
        tool_output: input.tool_output ?? input.toolOutput ?? input.output,
        error: input.error,
      }

    case "beforeShellExecution":
    case "afterShellExecution":
      return {
        ...base,
        command: input.command,
        output: input.output,
        exitCode: input.exitCode ?? input.exit_code,
      }

    case "beforeMCPExecution":
    case "afterMCPExecution":
      return {
        ...base,
        tool_name: input.tool_name ?? input.toolName,
        server: input.server ?? input.serverName,
        input: input.input ?? input.tool_input,
        output: input.output ?? input.tool_output,
      }

    case "beforeReadFile":
    case "afterFileEdit":
    case "beforeTabFileRead":
    case "afterTabFileEdit":
      return {
        ...base,
        filePath: input.filePath ?? input.file_path ?? input.path,
        changes: input.changes ?? input.diff,
      }

    case "afterAgentResponse":
    case "afterAgentThought":
      return { ...base, content: input.content ?? input.text ?? input.message }

    case "stop":
      return { ...base, stop_reason: input.stop_reason ?? input.stopReason }

    case "sessionEnd":
      return { ...base, end_reason: input.end_reason ?? input.endReason }

    default:
      return base
  }
}

// ── Claude Code ───────────────────────────────────────────────

const CLAUDE_EVENT_MAP: Record<string, string> = {
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

async function handleClaudeCodeEvent(hookEvent: string): Promise<void> {
  const eventType = CLAUDE_EVENT_MAP[hookEvent]
  if (!eventType) return

  const input = await readStdinJson()

  const sessionId = (input.session_id as string) ?? crypto.randomUUID()

  const event: IngestEvent = {
    source: "claude-code",
    deliveryId: crypto.randomUUID(),
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    cwd: input.cwd as string | undefined,
    project: input.project as string | undefined,
    payload: buildClaudePayload(hookEvent, input),
  }

  try {
    await sendEvent(event)
  } catch {
    // Silent failure — never crash the IDE
  }
}

function buildClaudePayload(
  hookEvent: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  if (input.permission_mode) base.permissionMode = input.permission_mode

  switch (hookEvent) {
    case "SessionStart":
      return { ...base, model: input.model, source: input.source }

    case "UserPromptSubmit":
      return { ...base, prompt: input.prompt ?? input.message }

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
      const stats = parseTranscriptStats(
        input.transcript_path as string | undefined
      )
      return { ...base, stop_reason: input.stop_reason, ...stats }
    }

    case "StopFailure":
      return {
        ...base,
        error_type: input.error_type,
        error_message: input.error_message,
      }

    case "SubagentStart":
      return { ...base, agent_id: input.agent_id, agent_type: input.agent_type }

    case "SubagentStop":
      return { ...base, agent_id: input.agent_id, agent_type: input.agent_type }

    case "PreCompact":
    case "PostCompact":
      return { ...base, trigger: input.trigger }

    case "SessionEnd": {
      const stats = parseTranscriptStats(
        input.transcript_path as string | undefined
      )
      return { ...base, end_reason: input.end_reason, ...stats }
    }

    default:
      return base
  }
}

/**
 * Parse the local transcript JSONL to extract token usage, model, and turn count.
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

      if (entry.type === "assistant" && entry.message) {
        if (!model && entry.message.model) model = entry.message.model
        const usage = entry.message.usage
        if (usage) {
          tokenUsage.input += usage.input_tokens ?? 0
          tokenUsage.output += usage.output_tokens ?? 0
          tokenUsage.cacheRead += usage.cache_read_input_tokens ?? 0
          tokenUsage.cacheWrite += usage.cache_creation_input_tokens ?? 0
        }
        if (Array.isArray(entry.message.content)) {
          for (const c of entry.message.content) {
            if (c?.type === "tool_use") {
              toolCallCount++
              if (c.name) toolNames.add(c.name)
            }
          }
        }
      }

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
      toolsUsed: Array.from(toolNames),
      tokenUsage,
    }
  } catch {
    return {}
  }
}
