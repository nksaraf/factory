import type {
  Alert,
  AlertQuery,
  AlertRule,
  InfraMetricRow,
  LogEntry,
  LogQuery,
  LogQueryResult,
  MetricSeries,
  MetricSummaryRow,
  MetricsQuery,
  SilenceSpec,
  TraceFindQuery,
  TraceQuery,
  TraceSpan,
  TraceSummary,
} from "@smp/factory-shared/observability-types"

import type { ObservabilityAdapter } from "./observability-adapter"

const DEMO_ALERTS: Alert[] = [
  {
    id: "alert-001",
    name: "High CPU on cls-prod-us-east",
    severity: "critical",
    status: "firing",
    site: "verizon-network-access",
    module: "network-access-api",
    description: "CPU usage >90% for 5 minutes",
    since: new Date(Date.now() - 12 * 60_000).toISOString(),
    labels: { cluster: "prod-us-east", pod: "na-api-7f9d6-xk2p4" },
  },
  {
    id: "alert-002",
    name: "Memory pressure on sandbox sbx-alice-dev",
    severity: "warning",
    status: "firing",
    site: undefined,
    module: undefined,
    description: "Memory usage >85% threshold",
    since: new Date(Date.now() - 45 * 60_000).toISOString(),
    labels: { sandbox: "sbx-alice-dev" },
  },
  {
    id: "alert-003",
    name: "Disk space low on prod-eu-west",
    severity: "warning",
    status: "acknowledged",
    site: "walmart-smart-inventory",
    module: "inventory-worker",
    description: "Disk usage >80% on PVC data-inventory-0",
    since: new Date(Date.now() - 2 * 3600_000).toISOString(),
    labels: { cluster: "prod-eu-west", pvc: "data-inventory-0" },
  },
  {
    id: "alert-004",
    name: "Pod restart loop in staging",
    severity: "critical",
    status: "firing",
    site: "lepton-staging",
    module: "smartops-collector",
    description: "CrashLoopBackOff: 8 restarts in 10 minutes",
    since: new Date(Date.now() - 8 * 60_000).toISOString(),
    labels: { cluster: "staging-us", pod: "smartops-collector-9x2f" },
  },
  {
    id: "alert-005",
    name: "SSL certificate expiring",
    severity: "warning",
    status: "firing",
    site: "bmw-trafficure",
    module: "trafficure-gateway",
    description: "Certificate expires in 7 days",
    since: new Date(Date.now() - 24 * 3600_000).toISOString(),
    labels: { domain: "trafficure.bmw.lepton.io" },
  },
  {
    id: "alert-006",
    name: "API latency spike",
    severity: "info",
    status: "resolved",
    site: "lepton-prod-us",
    module: "network-access-api",
    description: "P99 latency >500ms (resolved)",
    since: new Date(Date.now() - 6 * 3600_000).toISOString(),
    labels: { endpoint: "/api/v1/sessions" },
  },
]

const LOG_TEMPLATES: Array<Pick<LogEntry, "level" | "message" | "source">> = [
  {
    level: "info",
    message: "Request handled: GET /api/v1/factory/infra/providers 200 12ms",
    source: "factory-api",
  },
  {
    level: "info",
    message: "Reconciler tick: 3 sandboxes checked, 0 drifted",
    source: "reconciler",
  },
  {
    level: "warn",
    message: "Slow query detected: SELECT * FROM ops.workbench (340ms)",
    source: "db",
  },
  {
    level: "info",
    message:
      "Gateway route updated: na-api.verizon.lepton.io -> cls-prod-us-east:30080",
    source: "gateway",
  },
  {
    level: "error",
    message: "Pod smartops-collector-9x2f entered CrashLoopBackOff",
    source: "k8s-watcher",
  },
  {
    level: "info",
    message: "Health check passed for sandbox sbx-bob-staging",
    source: "health-checker",
  },
  {
    level: "debug",
    message: "WebSocket connection established for tunnel tnl-alice-3000",
    source: "tunnel-broker",
  },
  {
    level: "info",
    message: "Build pipeline prun-abc123 completed: success (2m 34s)",
    source: "ci-runner",
  },
  {
    level: "warn",
    message: "Rate limit approaching for GitHub API (4800/5000 remaining)",
    source: "git-host",
  },
  {
    level: "info",
    message: "Preview deployment prev-feat-auth deployed to preview-us-east",
    source: "preview-controller",
  },
  {
    level: "info",
    message: "Release 2.14.0 promoted to production across 5 sites",
    source: "ops-controller",
  },
  {
    level: "error",
    message: "Connection refused to proxmox node pve-node-03.internal:8006",
    source: "proxmox-adapter",
  },
  {
    level: "info",
    message: "Sandbox sbx-charlie-dev provisioned in 42s (container runtime)",
    source: "sandbox-controller",
  },
  {
    level: "debug",
    message: "DNS verification passed for domain smartmarket.acme.lepton.io",
    source: "domain-verifier",
  },
  {
    level: "info",
    message:
      "Customer entitlement synced: walmart -> smart-inventory (12 modules)",
    source: "commerce",
  },
]

export class DemoObservabilityAdapter implements ObservabilityAdapter {
  readonly type = "demo"
  private logCounter = 0

  async queryLogs(query: LogQuery): Promise<LogQueryResult> {
    const limit = query.limit ?? 50
    const entries: LogEntry[] = []
    for (let i = 0; i < limit; i++) {
      const template =
        LOG_TEMPLATES[(this.logCounter + i) % LOG_TEMPLATES.length]
      if (
        query.level &&
        levelPriority(template.level) < levelPriority(query.level)
      )
        continue
      entries.push({
        ...template,
        timestamp: new Date(Date.now() - (limit - i) * 2000).toISOString(),
        attributes: {},
      })
    }
    this.logCounter += limit
    return { entries, hasMore: true }
  }

  async streamLogs(
    _query: LogQuery,
    _onEntry: (entry: LogEntry) => void,
    _signal: AbortSignal
  ): Promise<void> {}

  async listTraces(_query: TraceQuery): Promise<TraceSummary[]> {
    return []
  }

  async getTrace(_traceId: string): Promise<TraceSpan[]> {
    return []
  }

  async findTrace(_query: TraceFindQuery): Promise<TraceSummary[]> {
    return []
  }

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

  async listAlerts(_query: AlertQuery): Promise<Alert[]> {
    return DEMO_ALERTS
  }

  async getAlert(id: string): Promise<Alert> {
    const a = DEMO_ALERTS.find((a) => a.id === id)
    if (!a) throw new Error(`Alert not found: ${id}`)
    return a
  }

  async ackAlert(_id: string, _reason: string): Promise<void> {}

  async resolveAlert(_id: string, _reason: string): Promise<void> {}

  async silenceAlerts(_spec: SilenceSpec): Promise<{ silenceId: string }> {
    return { silenceId: `silence_demo_${Date.now()}` }
  }

  async listAlertRules(): Promise<AlertRule[]> {
    return []
  }

  async getAlertRule(id: string): Promise<AlertRule> {
    throw new Error(`Alert rule not found: ${id}`)
  }

  async setAlertRuleEnabled(_id: string, _enabled: boolean): Promise<void> {}

  async createAlertRule(rule: Omit<AlertRule, "id">): Promise<AlertRule> {
    return { ...rule, id: `rule_demo_${Date.now()}` }
  }
}

function levelPriority(level: string): number {
  switch (level) {
    case "error":
      return 4
    case "warn":
      return 3
    case "info":
      return 2
    case "debug":
      return 1
    default:
      return 0
  }
}
