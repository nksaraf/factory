import { logger } from "../logger"
import type { ObservabilityAdapter } from "./observability-adapter"
import type {
  LogQuery,
  LogQueryResult,
  LogEntry,
  LogLevel,
  TraceQuery,
  TraceSummary,
  TraceSpan,
  TraceFindQuery,
  MetricsQuery,
  MetricSummaryRow,
  MetricSeries,
  InfraMetricRow,
  AlertQuery,
  Alert,
  AlertRule,
  SilenceSpec,
} from "@smp/factory-shared/observability-types"

/**
 * Observability adapter backed by Grafana Loki for logs.
 * Traces, metrics, and alerts delegate to noop (not yet backed).
 */
export class LokiObservabilityAdapter implements ObservabilityAdapter {
  readonly type = "loki"
  private readonly baseUrl: string

  constructor(lokiUrl: string) {
    // Strip trailing slash
    this.baseUrl = lokiUrl.replace(/\/+$/, "")
  }

  // -- Logs ------------------------------------------------------------------

  async queryLogs(query: LogQuery): Promise<LogQueryResult> {
    const logql = this.buildLogQL(query)
    const limit = query.limit ?? 100
    const params = new URLSearchParams({ query: logql, limit: String(limit) })

    if (query.since) params.set("start", this.toNanos(query.since))
    if (query.until) params.set("end", this.toNanos(query.until))
    // Cursor takes precedence over since for pagination
    if (query.cursor) params.set("start", query.cursor)

    const url = `${this.baseUrl}/loki/api/v1/query_range?${params}`
    try {
      const res = await fetch(url)
      if (!res.ok) {
        logger.warn({ status: res.status, url }, "Loki query failed")
        return { entries: [], hasMore: false }
      }
      const json = (await res.json()) as LokiQueryRangeResponse
      return this.parseQueryRangeResponse(json, limit)
    } catch (err) {
      logger.error({ err, url }, "Loki query error")
      return { entries: [], hasMore: false }
    }
  }

  async streamLogs(
    query: LogQuery,
    onEntry: (entry: LogEntry) => void,
    signal: AbortSignal
  ): Promise<void> {
    const logql = this.buildLogQL(query)
    const limit = query.limit ?? 100
    const params = new URLSearchParams({ query: logql, limit: String(limit) })
    if (query.since) params.set("start", this.toNanos(query.since))

    // Loki tail is a WebSocket endpoint — reconnect on drop until signal aborts
    const wsUrl =
      this.baseUrl.replace(/^http/, "ws") + `/loki/api/v1/tail?${params}`

    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl)

        const cleanup = () => {
          try {
            ws.close()
          } catch {
            /* already closed */
          }
          resolve()
        }

        signal.addEventListener("abort", cleanup, { once: true })

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data))
            if (msg.streams) {
              for (const stream of msg.streams) {
                for (const [ts, val] of stream.values) {
                  onEntry(this.parseLogLine(ts, val, stream.stream))
                }
              }
            }
          } catch {
            // skip unparseable messages
          }
        }

        ws.onerror = () => {
          cleanup()
        }

        ws.onclose = () => {
          signal.removeEventListener("abort", cleanup)
          resolve()
        }
      })

      // Brief delay before reconnecting (unless aborted)
      if (!signal.aborted) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  // -- LogQL builder ---------------------------------------------------------

  private buildLogQL(query: LogQuery): string {
    // Docker container logs scraped by filelog receiver. Parse JSON first,
    // then filter on the extracted "service" label to exclude non-factory logs.
    let logql = `{service_name=~".+"} | json | service="factory-api"`

    // Filter by log level (Pino numeric levels mapped via json parser)
    if (query.level) {
      const pinoLevel = this.levelToNumber(query.level)
      if (pinoLevel !== undefined) {
        logql += ` | level >= ${pinoLevel}`
      }
    }

    // Operation filter
    if (query.sandbox) {
      logql += ` | op="${query.sandbox}"`
    }

    // Grep filter — sanitize backticks to prevent LogQL injection
    if (query.grep) {
      const safeGrep = query.grep.replace(/`/g, "")
      logql += ` |~ \`${safeGrep}\``
    }

    return logql
  }

  private levelToNumber(level: string): number | undefined {
    const map: Record<string, number> = {
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60,
    }
    return map[level]
  }

  // -- Response parsing ------------------------------------------------------

  private parseQueryRangeResponse(
    json: LokiQueryRangeResponse,
    limit: number
  ): LogQueryResult {
    const entries: LogEntry[] = []
    let lastTs: string | undefined

    for (const stream of json.data?.result ?? []) {
      const labels = stream.stream ?? {}
      for (const [ts, val] of stream.values ?? []) {
        entries.push(this.parseLogLine(ts, val, labels))
        lastTs = ts
      }
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    return {
      entries: entries.slice(0, limit),
      hasMore: entries.length >= limit,
      cursor: lastTs,
    }
  }

  private parseLogLine(
    ts: string,
    val: string,
    labels: Record<string, string>
  ): LogEntry {
    // Strip "Body: Str(...)" wrapping from historical OTel debug exporter output
    let cleaned = val
    while (cleaned.startsWith("Body: Str(") && cleaned.endsWith(")")) {
      cleaned = cleaned.slice("Body: Str(".length, -1)
    }

    // Try to parse as structured JSON log (Pino output)
    let parsed: Record<string, any> = {}
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Plain text log line
      return {
        timestamp: this.fromNanos(ts),
        level: (labels.level as LogLevel) ?? "info",
        message: cleaned,
        source: labels.service_name ?? "factory-api",
        attributes: labels,
      }
    }

    return {
      timestamp: parsed.time ?? this.fromNanos(ts),
      level:
        this.mapPinoLevel(parsed.level) ?? (labels.level as LogLevel) ?? "info",
      message: parsed.msg ?? cleaned,
      source: parsed.service ?? labels.service_name ?? "factory-api",
      attributes: {
        ...labels,
        ...(parsed.op ? { op: parsed.op } : {}),
        ...(parsed.runId ? { runId: parsed.runId } : {}),
        ...(parsed.module ? { module: parsed.module } : {}),
        ...(parsed.durationMs !== undefined
          ? { durationMs: String(parsed.durationMs) }
          : {}),
      },
      traceId: parsed.trace_id ?? parsed.traceId,
      spanId: parsed.span_id ?? parsed.spanId,
    }
  }

  private mapPinoLevel(
    level: number | string | undefined
  ): LogLevel | undefined {
    if (typeof level === "string") return level as LogLevel
    if (typeof level !== "number") return undefined
    if (level <= 10) return "debug"
    if (level <= 20) return "debug"
    if (level <= 30) return "info"
    if (level <= 40) return "warn"
    if (level <= 50) return "error"
    return "fatal"
  }

  // -- Timestamp helpers -----------------------------------------------------

  /** Convert ISO date string to Loki nanosecond timestamp */
  private toNanos(isoOrRelative: string): string {
    // Handle relative times like "1h", "30m", "5m"
    const relMatch = isoOrRelative.match(/^(\d+)([smhd])$/)
    if (relMatch) {
      const [, num, unit] = relMatch
      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60_000,
        h: 3_600_000,
        d: 86_400_000,
      }
      const ms = Date.now() - Number(num) * (multipliers[unit] ?? 60_000)
      return String(ms * 1_000_000)
    }
    return String(new Date(isoOrRelative).getTime() * 1_000_000)
  }

  /** Convert Loki nanosecond timestamp to ISO string */
  private fromNanos(ns: string): string {
    return new Date(Number(ns) / 1_000_000).toISOString()
  }

  // -- Traces (not backed by Loki) -------------------------------------------

  async listTraces(_query: TraceQuery): Promise<TraceSummary[]> {
    return []
  }
  async getTrace(_traceId: string): Promise<TraceSpan[]> {
    return []
  }
  async findTrace(_query: TraceFindQuery): Promise<TraceSummary[]> {
    return []
  }

  // -- Metrics (not backed by Loki) ------------------------------------------

  async getSummary(_query: MetricsQuery): Promise<MetricSummaryRow[]> {
    return []
  }
  async getComponentMetrics(
    _module: string,
    _component: string,
    _query: MetricsQuery
  ): Promise<Record<string, unknown>> {
    return {}
  }
  async getSeries(_query: MetricsQuery): Promise<MetricSeries[]> {
    return []
  }
  async getInfraMetrics(_query: MetricsQuery): Promise<InfraMetricRow[]> {
    return []
  }
  async runQuery(
    _promql: string,
    _query: MetricsQuery
  ): Promise<MetricSeries[]> {
    return []
  }

  // -- Alerts (not backed by Loki) -------------------------------------------

  async listAlerts(_query: AlertQuery): Promise<Alert[]> {
    return []
  }
  async getAlert(id: string): Promise<Alert> {
    throw new Error(`Alert not found: ${id}`)
  }
  async ackAlert(_id: string, _reason: string): Promise<void> {}
  async resolveAlert(_id: string, _reason: string): Promise<void> {}
  async silenceAlerts(_spec: SilenceSpec): Promise<{ silenceId: string }> {
    return { silenceId: `silence_loki_${Date.now()}` }
  }
  async listAlertRules(): Promise<AlertRule[]> {
    return []
  }
  async getAlertRule(id: string): Promise<AlertRule> {
    throw new Error(`Alert rule not found: ${id}`)
  }
  async setAlertRuleEnabled(_id: string, _enabled: boolean): Promise<void> {}
  async createAlertRule(rule: Omit<AlertRule, "id">): Promise<AlertRule> {
    return { ...rule, id: `rule_loki_${Date.now()}` }
  }
}

// -- Loki response types -----------------------------------------------------

interface LokiQueryRangeResponse {
  status: string
  data?: {
    resultType: string
    result: Array<{
      stream: Record<string, string>
      values: Array<[string, string]>
    }>
  }
}
