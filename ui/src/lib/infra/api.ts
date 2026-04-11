// ui/src/lib/infra/api.ts
import { rio } from "../rio"

function getBaseUrl(): string {
  return `${rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/factory"}/infra`
}

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

export async function infraFetch<T = unknown>(
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
      error.error || `Infra API request failed: ${response.status}`
    )
  }

  return response.json()
}
