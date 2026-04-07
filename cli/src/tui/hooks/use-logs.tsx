import { useState, useEffect, useRef, useCallback } from "react"
import { getFactoryClient } from "../../client.js"

export interface LogEntry {
  timestamp: string
  level: string
  source?: string
  message: string
}

export interface LogFilters {
  workspaceId?: string
  level?: string
  grep?: string
}

const MAX_BUFFER = 1000

export function useLogs(filters: LogFilters) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const clear = useCallback(() => {
    setEntries([])
    cursorRef.current = undefined
  }, [])

  useEffect(() => {
    // Reset on filter change
    setEntries([])
    cursorRef.current = undefined

    let aborted = false

    const poll = async () => {
      while (!aborted) {
        try {
          const api = await getFactoryClient()
          const query: Record<string, string | undefined> = {
            sandbox: filtersRef.current.workspaceId,
            level: filtersRef.current.level,
            grep: filtersRef.current.grep,
            cursor: cursorRef.current,
          }
          // Remove undefined keys
          for (const k of Object.keys(query)) {
            if (query[k] === undefined) delete query[k]
          }

          const res = await api.api.v1.factory.observability.logs.get({ query })
          if (aborted) return

          if (res.error) {
            setConnected(false)
            await new Promise((r) => setTimeout(r, 3000))
            continue
          }

          setConnected(true)
          const body = (res.data ?? {}) as { entries?: LogEntry[]; cursor?: string; hasMore?: boolean }

          if (body.entries?.length) {
            const newEntries = body.entries
            setEntries((prev: LogEntry[]) => {
              const combined = [...prev, ...newEntries]
              return combined.length > MAX_BUFFER
                ? combined.slice(combined.length - MAX_BUFFER)
                : combined
            })
          }

          cursorRef.current = body.cursor

          if (!body.hasMore) {
            await new Promise((r) => setTimeout(r, 2000))
          }
        } catch {
          setConnected(false)
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }

    poll()
    return () => {
      aborted = true
    }
  }, [filters.workspaceId, filters.level, filters.grep])

  return { entries, connected, clear }
}
