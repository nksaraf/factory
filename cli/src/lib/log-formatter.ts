import type {
  LogEntry,
  TraceSpan,
  TraceSummary,
  MetricSummaryRow,
  Alert,
  InfraMetricRow,
} from "@smp/factory-shared/observability-types"
import { styleError, styleWarn, styleInfo, styleMuted, styleSuccess } from "../cli-style.js"
import { printTable } from "../output.js"

// ---------------------------------------------------------------------------
// Log formatting
// ---------------------------------------------------------------------------

const LEVEL_COLOR: Record<string, (s: string) => string> = {
  fatal: styleError,
  error: styleError,
  warn: styleWarn,
  info: styleInfo,
  debug: styleMuted,
}

function colorLevel(level: string): string {
  const fn = LEVEL_COLOR[level] ?? styleMuted
  return fn(level.toUpperCase().padEnd(5))
}

function shortTimestamp(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toISOString().slice(11, 23)
}

export function formatLogEntry(entry: LogEntry): string {
  const ts = styleMuted(shortTimestamp(entry.timestamp))
  const lvl = colorLevel(entry.level)
  const src = entry.source ? styleMuted(entry.source) + " " : ""
  return `${ts} ${lvl} ${src}${entry.message}`
}

export function formatLogEntryJson(entry: LogEntry): string {
  return JSON.stringify(entry)
}

// ---------------------------------------------------------------------------
// Trace waterfall
// ---------------------------------------------------------------------------

export function renderTraceWaterfall(spans: TraceSpan[]): string {
  if (spans.length === 0) return "No spans found."

  const sorted = [...spans].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  const traceStart = new Date(sorted[0].startTime).getTime()
  const traceEnd = Math.max(
    ...sorted.map((s) => new Date(s.startTime).getTime() + s.duration)
  )
  const totalDuration = traceEnd - traceStart || 1

  const BAR_WIDTH = 40
  const lines: string[] = []

  // Header
  lines.push(
    `Trace ${sorted[0].traceId}  Total: ${(totalDuration / 1000).toFixed(1)}ms`
  )
  lines.push("")

  // Build parent→children map for indentation
  const childMap = new Map<string | undefined, TraceSpan[]>()
  for (const span of sorted) {
    const parent = span.parentSpanId
    if (!childMap.has(parent)) childMap.set(parent, [])
    childMap.get(parent)!.push(span)
  }

  function renderSpan(span: TraceSpan, depth: number) {
    const indent = "  ".repeat(depth)
    const offset = new Date(span.startTime).getTime() - traceStart
    const barStart = Math.round((offset / totalDuration) * BAR_WIDTH)
    const barLen = Math.max(1, Math.round((span.duration / totalDuration) * BAR_WIDTH))

    const bar =
      " ".repeat(barStart) +
      (span.status === "error" ? styleError("█".repeat(barLen)) : styleSuccess("█".repeat(barLen))) +
      " ".repeat(Math.max(0, BAR_WIDTH - barStart - barLen))

    const durStr = styleMuted(`${(span.duration / 1000).toFixed(1)}ms`)
    const name = span.operationName.length > 30
      ? span.operationName.slice(0, 27) + "..."
      : span.operationName

    lines.push(`${indent}${name.padEnd(32 - depth * 2)} ${bar} ${durStr}`)

    const children = childMap.get(span.spanId) ?? []
    for (const child of children) {
      renderSpan(child, depth + 1)
    }
  }

  // Start from root spans (no parent)
  const roots = childMap.get(undefined) ?? sorted.filter((s) => !s.parentSpanId)
  for (const root of roots) {
    renderSpan(root, 0)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Table formatters
// ---------------------------------------------------------------------------

export function formatTraceSummaryTable(traces: TraceSummary[]): string {
  if (traces.length === 0) return "No traces found."
  return printTable(
    ["Trace ID", "Root Span", "Duration", "Spans", "Status", "Timestamp"],
    traces.map((t) => [
      t.traceId.slice(0, 12),
      t.rootSpan.length > 30 ? t.rootSpan.slice(0, 27) + "..." : t.rootSpan,
      `${(t.duration / 1000).toFixed(1)}ms`,
      String(t.spanCount),
      t.status === "error" ? styleError(t.status) : styleSuccess(t.status),
      shortTimestamp(t.timestamp),
    ])
  )
}

export function formatMetricsSummaryTable(rows: MetricSummaryRow[]): string {
  if (rows.length === 0) return "No metrics data."
  return printTable(
    ["Module", "Req/s", "P50", "P99", "Err%", "CPU%", "Mem%"],
    rows.map((r) => [
      r.module,
      r.requestsPerSec.toFixed(1),
      `${r.p50.toFixed(1)}ms`,
      `${r.p99.toFixed(1)}ms`,
      r.errorPct > 5 ? styleError(`${r.errorPct.toFixed(1)}%`) : `${r.errorPct.toFixed(1)}%`,
      r.cpuPct > 80 ? styleWarn(`${r.cpuPct}%`) : `${r.cpuPct}%`,
      r.memoryPct > 80 ? styleWarn(`${r.memoryPct}%`) : `${r.memoryPct}%`,
    ])
  )
}

export function formatInfraMetricsTable(rows: InfraMetricRow[]): string {
  if (rows.length === 0) return "No infrastructure metrics."
  return printTable(
    ["Node", "CPU%", "Mem%", "Disk%", "Pods", "Status"],
    rows.map((r) => [
      r.node,
      r.cpuPct > 80 ? styleWarn(`${r.cpuPct}%`) : `${r.cpuPct}%`,
      r.memoryPct > 80 ? styleWarn(`${r.memoryPct}%`) : `${r.memoryPct}%`,
      r.diskPct > 80 ? styleWarn(`${r.diskPct}%`) : `${r.diskPct}%`,
      `${r.podCount}/${r.podCapacity}`,
      r.status === "healthy" ? styleSuccess(r.status) : styleWarn(r.status),
    ])
  )
}

export function formatAlertTable(alerts: Alert[]): string {
  if (alerts.length === 0) return "No alerts."
  return printTable(
    ["ID", "Name", "Severity", "Status", "Site", "Since"],
    alerts.map((a) => {
      const sev =
        a.severity === "critical" ? styleError(a.severity) :
        a.severity === "warning" ? styleWarn(a.severity) :
        a.severity
      const status =
        a.status === "firing" ? styleError(a.status) :
        a.status === "resolved" ? styleSuccess(a.status) :
        a.status
      return [
        a.id.slice(0, 12),
        a.name,
        sev,
        status,
        a.site ?? "-",
        shortTimestamp(a.since),
      ]
    })
  )
}
