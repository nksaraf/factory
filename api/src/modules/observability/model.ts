import { t } from "elysia"

export const ObservabilityModel = {
  // Logs
  logQueryParams: t.Object({
    module: t.Optional(t.String()),
    component: t.Optional(t.String()),
    site: t.Optional(t.String()),
    sandbox: t.Optional(t.String()),
    level: t.Optional(t.String()),
    grep: t.Optional(t.String()),
    since: t.Optional(t.String()),
    until: t.Optional(t.String()),
    around: t.Optional(t.String()),
    window: t.Optional(t.String()),
    buildId: t.Optional(t.String()),
    rolloutId: t.Optional(t.String()),
    host: t.Optional(t.String()),
    unit: t.Optional(t.String()),
    follow: t.Optional(t.String()),
    limit: t.Optional(t.String()),
    cursor: t.Optional(t.String()),
  }),

  // Traces
  traceListQuery: t.Object({
    site: t.Optional(t.String()),
    module: t.Optional(t.String()),
    component: t.Optional(t.String()),
    tenant: t.Optional(t.String()),
    minDuration: t.Optional(t.String()),
    status: t.Optional(t.String()),
    since: t.Optional(t.String()),
    until: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
  traceIdParams: t.Object({ traceId: t.String() }),
  traceFindQuery: t.Object({
    requestId: t.Optional(t.String()),
    deployment: t.Optional(t.String()),
    error: t.Optional(t.String()),
  }),

  // Metrics
  metricsQuery: t.Object({
    module: t.Optional(t.String()),
    component: t.Optional(t.String()),
    site: t.Optional(t.String()),
    metric: t.Optional(t.String()),
    since: t.Optional(t.String()),
    until: t.Optional(t.String()),
    interval: t.Optional(t.String()),
    sites: t.Optional(t.String()),
  }),
  metricsComponentParams: t.Object({
    module: t.String(),
    component: t.String(),
  }),
  metricsPromqlBody: t.Object({
    promql: t.String(),
    site: t.Optional(t.String()),
    since: t.Optional(t.String()),
    until: t.Optional(t.String()),
    interval: t.Optional(t.String()),
  }),

  // Alerts
  alertListQuery: t.Object({
    site: t.Optional(t.String()),
    module: t.Optional(t.String()),
    severity: t.Optional(t.String()),
    status: t.Optional(t.String()),
    since: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
  alertIdParams: t.Object({ id: t.String() }),
  alertAckBody: t.Object({ reason: t.String() }),
  alertResolveBody: t.Object({ reason: t.String() }),
  alertSilenceBody: t.Object({
    module: t.Optional(t.String()),
    site: t.Optional(t.String()),
    duration: t.String(),
    reason: t.String(),
  }),
  alertRuleIdParams: t.Object({ id: t.String() }),
  alertRuleEnableBody: t.Object({ enabled: t.Boolean() }),
  alertRuleBody: t.Object({
    name: t.String(),
    module: t.Optional(t.String()),
    component: t.Optional(t.String()),
    metric: t.String(),
    threshold: t.String(),
    severity: t.String(),
    enabled: t.Boolean(),
    notify: t.Optional(t.String()),
  }),
} as const
