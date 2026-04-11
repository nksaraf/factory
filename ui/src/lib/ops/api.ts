/**
 * Factory Fleet API client — typed fetch wrapper for the fleet REST endpoints.
 *
 * Used as the fallback data source when PowerSync is disabled, and always
 * used for write operations (PowerSync is read-path only).
 */
import { rio } from "../rio"

function getBaseUrl(): string {
  return `${rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/factory"}/fleet`
}

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

export async function fleetFetch<T = unknown>(
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
      error.error || `Fleet API request failed: ${response.status}`
    )
  }

  return response.json()
}
