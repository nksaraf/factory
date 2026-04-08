#!/usr/bin/env bun
/**
 * Cursor hook script — handles ALL Cursor hook events.
 *
 * Usage in .cursor/hooks/hooks.json:
 *   {
 *     "hooks": {
 *       "sessionStart": [{ "command": "bun run /path/to/cursor-hook.ts sessionStart" }],
 *       ...
 *     }
 *   }
 *
 * Receives hook payload as JSON on stdin. Event type comes from CLI arg.
 */

import { sendHookEvent } from "./lib/send-event"

const EVENT_TYPE_MAP: Record<string, string> = {
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

  const sessionId = (input.session_id as string) ?? (input.sessionId as string) ?? crypto.randomUUID()

  await sendHookEvent({
    source: "cursor",
    deliveryId: crypto.randomUUID(),
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    cwd: (input.cwd as string) ?? (input.workingDirectory as string),
    project: input.project as string | undefined,
    payload: buildPayload(hookEvent, input),
  })
}

function buildPayload(
  hookEvent: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (hookEvent) {
    case "beforeSubmitPrompt":
      return {
        prompt: input.prompt ?? input.message ?? input.content,
      }

    case "preToolUse":
    case "postToolUse":
    case "postToolUseFailure":
      return {
        tool_name: input.tool_name ?? input.toolName,
        tool_input: input.tool_input ?? input.toolInput ?? input.input,
        tool_output: input.tool_output ?? input.toolOutput ?? input.output,
        error: input.error,
      }

    case "beforeShellExecution":
    case "afterShellExecution":
      return {
        command: input.command,
        output: input.output,
        exitCode: input.exitCode ?? input.exit_code,
      }

    case "beforeMCPExecution":
    case "afterMCPExecution":
      return {
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
        filePath: input.filePath ?? input.file_path ?? input.path,
        changes: input.changes ?? input.diff,
      }

    case "afterAgentResponse":
    case "afterAgentThought":
      return {
        content: input.content ?? input.text ?? input.message,
      }

    default:
      return {}
  }
}

main()
