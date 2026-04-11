import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import { getFactoryRestClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

interface OperationLastRun {
  id: string
  status: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  summary: Record<string, unknown> | null
  error: string | null
}

interface OperationInfo {
  name: string
  intervalMs: number
  lastRun: OperationLastRun | null
}

interface OperationDetail {
  name: string
  intervalMs: number
  runs: OperationLastRun[]
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatAgo(dateStr: string | null): string {
  if (!dateStr) return "-"
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return "just now"
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatStatus(status: string): string {
  switch (status) {
    case "succeeded":
      return styleSuccess(status)
    case "failed":
      return styleError(status)
    case "running":
      return styleWarn(status)
    default:
      return styleMuted(status)
  }
}

function summarize(summary: Record<string, unknown> | null): string {
  if (!summary) return "-"
  const parts: string[] = []
  for (const [k, v] of Object.entries(summary)) {
    if (v !== 0 && !v) continue
    parts.push(`${k}: ${v}`)
  }
  return parts.join(", ") || "-"
}

export async function runFactoryOps(
  flags: DxFlags,
  args?: { name?: string; trigger?: boolean }
): Promise<void> {
  const rest = await getFactoryRestClient()
  const name = args?.name

  // Trigger a manual run
  if (name && args?.trigger) {
    try {
      const result = await rest.request<{ runId: string }>(
        "POST",
        `/api/v1/factory/system/operations/${name}/trigger`
      )
      if (flags.json) {
        console.log(JSON.stringify({ success: true, ...result }, null, 2))
      } else {
        console.log(
          `${styleSuccess("Triggered")} ${styleBold(name)} -> ${styleMuted(result.runId)}`
        )
      }
    } catch (err) {
      exitWithError(flags, err instanceof Error ? err.message : String(err))
    }
    return
  }

  // Show detail for a specific operation
  if (name) {
    try {
      const detail = await rest.request<OperationDetail>(
        "GET",
        `/api/v1/factory/system/operations/${name}`
      )
      if (flags.json) {
        console.log(JSON.stringify(detail, null, 2))
        return
      }
      console.log(
        `${styleBold(detail.name)}  ${styleMuted(`every ${formatDuration(detail.intervalMs)}`)}`
      )
      console.log("")
      if (detail.runs.length === 0) {
        console.log(styleMuted("  No runs yet"))
        return
      }
      // Table header
      const hdr = [
        "Run ID".padEnd(20),
        "Status".padEnd(12),
        "Started".padEnd(14),
        "Duration".padEnd(10),
        "Summary",
      ].join("  ")
      console.log(styleMuted(hdr))
      console.log(styleMuted("-".repeat(80)))
      for (const run of detail.runs) {
        const cols = [
          run.id.padEnd(20),
          run.status.padEnd(12),
          formatAgo(run.startedAt).padEnd(14),
          formatDuration(run.durationMs).padEnd(10),
          run.error
            ? styleError(run.error.slice(0, 40))
            : summarize(run.summary),
        ]
        console.log(cols.join("  "))
      }
    } catch (err) {
      exitWithError(flags, err instanceof Error ? err.message : String(err))
    }
    return
  }

  // List all operations
  try {
    const result = await rest.request<{ operations: OperationInfo[] }>(
      "GET",
      "/api/v1/factory/system/operations"
    )

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    const ops = result.operations
    if (ops.length === 0) {
      console.log(styleMuted("No operations registered"))
      return
    }

    // Table header
    const hdr = [
      "Operation".padEnd(16),
      "Last Run".padEnd(14),
      "Status".padEnd(12),
      "Duration".padEnd(10),
      "Summary",
    ].join("  ")
    console.log(styleBold(hdr))
    console.log(styleMuted("-".repeat(80)))
    for (const op of ops) {
      const last = op.lastRun
      const cols = [
        op.name.padEnd(16),
        formatAgo(last?.startedAt ?? null).padEnd(14),
        last
          ? formatStatus(last.status.padEnd(12))
          : styleMuted("-".padEnd(12)),
        formatDuration(last?.durationMs ?? null).padEnd(10),
        last?.error
          ? styleError(last.error.slice(0, 40))
          : summarize(last?.summary ?? null),
      ]
      console.log(cols.join("  "))
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
