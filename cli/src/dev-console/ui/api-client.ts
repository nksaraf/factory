type Envelope<T> = { data: T } | { error: string }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } })
  const body = (await res.json()) as Envelope<T>
  if ("error" in body) throw new Error(body.error)
  return body.data
}

export interface SessionData {
  project: string
  sdSlug: string
  site: { slug: string; type: string }
  workbench: {
    slug: string
    type: string
    tunnelSubdomain?: string
  }
  tunnel: {
    status: "disconnected" | "connecting" | "connected" | "error"
    info?: {
      url: string
      subdomain: string
      portUrls?: { port: number; url: string }[]
    }
  }
  updatedAt: string
}

export interface ServicePort {
  name: string
  host: number
  container?: number
  protocol: string
  url: string
  tunnelUrl?: string
}

export interface ServiceSummary {
  name: string
  mode: string
  status: string
  health: string
  image: string
  ports: ServicePort[]
  pid?: number
  phase?: string
  conditions: Array<{
    type: string
    status: string
    reason?: string
    message?: string
  }>
  kind: string | null
  type: string | null
  description: string | null
  tags: string[]
  owner: string | null
  deps: string[]
}

export interface ServiceDetail {
  name: string
  catalog: Record<string, unknown>
  deployment: Record<string, unknown> | null
  actual: Record<string, unknown> | null
  dependencies: string[]
}

export interface EnvEntry {
  value: string
  source: string
  sourceDetail?: string
  masked: boolean
}

export interface LocationData {
  estate: null | { slug: string; name: string; type: string }
  host: {
    name: string
    os: string
    arch: string
    ips: string[]
    factoryUrl: string
  }
  realm: { type: string; name: string } | null
  site: { slug: string; type: string }
  workbench: {
    name: string
    kind: string
    branch?: string
    dir?: string
    tunnelSubdomain?: string
  }
  project: {
    name: string
    rootDir: string
    composeFiles: string[]
  }
  package: { name: string; type: string; dir: string } | null
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as Envelope<T>
  if ("error" in data) throw new Error(data.error)
  return data.data
}

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

export interface WhoamiData {
  authenticated: boolean
  user: {
    id: string | null
    name: string | null
    email: string | null
    role: string | null
    exp: number | null
  } | null
  factory: {
    url: string
    health: {
      status: "healthy" | "unreachable" | "unauthorized"
      latencyMs?: number
      error?: string
    }
  }
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

export const api = {
  whoami: () => fetchJson<WhoamiData>("/api/dev/whoami"),
  session: () => fetchJson<SessionData>("/api/dev/session"),
  threadChannels: () => fetchJson<ThreadChannel[]>("/api/dev/threads/channels"),
  channelThreads: (id: string) =>
    fetchJson<Thread[]>(
      `/api/dev/threads/channels/${encodeURIComponent(id)}/threads`
    ),
  thread: (id: string) =>
    fetchJson<Thread>(`/api/dev/threads/threads/${encodeURIComponent(id)}`),
  threadTurns: (id: string) =>
    fetchJson<ThreadTurn[]>(
      `/api/dev/threads/threads/${encodeURIComponent(id)}/turns`
    ),
  threadPlans: (id: string) =>
    fetchJson<ThreadPlan[]>(
      `/api/dev/threads/threads/${encodeURIComponent(id)}/plans`
    ),
  planContent: (slug: string) =>
    fetchJson<PlanContent>(`/api/dev/plans/${encodeURIComponent(slug)}`),
  planVersions: (slug: string) =>
    fetchJson<PlanVersion[]>(
      `/api/dev/plans/${encodeURIComponent(slug)}/versions`
    ),
  services: () => fetchJson<ServiceSummary[]>("/api/dev/services"),
  startTunnel: (exposeConsole = true) =>
    postJson<SessionData["tunnel"]>("/api/dev/tunnel/start", { exposeConsole }),
  stopTunnel: () => postJson<SessionData["tunnel"]>("/api/dev/tunnel/stop"),
  service: (name: string) =>
    fetchJson<ServiceDetail>(`/api/dev/services/${encodeURIComponent(name)}`),
  logs: (name: string, tail = 200) =>
    fetchJson<{ lines: string[] }>(
      `/api/dev/services/${encodeURIComponent(name)}/logs?tail=${tail}`
    ),
  catalog: () => fetchJson<Record<string, unknown>>("/api/dev/catalog"),
  env: () => fetchJson<Record<string, EnvEntry>>("/api/dev/env"),
  ports: () =>
    fetchJson<Array<{ name: string; port: number; pinned: boolean }>>(
      "/api/dev/ports"
    ),
  location: () => fetchJson<LocationData>("/api/dev/location"),
}
