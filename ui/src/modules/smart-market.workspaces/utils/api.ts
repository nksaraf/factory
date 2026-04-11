import { mockFetch } from "../mocks/mock-store"

const USE_MOCK = import.meta.env.DEV

const getBaseUrl = () => {
  if (typeof window !== "undefined" && (window as any).__WORKSPACE_API_URL__) {
    return (window as any).__WORKSPACE_API_URL__
  }
  return "http://localhost:8093/api/v1/workspace"
}

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

export async function workspaceFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (USE_MOCK) {
    return mockFetch<T>(path, options)
  }

  const baseUrl = getBaseUrl()
  const token = getAuthToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(error.error || `Request failed: ${response.status}`)
  }

  return response.json()
}
