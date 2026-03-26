/**
 * Shared helpers for CLI list commands: table output, color, sorting, pagination.
 */
import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import { exitWithError } from "../lib/cli-exit.js"
import { type ColumnOpt, printTable } from "../output.js"
import { toDxFlags } from "./dx-flags.js"

export { styleBold, styleMuted, styleSuccess, styleWarn, styleError }
export type { ColumnOpt }

// ---------------------------------------------------------------------------
// API call wrapper (shared across most command files)
// ---------------------------------------------------------------------------

/** Extract a human-readable message from an API error response. */
function formatApiError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error)
  const err = error as Record<string, unknown>
  const status = (err.status ?? err.statusCode) as number | undefined

  // Human-friendly messages for common HTTP errors
  if (status === 404) return "Resource not found."
  if (status === 401 || status === 403)
    return "Authentication failed. Run 'dx auth login' to sign in."
  if (status === 409) return "Conflict — the resource already exists or was modified."
  if (status === 429) return "Rate limit exceeded. Please wait and try again."
  if (status && status >= 500) return `Server error (${status}). The API may be experiencing issues.`

  const raw = (err.value ?? err.message ?? err.error ?? "") as string

  // Strip HTML to extract the meaningful error
  if (typeof raw === "string" && raw.includes("<")) {
    const titleMatch = raw.match(/<title>([^<]+)<\/title>/i)
    const preMatch = raw.match(/<pre>([^<]*)<\/pre>/is)
    const title = titleMatch?.[1]?.trim()
    const detail = preMatch?.[1]?.trim()

    if (detail) {
      const firstLine = detail.split("\n")[0].replace(/^Error:\s*/, "").trim()
      const summary = title ? `${title}: ${firstLine}` : firstLine
      return status ? `[${status}] ${summary}` : summary
    }
    if (title) return status ? `[${status}] ${title}` : title
  }

  // Try to parse JSON error strings
  if (typeof raw === "string" && raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw)
      const msg = parsed.error_msg ?? parsed.error ?? parsed.message
      if (msg) return status ? `[${status}] ${msg}` : msg
    } catch { /* not JSON */ }
  }

  if (err.error_msg)
    return status ? `[${status}] ${err.error_msg}` : String(err.error_msg)

  const json = JSON.stringify(error)
  if (json.length > 200)
    return status ? `[${status}] ${json.slice(0, 200)}...` : `${json.slice(0, 200)}...`
  return status ? `[${status}] ${json}` : json
}

export async function apiCall<T>(
  flags: Record<string, unknown>,
  fn: () => Promise<{ data: T; error: unknown }>
): Promise<T> {
  const f = toDxFlags(flags)
  try {
    const res = await fn()
    if (res.error) {
      exitWithError(f, formatApiError(res.error))
    }
    return res.data
  } catch (err) {
    if (err instanceof TypeError && err.message.includes("fetch")) {
      exitWithError(f, "Cannot connect to the API server. Is it running?")
    }
    const msg = err instanceof Error ? err.message : String(err)
    exitWithError(f, msg)
  }
}

// ---------------------------------------------------------------------------
// JSON output (for non-list commands that still need it)
// ---------------------------------------------------------------------------

export function jsonOut(flags: Record<string, unknown>, data: unknown) {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2))
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

// ---------------------------------------------------------------------------
// Status coloring
// ---------------------------------------------------------------------------

export function colorStatus(status: string): string {
  switch (status) {
    case "active":
    case "running":
    case "ready":
    case "healthy":
    case "production":
    case "verified":
    case "connected":
    case "completed":
    case "idle":
      return styleSuccess(status)
    case "stopped":
    case "disabled":
    case "destroying":
    case "destroyed":
    case "failed":
    case "error":
      return styleError(status)
    case "provisioning":
    case "pending":
    case "draining":
    case "draft":
    case "building":
    case "staging":
    case "creating":
    case "connecting":
    case "syncing":
      return styleWarn(status)
    default:
      return status
  }
}

// ---------------------------------------------------------------------------
// Unwrap API response (Eden returns { data: { success, data: [...] } })
// ---------------------------------------------------------------------------

export function unwrapList(data: unknown): Record<string, unknown>[] {
  const inner =
    data && typeof data === "object" && "data" in data
      ? (data as Record<string, unknown>).data
      : data
  return Array.isArray(inner) ? inner : []
}

// ---------------------------------------------------------------------------
// Table-or-JSON output for list commands
// ---------------------------------------------------------------------------

export function tableOrJson(
  flags: Record<string, unknown>,
  data: unknown,
  headers: string[],
  rowMapper: (item: Record<string, unknown>) => string[],
  colOpts?: ColumnOpt[],
  opts?: { emptyMessage?: string }
) {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2))
    return
  }
  const items = unwrapList(data)
  if (items.length === 0) {
    console.log(opts?.emptyMessage ?? "No results.")
    return
  }
  console.log(printTable(headers, items.map(rowMapper), colOpts))
}

// ---------------------------------------------------------------------------
// Client-side sort + limit (for APIs without server-side support)
// ---------------------------------------------------------------------------

export function sortAndLimit(
  items: Record<string, unknown>[],
  flags: Record<string, unknown>,
  sortFields: Record<string, string>, // flag-value -> field name
  defaultSort?: string
): Record<string, unknown>[] {
  const sortKey = (flags.sort as string) ?? defaultSort
  const field = sortKey ? sortFields[sortKey] : undefined

  if (field) {
    items.sort((a, b) => {
      const av = a[field]
      const bv = b[field]
      if (typeof av === "number" && typeof bv === "number") return av - bv
      return String(av ?? "").localeCompare(String(bv ?? ""))
    })
  }

  const limit = (flags.limit as number) ?? 50
  if (items.length > limit) items = items.slice(0, limit)
  return items
}

// ---------------------------------------------------------------------------
// Relative time formatting (e.g. "3h ago", "2d ago")
// ---------------------------------------------------------------------------

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return styleMuted("-")
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return "just now"
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Detail view for single-object "get" commands (key-value pairs)
// ---------------------------------------------------------------------------

export function detailView(
  flags: Record<string, unknown>,
  data: unknown,
  fieldMap: [label: string, getter: (r: Record<string, unknown>) => string][]
) {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2))
    return
  }
  const obj =
    data && typeof data === "object" && "data" in data
      ? ((data as Record<string, unknown>).data as Record<string, unknown>)
      : (data as Record<string, unknown>)
  if (!obj) {
    console.log("Not found.")
    return
  }
  const maxLabel = Math.max(...fieldMap.map(([l]) => l.length))
  for (const [label, getter] of fieldMap) {
    console.log(`${styleMuted(label.padEnd(maxLabel))}  ${getter(obj)}`)
  }
}

// ---------------------------------------------------------------------------
// Action result for mutation commands (create, delete, start, etc.)
// ---------------------------------------------------------------------------

export function actionResult(
  flags: Record<string, unknown>,
  data: unknown,
  message: string
) {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2))
    return
  }
  console.error(message)
}
