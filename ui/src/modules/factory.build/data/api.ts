import { rio } from "@/lib/rio"

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

async function factoryFetch<T = unknown>(path: string): Promise<T> {
  const base =
    rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
  const token = getAuthToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(`${base}${path}`, { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API request failed: ${res.status}`)
  }
  const body = await res.json()
  return body.data ?? body
}

export const buildApi = {
  repos: () => factoryFetch<any[]>("/build/repos"),
  repo: (slug: string) =>
    factoryFetch<any>(`/build/repos/${encodeURIComponent(slug)}`),
  systems: () => factoryFetch<any[]>("/product/systems"),
  system: (slug: string) =>
    factoryFetch<any>(`/product/systems/${encodeURIComponent(slug)}`),
  components: () => factoryFetch<any[]>("/product/components"),
  component: (slug: string) =>
    factoryFetch<any>(`/product/components/${encodeURIComponent(slug)}`),
  systemComponents: (systemSlug: string) =>
    factoryFetch<any[]>(
      `/product/systems/${encodeURIComponent(systemSlug)}/components`
    ),
  systemDeployments: (systemSlug: string) =>
    factoryFetch<any[]>(
      `/ops/deployment-targets?systemSlug=${encodeURIComponent(systemSlug)}`
    ),
}
