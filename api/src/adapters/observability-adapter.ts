import type {
  LogQuery,
  LogQueryResult,
  LogEntry,
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

export interface ObservabilityAdapter {
  readonly type: string

  // Logs
  queryLogs(query: LogQuery): Promise<LogQueryResult>
  streamLogs(
    query: LogQuery,
    onEntry: (entry: LogEntry) => void,
    signal: AbortSignal
  ): Promise<void>

  // Traces
  listTraces(query: TraceQuery): Promise<TraceSummary[]>
  getTrace(traceId: string): Promise<TraceSpan[]>
  findTrace(query: TraceFindQuery): Promise<TraceSummary[]>

  // Metrics
  getSummary(query: MetricsQuery): Promise<MetricSummaryRow[]>
  getComponentMetrics(
    module: string,
    component: string,
    query: MetricsQuery
  ): Promise<Record<string, unknown>>
  getSeries(query: MetricsQuery): Promise<MetricSeries[]>
  getInfraMetrics(query: MetricsQuery): Promise<InfraMetricRow[]>
  runQuery(promql: string, query: MetricsQuery): Promise<MetricSeries[]>

  // Alerts
  listAlerts(query: AlertQuery): Promise<Alert[]>
  getAlert(id: string): Promise<Alert>
  ackAlert(id: string, reason: string): Promise<void>
  resolveAlert(id: string, reason: string): Promise<void>
  silenceAlerts(spec: SilenceSpec): Promise<{ silenceId: string }>
  listAlertRules(): Promise<AlertRule[]>
  getAlertRule(id: string): Promise<AlertRule>
  setAlertRuleEnabled(id: string, enabled: boolean): Promise<void>
  createAlertRule(rule: Omit<AlertRule, "id">): Promise<AlertRule>
}
