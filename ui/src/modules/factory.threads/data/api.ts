import { rio } from "@/lib/rio"

import type {
  PlanContent,
  PlanVersion,
  Thread,
  ThreadChannel,
  ThreadExchange,
  ThreadMessage,
  ThreadPlan,
  ThreadToolCall,
  ThreadTurn,
} from "./types"

function getFactoryBaseUrl(): string {
  return (
    rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
  )
}

function getBaseUrl(): string {
  return `${getFactoryBaseUrl()}/threads`
}

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

async function factoryFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getFactoryBaseUrl()
  const token = getAuthToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(
      error.error || `Factory API request failed: ${response.status}`
    )
  }
  const body = await response.json()
  return body.data ?? body
}

async function threadsFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getBaseUrl()
  const token = getAuthToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(
      error.error || `Threads API request failed: ${response.status}`
    )
  }

  const body = await response.json()
  return body.data ?? body
}

export const threadsApi = {
  channels: () => threadsFetch<ThreadChannel[]>("/channels?limit=500"),

  channelThreads: (channelId: string) =>
    threadsFetch<Thread[]>(
      `/channels/${encodeURIComponent(channelId)}/threads?limit=200`
    ),

  thread: (id: string) =>
    threadsFetch<Thread>(`/threads/${encodeURIComponent(id)}`),

  threadTurns: async (id: string) => {
    const all: ThreadTurn[] = []
    let offset = 0
    const limit = 200
    const maxPages = 10
    for (let page = 0; page < maxPages; page++) {
      const batch = await threadsFetch<ThreadTurn[]>(
        `/threads/${encodeURIComponent(id)}/turns?limit=${limit}&offset=${offset}`
      )
      all.push(...batch)
      if (batch.length < limit) break
      offset += limit
    }
    return all.sort((a, b) => a.turnIndex - b.turnIndex)
  },

  threadPlans: async (id: string) => {
    const result = await threadsFetch<{ plans: ThreadPlan[] } | ThreadPlan[]>(
      `/threads/${encodeURIComponent(id)}/plans`
    )
    return (
      Array.isArray(result) ? result : (result.plans ?? [])
    ) as ThreadPlan[]
  },

  listPlans: async (opts?: { limit?: number; offset?: number }) => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const params = new URLSearchParams()
    if (opts?.limit) params.set("limit", String(opts.limit))
    if (opts?.offset) params.set("offset", String(opts.offset))
    const qs = params.toString()
    const res = await fetch(`${base}/plans${qs ? `?${qs}` : ""}`, { headers })
    if (!res.ok) throw new Error(`Failed to load plans: ${res.status}`)
    const body = await res.json()
    return (body.plans ?? []) as ThreadPlan[]
  },

  searchPlans: async (q: string, limit = 50) => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const params = new URLSearchParams({ q, limit: String(limit) })
    const res = await fetch(`${base}/plans/search?${params.toString()}`, {
      headers,
    })
    if (!res.ok) throw new Error(`Failed to search plans: ${res.status}`)
    const body = await res.json()
    return (body.plans ?? []) as ThreadPlan[]
  },

  planContent: async (slug: string, version?: number | null) => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const qs =
      version != null && Number.isFinite(version) ? `?version=${version}` : ""
    const res = await fetch(
      `${base}/documents/documents/${encodeURIComponent(slug)}/content${qs}`,
      { headers }
    )
    if (!res.ok) throw new Error(`Failed to load plan: ${res.status}`)
    const body = await res.json()
    return (body.data ?? body) as PlanContent
  },

  threadMessages: async (threadId: string, limit = 5000) => {
    const data = await factoryFetch<{ messages: ThreadMessage[] }>(
      `/messages/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`
    )
    return data.messages ?? []
  },

  threadExchanges: async (threadId: string) => {
    const data = await factoryFetch<{ exchanges: ThreadExchange[] }>(
      `/messages/threads/${encodeURIComponent(threadId)}/exchanges`
    )
    return data.exchanges ?? []
  },

  threadToolCalls: async (threadId: string, limit = 5000) => {
    const data = await factoryFetch<{ toolCalls: ThreadToolCall[] }>(
      `/messages/threads/${encodeURIComponent(threadId)}/tool-calls?limit=${limit}`
    )
    return data.toolCalls ?? []
  },

  planVersions: async (slug: string) => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const res = await fetch(
      `${base}/documents/documents/${encodeURIComponent(slug)}/versions?limit=200`,
      { headers }
    )
    if (!res.ok) return []
    const body = await res.json()
    const data = body.data ?? body
    const rows = Array.isArray(data) ? data : (data.versions ?? [])
    return rows.map((r: Record<string, unknown>) => ({
      id: (r.id as string) ?? "",
      version: (r.version as number) ?? 0,
      title:
        ((r.spec as Record<string, unknown> | null)?.title as string) ?? null,
      sourceTurnId: (r.sourceTurnId as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      contentHash: (r.contentHash as string | null) ?? null,
      sizeBytes: (r.sizeBytes as number | null) ?? null,
      createdAt: (r.createdAt as string | null) ?? null,
    })) as PlanVersion[]
  },
}
