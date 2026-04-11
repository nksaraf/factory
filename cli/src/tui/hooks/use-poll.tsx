import { useState, useEffect, useCallback } from "react"

interface PollResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

interface PollOptions {
  interval?: number
  enabled?: boolean
}

/**
 * Generic polling hook — calls fetcher on mount and at interval.
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: PollOptions = {}
): PollResult<T> {
  const { interval = 5000, enabled = true } = opts
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await fetcher()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => {
    if (!enabled) return
    refresh()
    const timer = setInterval(refresh, interval)
    return () => clearInterval(timer)
  }, [refresh, interval, enabled])

  return { data, error, loading, refresh }
}

/**
 * Unwrap Eden API response: { data: { data: [...] } } → [...]
 */
export function unwrap(res: {
  data: unknown
  error: unknown
}): Record<string, unknown>[] {
  if (res.error) throw new Error(String(res.error))
  const d = res.data as Record<string, unknown> | undefined
  const inner = d?.data
  return Array.isArray(inner) ? inner : Array.isArray(d) ? d : []
}

export function unwrapOne(res: {
  data: unknown
  error: unknown
}): Record<string, unknown> | null {
  if (res.error) throw new Error(String(res.error))
  const d = res.data as Record<string, unknown> | undefined
  return (d?.data as Record<string, unknown>) ?? d ?? null
}
