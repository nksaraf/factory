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
