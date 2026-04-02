/**
 * useDualQuery — generic helper that abstracts the PowerSync-vs-REST pattern.
 *
 * Every fleet hook does the same thing:
 *   1. Check if PowerSync is enabled
 *   2. If yes → run a reactive SQL query against local SQLite
 *   3. If no  → run a TanStack useQuery with fetch + polling
 *   4. Map results through a row transformer
 *
 * This helper captures that pattern once so each hook is a one-liner config.
 */
import { useQuery } from "@tanstack/react-query"

import { usePowerSyncEnabled } from "../powersync/provider"
import { fleetFetch } from "./api"

// ---------------------------------------------------------------------------
// Lazy PowerSync import
// ---------------------------------------------------------------------------

let _usePSQuery: typeof import("@powersync/react").useQuery | null = null

function usePSQuery(sql: string, params: unknown[] = []) {
  if (!_usePSQuery) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _usePSQuery = require("@powersync/react").useQuery
  }
  return _usePSQuery!(sql, params) as {
    data: Record<string, unknown>[]
    isLoading: boolean
    error: Error | null
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DualListQueryConfig<T> {
  /** TanStack Query key */
  queryKey: unknown[]
  /** SQL for the PowerSync path (e.g. "SELECT * FROM deployment_target") */
  sql: string
  /** SQL bind parameters */
  sqlParams?: unknown[]
  /** REST endpoint path (e.g. "/deployment-targets") */
  fetchPath: string
  /** Transform a PowerSync row (snake_case) → domain type */
  fromRow: (row: Record<string, unknown>) => T
  /** Transform a REST API row → domain type (defaults to fromRow) */
  fromApi?: (row: Record<string, unknown>) => T
  /** Whether the query should run at all */
  enabled?: boolean
}

interface DualOneQueryConfig<T> extends DualListQueryConfig<T> {
  /** When true, expects a single object from REST instead of { data: [] } */
  single: true
}

export interface DualQueryResult<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}

const POLL_INTERVAL = 60_000

// ---------------------------------------------------------------------------
// List query (returns T[])
// ---------------------------------------------------------------------------

export function useDualListQuery<T>(
  config: DualListQueryConfig<T>
): DualQueryResult<T[]> {
  const psEnabled = usePowerSyncEnabled()
  const enabled = config.enabled ?? true

  // --- PowerSync path ---
  const psResult =
    psEnabled && enabled
      ? usePSQuery(config.sql, config.sqlParams)
      : null

  // --- REST fallback ---
  const fetchResult = useQuery<T[]>({
    queryKey: config.queryKey,
    queryFn: async () => {
      const res = await fleetFetch<{ data: Record<string, unknown>[] }>(
        config.fetchPath
      )
      const transform = config.fromApi ?? config.fromRow
      return res.data.map(transform)
    },
    refetchInterval: POLL_INTERVAL,
    enabled: !psEnabled && enabled,
  })

  if (psEnabled && psResult) {
    return {
      data: psResult.data.map(config.fromRow),
      isLoading: psResult.isLoading,
      error: psResult.error,
    }
  }

  return fetchResult
}

// ---------------------------------------------------------------------------
// Single-item query (returns T | null)
// ---------------------------------------------------------------------------

export function useDualOneQuery<T>(
  config: DualOneQueryConfig<T>
): DualQueryResult<T | null> {
  const psEnabled = usePowerSyncEnabled()
  const enabled = config.enabled ?? true

  const psResult =
    psEnabled && enabled
      ? usePSQuery(config.sql, config.sqlParams)
      : null

  const fetchResult = useQuery<T | null>({
    queryKey: config.queryKey,
    queryFn: async () => {
      const res = await fleetFetch<Record<string, unknown>>(config.fetchPath)
      const transform = config.fromApi ?? config.fromRow
      return transform(res)
    },
    refetchInterval: POLL_INTERVAL,
    enabled: !psEnabled && enabled,
  })

  if (psEnabled && psResult) {
    return {
      data: psResult.data[0] ? config.fromRow(psResult.data[0]) : null,
      isLoading: psResult.isLoading,
      error: psResult.error,
    }
  }

  return fetchResult
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

export function buildWhere(opts?: Record<string, string | undefined>): {
  sql: string
  params: string[]
} {
  if (!opts) return { sql: "", params: [] }

  const clauses: string[] = []
  const params: string[] = []

  for (const [key, value] of Object.entries(opts)) {
    if (value != null) {
      clauses.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (clauses.length === 0) return { sql: "", params: [] }
  return { sql: ` WHERE ${clauses.join(" AND ")}`, params }
}

export function buildQueryString(
  params: Record<string, string | undefined>
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ""
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

export function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return (value as Record<string, unknown>) ?? {}
}
