import type {
  Alert,
  LogEntry,
  MetricSummaryRow,
  TraceSpan,
  TraceSummary,
} from "@smp/factory-shared/observability-types"
import { describe, expect, it } from "bun:test"

import { parseDockerLogLine } from "../lib/docker-logs.js"
import {
  formatAlertTable,
  formatLogEntry,
  formatLogEntryJson,
  formatMetricsSummaryTable,
  formatTraceSummaryTable,
  renderTraceWaterfall,
} from "../lib/log-formatter.js"

// ---------------------------------------------------------------------------
// formatLogEntry
// ---------------------------------------------------------------------------

describe("formatLogEntry", () => {
  const base: LogEntry = {
    timestamp: "2026-03-25T12:30:45.123Z",
    level: "info",
    message: "request processed",
    source: "api/handler",
    attributes: {},
  }

  it("formats with timestamp, level, source, and message", () => {
    const out = formatLogEntry(base)
    expect(out).toContain("12:30:45.123")
    expect(out).toContain("INFO")
    expect(out).toContain("api/handler")
    expect(out).toContain("request processed")
  })

  it("handles error level", () => {
    const out = formatLogEntry({ ...base, level: "error" })
    expect(out).toContain("ERROR")
  })

  it("handles warn level", () => {
    const out = formatLogEntry({ ...base, level: "warn" })
    expect(out).toContain("WARN")
  })

  it("handles debug level", () => {
    const out = formatLogEntry({ ...base, level: "debug" })
    expect(out).toContain("DEBUG")
  })

  it("handles empty source", () => {
    const out = formatLogEntry({ ...base, source: "" })
    expect(out).toContain("request processed")
    // Should not have double spaces from empty source
  })
})

describe("formatLogEntryJson", () => {
  it("returns valid JSON", () => {
    const entry: LogEntry = {
      timestamp: "2026-03-25T12:00:00Z",
      level: "info",
      message: "hello",
      source: "test",
      attributes: { key: "val" },
    }
    const parsed = JSON.parse(formatLogEntryJson(entry))
    expect(parsed.level).toBe("info")
    expect(parsed.attributes.key).toBe("val")
  })
})

// ---------------------------------------------------------------------------
// parseDockerLogLine
// ---------------------------------------------------------------------------

describe("parseDockerLogLine", () => {
  it("parses container | message format", () => {
    const entry = parseDockerLogLine(
      "my-container  | Starting server on port 3000"
    )
    expect(entry.source).toBe("my-container")
    expect(entry.message).toBe("Starting server on port 3000")
    expect(entry.level).toBe("info")
  })

  it("parses structured JSON log", () => {
    const json = JSON.stringify({
      level: "error",
      msg: "connection failed",
      time: "2026-03-25T12:00:00Z",
      traceId: "t1",
      service: "db",
    })
    const entry = parseDockerLogLine(`db-1  | ${json}`)
    expect(entry.source).toBe("db-1")
    expect(entry.level).toBe("error")
    expect(entry.message).toBe("connection failed")
    expect(entry.timestamp).toBe("2026-03-25T12:00:00Z")
    expect(entry.traceId).toBe("t1")
    expect(entry.attributes.service).toBe("db")
  })

  it("parses pino numeric levels", () => {
    const json = JSON.stringify({ level: "50", msg: "fail" })
    const entry = parseDockerLogLine(`app  | ${json}`)
    expect(entry.level).toBe("error")
  })

  it("handles line without pipe separator", () => {
    const entry = parseDockerLogLine(
      "plain log output without container prefix"
    )
    expect(entry.source).toBe("")
    expect(entry.message).toBe("plain log output without container prefix")
  })

  it("handles malformed JSON gracefully", () => {
    const entry = parseDockerLogLine("app  | {not valid json")
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("{not valid json")
  })
})

// ---------------------------------------------------------------------------
// renderTraceWaterfall
// ---------------------------------------------------------------------------

describe("renderTraceWaterfall", () => {
  it("returns message for empty spans", () => {
    expect(renderTraceWaterfall([])).toBe("No spans found.")
  })

  it("renders single span", () => {
    const spans: TraceSpan[] = [
      {
        traceId: "t1",
        spanId: "s1",
        operationName: "GET /api",
        serviceName: "api",
        startTime: "2026-03-25T12:00:00.000Z",
        duration: 100000,
        status: "ok",
        attributes: {},
        events: [],
      },
    ]
    const out = renderTraceWaterfall(spans)
    expect(out).toContain("t1")
    expect(out).toContain("GET /api")
    expect(out).toContain("100.0ms")
  })

  it("renders parent-child hierarchy", () => {
    const spans: TraceSpan[] = [
      {
        traceId: "t1",
        spanId: "s1",
        operationName: "GET /api/users",
        serviceName: "gateway",
        startTime: "2026-03-25T12:00:00.000Z",
        duration: 200000,
        status: "ok",
        attributes: {},
        events: [],
      },
      {
        traceId: "t1",
        spanId: "s2",
        parentSpanId: "s1",
        operationName: "DB query",
        serviceName: "user-service",
        startTime: "2026-03-25T12:00:00.050Z",
        duration: 80000,
        status: "ok",
        attributes: {},
        events: [],
      },
    ]
    const out = renderTraceWaterfall(spans)
    expect(out).toContain("GET /api/users")
    expect(out).toContain("DB query")
    // Child should be indented
    const lines = out.split("\n")
    const dbLine = lines.find((l) => l.includes("DB query"))
    expect(dbLine).toBeDefined()
    expect(dbLine!.startsWith("  ")).toBe(true)
  })

  it("colors error spans differently", () => {
    const spans: TraceSpan[] = [
      {
        traceId: "t1",
        spanId: "s1",
        operationName: "POST /fail",
        serviceName: "api",
        startTime: "2026-03-25T12:00:00.000Z",
        duration: 50000,
        status: "error",
        attributes: {},
        events: [],
      },
    ]
    const out = renderTraceWaterfall(spans)
    expect(out).toContain("POST /fail")
  })
})

// ---------------------------------------------------------------------------
// Table formatters
// ---------------------------------------------------------------------------

describe("formatTraceSummaryTable", () => {
  it("returns message for empty array", () => {
    expect(formatTraceSummaryTable([])).toBe("No traces found.")
  })

  it("formats trace summary rows", () => {
    const traces: TraceSummary[] = [
      {
        traceId: "abc123456789def",
        rootSpan: "GET /api",
        duration: 1500000,
        spanCount: 5,
        status: "ok",
        timestamp: "2026-03-25T12:00:00Z",
      },
    ]
    const out = formatTraceSummaryTable(traces)
    expect(out).toContain("abc123456789")
    expect(out).toContain("GET /api")
    expect(out).toContain("1500.0ms")
  })
})

describe("formatMetricsSummaryTable", () => {
  it("returns message for empty array", () => {
    expect(formatMetricsSummaryTable([])).toBe("No metrics data.")
  })

  it("formats metrics rows", () => {
    const rows: MetricSummaryRow[] = [
      {
        module: "core",
        requestsPerSec: 150,
        p50: 12,
        p99: 250,
        errorPct: 0.5,
        cpuPct: 45,
        memoryPct: 60,
      },
    ]
    const out = formatMetricsSummaryTable(rows)
    expect(out).toContain("core")
    expect(out).toContain("150.0")
    expect(out).toContain("0.5%")
  })
})

describe("formatAlertTable", () => {
  it("returns message for empty array", () => {
    expect(formatAlertTable([])).toBe("No alerts.")
  })

  it("formats alert rows", () => {
    const alerts: Alert[] = [
      {
        id: "alert-123456789",
        name: "High Error Rate",
        severity: "critical",
        status: "firing",
        site: "prod-us",
        since: "2026-03-25T12:00:00Z",
        labels: {},
      },
    ]
    const out = formatAlertTable(alerts)
    expect(out).toContain("alert-12345")
    expect(out).toContain("High Error Rate")
    expect(out).toContain("prod-us")
  })
})
