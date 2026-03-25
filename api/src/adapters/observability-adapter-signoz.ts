import type { ObservabilityAdapter } from "./observability-adapter"
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

const NYI = "SigNoz observability adapter not yet implemented"

/** Stub — SigNoz integration not yet implemented. */
export class SigNozObservabilityAdapter implements ObservabilityAdapter {
  readonly type = "signoz"

  queryLogs(_query: LogQuery): Promise<LogQueryResult> { throw new Error(NYI) }
  streamLogs(_query: LogQuery, _onEntry: (entry: LogEntry) => void, _signal: AbortSignal): Promise<void> { throw new Error(NYI) }
  listTraces(_query: TraceQuery): Promise<TraceSummary[]> { throw new Error(NYI) }
  getTrace(_traceId: string): Promise<TraceSpan[]> { throw new Error(NYI) }
  findTrace(_query: TraceFindQuery): Promise<TraceSummary[]> { throw new Error(NYI) }
  getSummary(_query: MetricsQuery): Promise<MetricSummaryRow[]> { throw new Error(NYI) }
  getComponentMetrics(_module: string, _component: string, _query: MetricsQuery): Promise<Record<string, unknown>> { throw new Error(NYI) }
  getSeries(_query: MetricsQuery): Promise<MetricSeries[]> { throw new Error(NYI) }
  getInfraMetrics(_query: MetricsQuery): Promise<InfraMetricRow[]> { throw new Error(NYI) }
  runQuery(_promql: string, _query: MetricsQuery): Promise<MetricSeries[]> { throw new Error(NYI) }
  listAlerts(_query: AlertQuery): Promise<Alert[]> { throw new Error(NYI) }
  getAlert(_id: string): Promise<Alert> { throw new Error(NYI) }
  ackAlert(_id: string, _reason: string): Promise<void> { throw new Error(NYI) }
  resolveAlert(_id: string, _reason: string): Promise<void> { throw new Error(NYI) }
  silenceAlerts(_spec: SilenceSpec): Promise<{ silenceId: string }> { throw new Error(NYI) }
  listAlertRules(): Promise<AlertRule[]> { throw new Error(NYI) }
  getAlertRule(_id: string): Promise<AlertRule> { throw new Error(NYI) }
  setAlertRuleEnabled(_id: string, _enabled: boolean): Promise<void> { throw new Error(NYI) }
  createAlertRule(_rule: Omit<AlertRule, "id">): Promise<AlertRule> { throw new Error(NYI) }
}
