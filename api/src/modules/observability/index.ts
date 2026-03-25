import { Elysia } from "elysia"

import type { ObservabilityAdapter } from "../../adapters/observability-adapter"
import type {
  LogQuery,
  TraceQuery,
  TraceFindQuery,
  MetricsQuery,
  AlertQuery,
  AlertSeverity,
  AlertStatus,
} from "@smp/factory-shared/observability-types"
import { ObservabilityModel } from "./model"
import * as svc from "./service"

function toLogQuery(q: Record<string, string | undefined>): LogQuery {
  return {
    ...q,
    follow: q.follow === "true",
    limit: q.limit ? Number(q.limit) : undefined,
  }
}

function toTraceQuery(q: Record<string, string | undefined>): TraceQuery {
  return {
    ...q,
    status: q.status as TraceQuery["status"],
    limit: q.limit ? Number(q.limit) : undefined,
  }
}

function toMetricsQuery(q: Record<string, string | undefined>): MetricsQuery {
  return { ...q }
}

function toAlertQuery(q: Record<string, string | undefined>): AlertQuery {
  return {
    ...q,
    severity: q.severity as AlertSeverity | undefined,
    status: q.status as AlertStatus | undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  }
}

export function observabilityController(adapter: ObservabilityAdapter) {
  return new Elysia({ prefix: "/api/v1/observability" })
    // ---- Logs ----
    .get("/logs", ({ query }) => svc.queryLogs(adapter, toLogQuery(query)), {
      query: ObservabilityModel.logQueryParams,
      detail: { tags: ["Observability"], summary: "Query logs" },
    })

    // ---- Traces ----
    .get(
      "/traces",
      ({ query }) => svc.listTraces(adapter, toTraceQuery(query)),
      {
        query: ObservabilityModel.traceListQuery,
        detail: { tags: ["Observability"], summary: "List traces" },
      }
    )
    .get(
      "/traces/find",
      ({ query }) =>
        svc.findTrace(adapter, query as TraceFindQuery),
      {
        query: ObservabilityModel.traceFindQuery,
        detail: { tags: ["Observability"], summary: "Find traces" },
      }
    )
    .get(
      "/traces/:traceId",
      ({ params }) => svc.getTrace(adapter, params.traceId),
      {
        params: ObservabilityModel.traceIdParams,
        detail: { tags: ["Observability"], summary: "Get trace spans" },
      }
    )

    // ---- Metrics ----
    .get(
      "/metrics/summary",
      ({ query }) => svc.getSummary(adapter, toMetricsQuery(query)),
      {
        query: ObservabilityModel.metricsQuery,
        detail: { tags: ["Observability"], summary: "Metrics summary" },
      }
    )
    .get(
      "/metrics/:module/:component",
      ({ params, query }) =>
        svc.getComponentMetrics(
          adapter,
          params.module,
          params.component,
          toMetricsQuery(query)
        ),
      {
        params: ObservabilityModel.metricsComponentParams,
        query: ObservabilityModel.metricsQuery,
        detail: { tags: ["Observability"], summary: "Component metrics" },
      }
    )
    .get(
      "/metrics/series",
      ({ query }) => svc.getSeries(adapter, toMetricsQuery(query)),
      {
        query: ObservabilityModel.metricsQuery,
        detail: { tags: ["Observability"], summary: "Metrics time series" },
      }
    )
    .get(
      "/metrics/infra",
      ({ query }) => svc.getInfraMetrics(adapter, toMetricsQuery(query)),
      {
        query: ObservabilityModel.metricsQuery,
        detail: { tags: ["Observability"], summary: "Infrastructure metrics" },
      }
    )
    .post(
      "/metrics/query",
      ({ body }) =>
        svc.runQuery(adapter, body.promql, {
          site: body.site,
          since: body.since,
          until: body.until,
          interval: body.interval,
        }),
      {
        body: ObservabilityModel.metricsPromqlBody,
        detail: { tags: ["Observability"], summary: "Run PromQL query" },
      }
    )

    // ---- Alerts ----
    .get(
      "/alerts",
      ({ query }) => svc.listAlerts(adapter, toAlertQuery(query)),
      {
        query: ObservabilityModel.alertListQuery,
        detail: { tags: ["Observability"], summary: "List alerts" },
      }
    )
    .get("/alerts/rules", () => svc.listAlertRules(adapter), {
      detail: { tags: ["Observability"], summary: "List alert rules" },
    })
    .get(
      "/alerts/rules/:id",
      ({ params }) => svc.getAlertRule(adapter, params.id),
      {
        params: ObservabilityModel.alertRuleIdParams,
        detail: { tags: ["Observability"], summary: "Get alert rule" },
      }
    )
    .get(
      "/alerts/:id",
      ({ params }) => svc.getAlert(adapter, params.id),
      {
        params: ObservabilityModel.alertIdParams,
        detail: { tags: ["Observability"], summary: "Get alert" },
      }
    )
    .post(
      "/alerts/:id/ack",
      ({ params, body }) => svc.ackAlert(adapter, params.id, body.reason),
      {
        params: ObservabilityModel.alertIdParams,
        body: ObservabilityModel.alertAckBody,
        detail: { tags: ["Observability"], summary: "Acknowledge alert" },
      }
    )
    .post(
      "/alerts/:id/resolve",
      ({ params, body }) =>
        svc.resolveAlert(adapter, params.id, body.reason),
      {
        params: ObservabilityModel.alertIdParams,
        body: ObservabilityModel.alertResolveBody,
        detail: { tags: ["Observability"], summary: "Resolve alert" },
      }
    )
    .post(
      "/alerts/silence",
      ({ body }) => svc.silenceAlerts(adapter, body),
      {
        body: ObservabilityModel.alertSilenceBody,
        detail: { tags: ["Observability"], summary: "Silence alerts" },
      }
    )
    .patch(
      "/alerts/rules/:id",
      ({ params, body }) =>
        svc.setAlertRuleEnabled(adapter, params.id, body.enabled),
      {
        params: ObservabilityModel.alertRuleIdParams,
        body: ObservabilityModel.alertRuleEnableBody,
        detail: { tags: ["Observability"], summary: "Enable/disable alert rule" },
      }
    )
    .post(
      "/alerts/rules",
      ({ body }) => svc.createAlertRule(adapter, body),
      {
        body: ObservabilityModel.alertRuleBody,
        detail: { tags: ["Observability"], summary: "Create alert rule" },
      }
    )
}
