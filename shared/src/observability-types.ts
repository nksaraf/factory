// ---------------------------------------------------------------------------
// Log types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  source: string
  attributes: Record<string, string>
  traceId?: string
  spanId?: string
}

export interface LogQuery {
  module?: string
  component?: string
  site?: string
  sandbox?: string
  level?: string
  grep?: string
  since?: string
  until?: string
  around?: string
  window?: string
  buildId?: string
  rolloutId?: string
  host?: string
  unit?: string
  follow?: boolean
  limit?: number
  cursor?: string
}

export interface LogQueryResult {
  entries: LogEntry[]
  hasMore: boolean
  cursor?: string
}

// ---------------------------------------------------------------------------
// Trace types
// ---------------------------------------------------------------------------

export type TraceStatus = "ok" | "error" | "unset"

export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  serviceName: string
  startTime: string
  duration: number
  status: TraceStatus
  attributes: Record<string, string>
  events: Array<{
    name: string
    timestamp: string
    attributes: Record<string, string>
  }>
}

export interface TraceSummary {
  traceId: string
  rootSpan: string
  duration: number
  spanCount: number
  status: "ok" | "error"
  endpoint?: string
  module?: string
  tenant?: string
  timestamp: string
}

export interface TraceQuery {
  site?: string
  module?: string
  component?: string
  tenant?: string
  minDuration?: string
  status?: "ok" | "error"
  since?: string
  until?: string
  limit?: number
}

export interface TraceFindQuery {
  requestId?: string
  deployment?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

export interface MetricSummaryRow {
  module: string
  requestsPerSec: number
  p50: number
  p99: number
  errorPct: number
  cpuPct: number
  memoryPct: number
}

export interface MetricSeries {
  metric: string
  timestamps: string[]
  values: number[]
  labels: Record<string, string>
}

export interface MetricsQuery {
  module?: string
  component?: string
  site?: string
  metric?: string
  since?: string
  until?: string
  interval?: string
  sites?: string
}

export interface InfraMetricRow {
  node: string
  cpuPct: number
  memoryPct: number
  diskPct: number
  podCount: number
  podCapacity: number
  status: string
}

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export type AlertSeverity = "critical" | "warning" | "info"
export type AlertStatus = "firing" | "acknowledged" | "resolved" | "silenced"

export interface Alert {
  id: string
  name: string
  severity: AlertSeverity
  status: AlertStatus
  site?: string
  module?: string
  component?: string
  since: string
  description?: string
  suggestedActions?: string[]
  labels: Record<string, string>
}

export interface AlertQuery {
  site?: string
  module?: string
  severity?: AlertSeverity
  status?: AlertStatus
  since?: string
  limit?: number
}

export interface AlertRule {
  id: string
  name: string
  module?: string
  component?: string
  metric: string
  threshold: string
  severity: AlertSeverity
  enabled: boolean
  notify?: string
}

export interface SilenceSpec {
  module?: string
  site?: string
  duration: string
  reason: string
}

// ---------------------------------------------------------------------------
// Backend discriminant
// ---------------------------------------------------------------------------

export type ObservabilityBackendType = "noop" | "clickstack" | "signoz"
