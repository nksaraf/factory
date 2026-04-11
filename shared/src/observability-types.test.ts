import { describe, expect, it } from "bun:test"
import type {
  LogEntry,
  LogQuery,
  LogQueryResult,
  TraceSpan,
  TraceSummary,
  TraceQuery,
  TraceFindQuery,
  MetricSummaryRow,
  MetricSeries,
  MetricsQuery,
  InfraMetricRow,
  Alert,
  AlertQuery,
  AlertRule,
  SilenceSpec,
  ObservabilityBackendType,
} from "./observability-types"

describe("observability-types", () => {
  it("LogEntry is structurally valid", () => {
    const entry: LogEntry = {
      timestamp: "2026-03-25T12:00:00Z",
      level: "info",
      message: "hello",
      source: "api/handler",
      attributes: { "dx.module": "core" },
      traceId: "abc123",
    }
    expect(entry.level).toBe("info")
    expect(entry.traceId).toBe("abc123")
    expect(entry.spanId).toBeUndefined()
  })

  it("LogQuery accepts all optional fields", () => {
    const query: LogQuery = {
      module: "core",
      component: "api",
      site: "prod-us",
      level: "error,warn",
      grep: "timeout",
      since: "5m",
      until: "2026-03-25T13:00:00Z",
      around: "2026-03-25T12:30:00Z",
      window: "5m",
      follow: true,
      limit: 100,
      cursor: "abc",
    }
    expect(query.follow).toBe(true)
  })

  it("LogQueryResult carries cursor for pagination", () => {
    const result: LogQueryResult = {
      entries: [],
      hasMore: true,
      cursor: "next-page-token",
    }
    expect(result.hasMore).toBe(true)
  })

  it("TraceSpan includes events array", () => {
    const span: TraceSpan = {
      traceId: "t1",
      spanId: "s1",
      operationName: "GET /api/users",
      serviceName: "user-service",
      startTime: "2026-03-25T12:00:00Z",
      duration: 1500,
      status: "ok",
      attributes: {},
      events: [
        {
          name: "query_start",
          timestamp: "2026-03-25T12:00:00.100Z",
          attributes: { db: "postgres" },
        },
      ],
    }
    expect(span.events).toHaveLength(1)
    expect(span.parentSpanId).toBeUndefined()
  })

  it("TraceSummary has required fields", () => {
    const summary: TraceSummary = {
      traceId: "t1",
      rootSpan: "GET /api",
      duration: 2500,
      spanCount: 12,
      status: "error",
      endpoint: "/api/users",
      module: "core",
      timestamp: "2026-03-25T12:00:00Z",
    }
    expect(summary.status).toBe("error")
  })

  it("TraceQuery and TraceFindQuery are valid", () => {
    const q: TraceQuery = {
      site: "prod",
      minDuration: "500ms",
      status: "error",
    }
    const fq: TraceFindQuery = { requestId: "req-123" }
    expect(q.status).toBe("error")
    expect(fq.requestId).toBe("req-123")
  })

  it("MetricSummaryRow has all numeric fields", () => {
    const row: MetricSummaryRow = {
      module: "core",
      requestsPerSec: 150,
      p50: 12,
      p99: 250,
      errorPct: 0.5,
      cpuPct: 45,
      memoryPct: 60,
    }
    expect(row.errorPct).toBe(0.5)
  })

  it("MetricSeries holds time-aligned data", () => {
    const series: MetricSeries = {
      metric: "http_request_duration_seconds",
      timestamps: ["2026-03-25T12:00:00Z", "2026-03-25T12:05:00Z"],
      values: [0.012, 0.015],
      labels: { method: "GET", path: "/api" },
    }
    expect(series.timestamps).toHaveLength(2)
    expect(series.values).toHaveLength(2)
  })

  it("MetricsQuery supports cross-site comparison", () => {
    const q: MetricsQuery = {
      module: "core",
      sites: "prod-us,prod-eu",
      since: "1h",
      interval: "5m",
    }
    expect(q.sites).toContain(",")
  })

  it("InfraMetricRow has node details", () => {
    const row: InfraMetricRow = {
      node: "node-1",
      cpuPct: 55,
      memoryPct: 70,
      diskPct: 30,
      podCount: 42,
      podCapacity: 110,
      status: "healthy",
    }
    expect(row.podCount).toBeLessThan(row.podCapacity)
  })

  it("Alert has all required fields", () => {
    const alert: Alert = {
      id: "a1",
      name: "High Error Rate",
      severity: "critical",
      status: "firing",
      site: "prod-us",
      module: "core",
      since: "2026-03-25T12:00:00Z",
      description: "Error rate above 5%",
      suggestedActions: ["Check recent deploys", "Review error logs"],
      labels: { team: "platform" },
    }
    expect(alert.severity).toBe("critical")
    expect(alert.suggestedActions).toHaveLength(2)
  })

  it("AlertQuery accepts all filter fields", () => {
    const q: AlertQuery = {
      site: "prod",
      severity: "warning",
      status: "firing",
      limit: 50,
    }
    expect(q.severity).toBe("warning")
  })

  it("AlertRule has threshold and severity", () => {
    const rule: AlertRule = {
      id: "r1",
      name: "High Latency",
      module: "core",
      metric: "http_request_duration_p99",
      threshold: "> 500ms",
      severity: "warning",
      enabled: true,
      notify: "#alerts-channel",
    }
    expect(rule.enabled).toBe(true)
  })

  it("SilenceSpec has required reason", () => {
    const spec: SilenceSpec = {
      module: "core",
      site: "staging",
      duration: "2h",
      reason: "Planned maintenance",
    }
    expect(spec.reason).toBeTruthy()
  })

  it("ObservabilityBackendType union covers all variants", () => {
    const types: ObservabilityBackendType[] = ["noop", "clickstack", "signoz"]
    expect(types).toHaveLength(3)
  })
})
