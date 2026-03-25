import { logger } from "../logger"
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

export class NoopObservabilityAdapter implements ObservabilityAdapter {
  readonly type = "noop"

  // -- Logs ------------------------------------------------------------------

  async queryLogs(query: LogQuery): Promise<LogQueryResult> {
    logger.debug({ query }, "noop observability adapter: queryLogs")
    return { entries: [], hasMore: false }
  }

  async streamLogs(
    query: LogQuery,
    _onEntry: (entry: LogEntry) => void,
    _signal: AbortSignal
  ): Promise<void> {
    logger.debug({ query }, "noop observability adapter: streamLogs")
  }

  // -- Traces ----------------------------------------------------------------

  async listTraces(query: TraceQuery): Promise<TraceSummary[]> {
    logger.debug({ query }, "noop observability adapter: listTraces")
    return []
  }

  async getTrace(traceId: string): Promise<TraceSpan[]> {
    logger.debug({ traceId }, "noop observability adapter: getTrace")
    return []
  }

  async findTrace(query: TraceFindQuery): Promise<TraceSummary[]> {
    logger.debug({ query }, "noop observability adapter: findTrace")
    return []
  }

  // -- Metrics ---------------------------------------------------------------

  async getSummary(query: MetricsQuery): Promise<MetricSummaryRow[]> {
    logger.debug({ query }, "noop observability adapter: getSummary")
    return []
  }

  async getComponentMetrics(
    module: string,
    component: string,
    query: MetricsQuery
  ): Promise<Record<string, unknown>> {
    logger.debug(
      { module, component, query },
      "noop observability adapter: getComponentMetrics"
    )
    return {}
  }

  async getSeries(query: MetricsQuery): Promise<MetricSeries[]> {
    logger.debug({ query }, "noop observability adapter: getSeries")
    return []
  }

  async getInfraMetrics(query: MetricsQuery): Promise<InfraMetricRow[]> {
    logger.debug({ query }, "noop observability adapter: getInfraMetrics")
    return []
  }

  async runQuery(
    promql: string,
    query: MetricsQuery
  ): Promise<MetricSeries[]> {
    logger.debug({ promql, query }, "noop observability adapter: runQuery")
    return []
  }

  // -- Alerts ----------------------------------------------------------------

  async listAlerts(query: AlertQuery): Promise<Alert[]> {
    logger.debug({ query }, "noop observability adapter: listAlerts")
    return []
  }

  async getAlert(id: string): Promise<Alert> {
    logger.debug({ id }, "noop observability adapter: getAlert")
    throw new Error(`Alert not found: ${id}`)
  }

  async ackAlert(id: string, reason: string): Promise<void> {
    logger.debug({ id, reason }, "noop observability adapter: ackAlert")
  }

  async resolveAlert(id: string, reason: string): Promise<void> {
    logger.debug({ id, reason }, "noop observability adapter: resolveAlert")
  }

  async silenceAlerts(
    spec: SilenceSpec
  ): Promise<{ silenceId: string }> {
    logger.debug({ spec }, "noop observability adapter: silenceAlerts")
    return { silenceId: `silence_noop_${Date.now()}` }
  }

  async listAlertRules(): Promise<AlertRule[]> {
    logger.debug("noop observability adapter: listAlertRules")
    return []
  }

  async getAlertRule(id: string): Promise<AlertRule> {
    logger.debug({ id }, "noop observability adapter: getAlertRule")
    throw new Error(`Alert rule not found: ${id}`)
  }

  async setAlertRuleEnabled(id: string, enabled: boolean): Promise<void> {
    logger.debug(
      { id, enabled },
      "noop observability adapter: setAlertRuleEnabled"
    )
  }

  async createAlertRule(
    rule: Omit<AlertRule, "id">
  ): Promise<AlertRule> {
    logger.debug({ rule }, "noop observability adapter: createAlertRule")
    return { ...rule, id: `rule_noop_${Date.now()}` }
  }
}
