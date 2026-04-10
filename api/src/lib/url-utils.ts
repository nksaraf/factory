/**
 * URL parsing utilities for extracting host/port from backend URLs.
 * Used by the scan reconciler and potentially other infra services.
 */

/** Extract port number from a URL or host:port string. */
export function extractPort(url?: string): number | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80
  } catch {
    // Try extracting from host:port format
    const match = url.match(/:(\d+)/)
    return match ? parseInt(match[1], 10) : undefined
  }
}

/** Extract hostname/IP from a URL or host:port string. */
export function extractHost(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    // Try extracting from host:port or plain IP
    const match = url.match(/^([^:]+)/)
    return match?.[1]
  }
}
