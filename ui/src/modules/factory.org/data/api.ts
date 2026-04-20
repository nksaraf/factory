import { rio } from "@/lib/rio"

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

async function orgFetch<T = unknown>(path: string): Promise<T> {
  const base =
    rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
  const token = getAuthToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(`${base}/org${path}`, { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Org API request failed: ${res.status}`)
  }
  const body = await res.json()
  return body.data ?? body
}

export const orgApi = {
  principals: () => orgFetch<any[]>("/principals?limit=500"),
  principal: (slug: string) =>
    orgFetch<any>(`/principals/${encodeURIComponent(slug)}`),
  principalLinks: (slug: string) =>
    orgFetch<any[]>(`/principals/${encodeURIComponent(slug)}/identities`),
  teams: () => orgFetch<any[]>("/teams?limit=200"),
  team: (slug: string) => orgFetch<any>(`/teams/${encodeURIComponent(slug)}`),
  teamMembers: (slug: string) =>
    orgFetch<any[]>(`/teams/${encodeURIComponent(slug)}/members`),
  secrets: async () => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const res = await fetch(`${base}/secrets`, { headers })
    if (!res.ok) return []
    const body = await res.json()
    return body.secrets ?? body.data ?? []
  },
  rolePresets: async () => {
    const base =
      rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
    const token = getAuthToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const res = await fetch(`${base}/agent/presets?limit=100`, { headers })
    if (!res.ok) return []
    const body = await res.json()
    return body.data ?? body ?? []
  },
}
