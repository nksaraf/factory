import type {
  IRMessage,
  IRThread,
  DerivedHookEvent,
} from "../schemas/message-ir.js"

/**
 * Adapter interface for converting between agent-native transcript formats and
 * the universal IR. Each coding agent (Claude Code, Cursor, Codex, etc.) gets
 * one adapter that implements both directions.
 */
export interface MessageAdapter<TRaw> {
  source: string

  /** Batch parse: full transcript → IR thread tree (with sub-agents). */
  parseTranscript(raw: TRaw, threadId: string): IRThread

  /** Incremental parse: new entries since cursor position. */
  parseIncremental?(
    raw: TRaw,
    threadId: string,
    cursor: number
  ): { messages: IRMessage[]; newCursor: number }

  /** Reconstruct agent-native format from IR (for session resume). */
  reconstructTranscript(thread: IRThread): TRaw
}

/**
 * Derive hook events from an IR thread tree. Works for any agent — hooks are
 * a projection of messages, not a stored entity.
 */
export function deriveHookEvents(thread: IRThread): DerivedHookEvent[] {
  const hooks: DerivedHookEvent[] = []

  hooks.push({
    type: "session.start",
    threadId: thread.id,
    messageSequence: -1,
  })

  for (const msg of thread.messages) {
    if (msg.role === "user") {
      const hasText = msg.content.some(
        (b: Record<string, unknown>) => b.type === "text"
      )
      const hasToolResult = msg.content.some(
        (b: Record<string, unknown>) => b.type === "tool_result"
      )

      if (hasText && !hasToolResult) {
        hooks.push({
          type: "prompt.submit",
          threadId: thread.id,
          messageSequence: msg.sequence,
        })
      }

      for (const block of msg.content) {
        if (block.type === "tool_result") {
          const isErr = (block as Record<string, unknown>).is_error === true
          const toolUseId = (block as Record<string, unknown>)
            .tool_use_id as string
          hooks.push({
            type: isErr ? "tool.post_failure" : "tool.post",
            threadId: thread.id,
            messageSequence: msg.sequence,
            toolUseId,
            isError: isErr || undefined,
          })

          // Check if this tool_result is for an Agent tool (subagent.stop)
          const matchingChild = thread.childThreads.find(
            (ct) => ct.parentToolUseId === toolUseId
          )
          if (matchingChild) {
            hooks.push({
              type: "subagent.stop",
              threadId: thread.id,
              messageSequence: msg.sequence,
              childThreadId: matchingChild.id,
            })
          }
        }
      }
    } else if (msg.role === "assistant") {
      const hasThinking = msg.content.some(
        (b: Record<string, unknown>) => b.type === "thinking"
      )
      const hasText = msg.content.some(
        (b: Record<string, unknown>) => b.type === "text"
      )

      if (hasThinking) {
        hooks.push({
          type: "agent.thought",
          threadId: thread.id,
          messageSequence: msg.sequence,
        })
      }

      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const name = (block as Record<string, unknown>).name as string
          const id = (block as Record<string, unknown>).id as string
          hooks.push({
            type: "tool.pre",
            threadId: thread.id,
            messageSequence: msg.sequence,
            toolName: name,
            toolUseId: id,
          })

          if (name === "Agent") {
            const child = thread.childThreads.find(
              (ct) => ct.parentToolUseId === id
            )
            hooks.push({
              type: "subagent.start",
              threadId: thread.id,
              messageSequence: msg.sequence,
              childThreadId: child?.id,
            })
          }
        }
      }

      if (msg.stopReason === "end_turn" || msg.stopReason === "stop_sequence") {
        if (hasText) {
          hooks.push({
            type: "agent.response",
            threadId: thread.id,
            messageSequence: msg.sequence,
          })
        }
        hooks.push({
          type: "agent.stop",
          threadId: thread.id,
          messageSequence: msg.sequence,
        })
      }
    }
  }

  hooks.push({
    type: "session.end",
    threadId: thread.id,
    messageSequence: thread.messages.length,
  })

  for (const child of thread.childThreads) {
    hooks.push(...deriveHookEvents(child))
  }

  return hooks
}
