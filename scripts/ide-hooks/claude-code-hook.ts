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
 */

import { sendHookEvent } from "./lib/send-event"

const EVENT_TYPE_MAP: Record<string, string> = {
  SessionStart: "session.start",
  SessionEnd: "session.end",
  UserPromptSubmit: "prompt.submit",
  PreToolUse: "tool.pre",
  PostToolUse: "tool.post",
  Stop: "agent.stop",
  SubagentStop: "subagent.stop",
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
    deliveryId: crypto.randomUUID(),
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
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (hookEvent) {
    case "UserPromptSubmit":
      return {
        prompt: input.prompt ?? input.message,
      }

    case "PreToolUse":
      return {
        tool_name: input.tool_name,
        tool_input: input.tool_input,
      }

    case "PostToolUse":
      return {
        tool_name: input.tool_name,
        tool_input: input.tool_input,
        tool_output: input.tool_output,
      }

    case "Stop":
      return {
        transcript_path: input.transcript_path,
      }

    case "SubagentStop":
      return {
        transcript_path: input.transcript_path,
      }

    case "SessionStart":
      return {}

    case "SessionEnd":
      return {}

    default:
      return {}
  }
}

main()
