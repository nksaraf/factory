import type { ObservabilityAdapter } from "../../adapters/observability-adapter"
import type {
  LogQuery,
  TraceQuery,
  TraceFindQuery,
  MetricsQuery,
  AlertQuery,
  SilenceSpec,
  AlertRule,
} from "@smp/factory-shared/observability-types"

// -- Logs --------------------------------------------------------------------

export function queryLogs(adapter: ObservabilityAdapter, query: LogQuery) {
  return adapter.queryLogs(query)
}

// -- Traces ------------------------------------------------------------------

export function listTraces(adapter: ObservabilityAdapter, query: TraceQuery) {
  return adapter.listTraces(query)
}

export function getTrace(adapter: ObservabilityAdapter, traceId: string) {
  return adapter.getTrace(traceId)
}

export function findTrace(
  adapter: ObservabilityAdapter,
  query: TraceFindQuery
) {
  return adapter.findTrace(query)
}

// -- Metrics -----------------------------------------------------------------

export function getSummary(adapter: ObservabilityAdapter, query: MetricsQuery) {
  return adapter.getSummary(query)
}

export function getComponentMetrics(
  adapter: ObservabilityAdapter,
  module: string,
  component: string,
  query: MetricsQuery
) {
  return adapter.getComponentMetrics(module, component, query)
}

export function getSeries(adapter: ObservabilityAdapter, query: MetricsQuery) {
  return adapter.getSeries(query)
}

export function getInfraMetrics(
  adapter: ObservabilityAdapter,
  query: MetricsQuery
) {
  return adapter.getInfraMetrics(query)
}

export function runQuery(
  adapter: ObservabilityAdapter,
  promql: string,
  query: MetricsQuery
) {
  return adapter.runQuery(promql, query)
}

// -- Alerts ------------------------------------------------------------------

export function listAlerts(adapter: ObservabilityAdapter, query: AlertQuery) {
  return adapter.listAlerts(query)
}

export function getAlert(adapter: ObservabilityAdapter, id: string) {
  return adapter.getAlert(id)
}

export function ackAlert(
  adapter: ObservabilityAdapter,
  id: string,
  reason: string
) {
  return adapter.ackAlert(id, reason)
}

export function resolveAlert(
  adapter: ObservabilityAdapter,
  id: string,
  reason: string
) {
  return adapter.resolveAlert(id, reason)
}

export function silenceAlerts(
  adapter: ObservabilityAdapter,
  spec: SilenceSpec
) {
  return adapter.silenceAlerts(spec)
}

export function listAlertRules(adapter: ObservabilityAdapter) {
  return adapter.listAlertRules()
}

export function getAlertRule(adapter: ObservabilityAdapter, id: string) {
  return adapter.getAlertRule(id)
}

export function setAlertRuleEnabled(
  adapter: ObservabilityAdapter,
  id: string,
  enabled: boolean
) {
  return adapter.setAlertRuleEnabled(id, enabled)
}

export function createAlertRule(
  adapter: ObservabilityAdapter,
  rule: Omit<AlertRule, "id">
) {
  return adapter.createAlertRule(rule)
}
