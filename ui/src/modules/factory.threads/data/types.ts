export interface ThreadChannel {
  id: string
  kind: string
  name?: string | null
  externalId?: string | null
  repoSlug?: string | null
  spec?: Record<string, unknown>
  createdAt?: string
}

export interface Thread {
  id: string
  type: string
  source: string
  externalId: string | null
  status: string
  channelId: string | null
  repoSlug: string | null
  branch: string | null
  startedAt: string
  endedAt: string | null
  title?: string
  spec: {
    title?: string
    model?: string
    cwd?: string
    firstPrompt?: string
    lastPrompt?: string
    generatedTopic?: string
    generatedDescription?: string
    turnCount?: number
    toolCallCount?: number
    tokenUsage?: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
    }
    [k: string]: unknown
  }
}

export interface ThreadTurn {
  id: string
  threadId: string
  turnIndex: number
  role: "user" | "assistant" | "system" | "tool" | "thinking" | "subagent"
  spec: {
    prompt?: string
    responseSummary?: string
    message?: string
    command?: string
    output?: string
    exitCode?: number
    model?: string
    timestamp?: string
    tokenUsage?: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
    }
    toolCalls?: Array<{ name: string; input?: string }>
    toolErrors?: Array<{ toolName: string; error: string; errorClass: string }>
    toolName?: string
    toolInput?: string
    toolOutput?: string
    failed?: boolean
    [k: string]: unknown
  }
  createdAt: string
}

export interface ThreadPlan {
  slug: string
  title: string | null
  source: string | null
  latestVersion: number | null
  threadId: string | null
  sourceTurnId: string | null
  editCount: number
  stub: boolean
  updatedAt: string | null
  createdAt: string | null
  viewUrl: string
}

export interface PlanContent {
  slug: string
  content: string
  path: string | null
  version: number | null
}

export interface PlanVersion {
  id: string
  version: number
  title: string | null
  sourceTurnId: string | null
  source: string | null
  contentHash: string | null
  sizeBytes: number | null
  createdAt: string | null
}

export interface PlanEntry {
  id: string
  slug: string
  title: string
  turnIndex?: number
  timestamp?: string
  version?: number | null
  editCount?: number
  text?: string
}

// ── Message IR types (lossless content blocks from org.message) ──

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | {
      type: "tool_use"
      id: string
      name: string
      input: Record<string, unknown>
    }
  | {
      type: "tool_result"
      tool_use_id: string
      content: string | ContentBlock[]
      is_error?: boolean
    }
  | {
      type: "image"
      source: { type: string; media_type: string; data: string }
    }
  | { type: "redacted_thinking"; data: string }
  | { type: "document"; source: Record<string, unknown>; title?: string }

export interface ThreadMessage {
  id: string
  threadId: string
  parentId: string | null
  role: "user" | "assistant" | "system"
  source: string
  content: ContentBlock[]
  startedAt: string
  completedAt: string | null
  spec: {
    sourceMessageId?: string
    model?: string
    stopReason?: string
    usage?: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  }
  createdAt: string
}

export interface ThreadExchange {
  id: string
  threadId: string
  triggerMessageId: string
  terminalMessageId: string | null
  status: "running" | "completed" | "interrupted" | "errored"
  startedAt: string
  endedAt: string | null
  spec: Record<string, unknown>
  createdAt: string
}

export interface ThreadToolCall {
  id: string
  threadId: string
  messageId: string
  exchangeId: string | null
  name: string
  input: Record<string, unknown> | null
  result: Record<string, unknown> | null
  resultMessageId: string | null
  status: string
  isError: boolean | null
  startedAt: string
  endedAt: string | null
}
