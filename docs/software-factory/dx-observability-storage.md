# dx Addenda — Observability & Object Storage

**Addendum to: The Unified dx Architecture**

---

# Part 1: `dx observe` — Traces, Metrics, Alerts

## 1.1 Where Observability Lives in the Architecture

Observability is a three-layer stack in the plane model:

**Producers** — every plane emits telemetry. Service Plane emits request traces and business metrics. Data Plane emits query latency and storage metrics. Infrastructure Plane emits pod health and resource utilization. Build Plane emits build duration and test results. Fleet Plane emits rollout progress. All telemetry is OpenTelemetry-native.

**Collector** — Control Plane at each Site collects, correlates, and stores telemetry locally. The SigNoz instance runs here, owned by Infrastructure Plane. Control Plane configures what gets collected, what alerts fire, and what gets exported to Factory.

**Aggregator** — Factory Infrastructure Plane runs a Fleet-wide SigNoz instance that receives telemetry from all connected Sites. Air-gapped Sites export telemetry via offline bundles.

dx doesn't have a separate "observability plane." It gives developers a CLI over the SigNoz data that already exists, using the same target resolution and authorization model as everything else.

## 1.2 `dx logs` — Already Exists, Now Grounded

`dx logs` was in the original dx PRD. It now queries SigNoz (not Loki) and supports the full target resolution system.

```bash
# Logs from a component in any target
dx logs geoanalytics api                            # current context (dev/sandbox)
dx logs geoanalytics api --site trafficure-prod-india
dx logs geoanalytics worker --site trafficure-staging
dx logs geoanalytics api --sandbox pr-42

# Follow mode
dx logs geoanalytics api -f                         # stream live
dx logs geoanalytics api -f --since 5m              # last 5 minutes + follow

# Filter
dx logs geoanalytics api --level error              # only errors
dx logs geoanalytics api --level error,warn          # errors and warnings
dx logs geoanalytics api --grep "rate_limit"         # text search
dx logs geoanalytics api --grep "tenant_id=samsung"  # filter by content
dx logs geoanalytics api --json                      # structured JSON output

# Cross-component
dx logs geoanalytics --site trafficure-prod-india    # all components of the module
dx logs --site trafficure-prod-india                 # all modules in the Site

# Time range
dx logs geoanalytics api --since "2026-03-24T03:00:00Z" --until "2026-03-24T04:00:00Z"
dx logs geoanalytics api --since 1h                  # last hour
dx logs geoanalytics api --around "2026-03-24T03:42:00Z" --window 5m  # ±5 min around a timestamp

# Build and deployment logs
dx logs --build build_abc123                         # build output
dx logs --rollout rollout_def456                     # rollout events
dx logs --migration 004_add_rate_limiting            # migration output

# VM and infrastructure logs (via SSH + journalctl)
dx logs k8s-server-1                                 # node system logs
dx logs k8s-server-1 --unit kubelet                  # specific systemd unit
```

## 1.3 `dx trace` — Distributed Tracing

Traces are the debugging superpower for distributed systems. When a request touches the API gateway, auth service, geoanalytics api, geoanalytics worker, and postgres — you need to see the whole journey.

```bash
# Find traces
dx trace list --site trafficure-prod-india --since 1h
  # Shows recent traces: trace ID, root span, duration, status, tenant

dx trace list --site trafficure-prod-india \
  --module geoanalytics \
  --min-duration 500ms \
  --status error \
  --since 1h
  # Slow or failed traces involving geoanalytics

dx trace list --site trafficure-prod-india \
  --tenant samsung \
  --since 30m
  # All traces for a specific tenant (tenant context propagated via OTel attributes)

# Inspect a specific trace
dx trace show abc123def456
  # Waterfall view in terminal:
  #
  # ── traefik-gateway           2ms    ────
  #    ── control-auth            8ms   ────────
  #    ── geoanalytics-api       142ms  ────────────────────────────────
  #       ── postgres query       89ms     ──────────────────────
  #       ── redis cache get       1ms     ─
  #       ── analytics-api        38ms        ─────────────
  #          ── postgres query    29ms           ────────
  #
  # Total: 152ms | Spans: 7 | Errors: 0
  # Tenant: samsung | Namespace: ns_samsung
  # Endpoint: GET /api/v1/analytics/coverage

dx trace show abc123def456 --json               # full trace as JSON (for piping to tools)
dx trace show abc123def456 --spans              # flat list of all spans with timing

# Open trace in SigNoz UI
dx trace open abc123def456                      # opens browser to SigNoz trace view

# Find traces by correlation
dx trace find --request-id req_xyz789           # find trace by application request ID
dx trace find --deployment rollout_def456       # traces during a specific rollout
dx trace find --error "connection refused"      # traces containing a specific error
```

### Trace-aware debugging flow

The real power: connecting a customer bug report to the exact trace.

```bash
# Customer reports: "My coverage report is slow"
# Support ticket has a timestamp and tenant

# Find the slow traces
dx trace list --site trafficure-prod-india \
  --tenant samsung \
  --module geoanalytics \
  --endpoint "/api/v1/analytics/coverage" \
  --min-duration 2s \
  --since "2026-03-24T09:00:00Z" --until "2026-03-24T10:00:00Z"

# TRACE_ID   DURATION  STATUS  ENDPOINT                        TIMESTAMP
# a1b2c3d4   4.2s      ok      GET /api/v1/analytics/coverage  09:14:32
# e5f6g7h8   3.8s      ok      GET /api/v1/analytics/coverage  09:22:15
# i9j0k1l2   8.1s      ok      GET /api/v1/analytics/coverage  09:31:44

# Inspect the slowest one
dx trace show i9j0k1l2

# ── geoanalytics-api       8.1s   ─────────────────────────────────────────
#    ── postgres query       6.9s      ──────────────────────────────────────
#       SELECT ... FROM coverage_zones WHERE tenant_id = $1 AND ...
#       Rows: 142,000 | Sequential scan (missing index?)
#    ── redis cache miss     0.1ms  ─

# Found it: sequential scan on coverage_zones. Missing index.
# Now write a migration to fix it.
```

## 1.4 `dx metrics` — Operational Metrics

Metrics come from two sources: infrastructure metrics (CPU, memory, network, pod health) and application metrics (request rates, error rates, latencies, queue depths, business metrics).

```bash
# Quick health overview
dx metrics summary --site trafficure-prod-india
  # Module         Requests/s  P50    P99    Error%  CPU    Memory
  # geoanalytics   342         23ms   180ms  0.2%    45%    62%
  # auth           1204        4ms    12ms   0.01%   12%    28%
  # workflow        87         45ms   320ms  0.5%    22%    41%

# Component-level detail
dx metrics show geoanalytics api --site trafficure-prod-india
  # Requests:     342/s (↑ 12% vs yesterday)
  # Latency:      P50=23ms  P95=120ms  P99=180ms  P999=450ms
  # Errors:       0.2% (4xx: 0.15%, 5xx: 0.05%)
  # Saturation:   CPU 45%, Memory 62%, Connections 34/100
  # Pods:         3/3 running, 0 restarts in 24h

# Time series (tabular in terminal, graphable with --json)
dx metrics series geoanalytics api \
  --metric request_rate \
  --since 6h \
  --interval 5m \
  --site trafficure-prod-india

# Compare across sites
dx metrics compare geoanalytics api \
  --sites trafficure-prod-india,trafficure-prod-us-east \
  --metric p99_latency \
  --since 24h

# Infrastructure metrics
dx metrics infra --site trafficure-prod-india
  # Node          CPU    Memory  Disk    Pods    Status
  # k8s-agent-1   67%    71%     42%     28/50   ready
  # k8s-agent-2   54%    63%     38%     24/50   ready
  # k8s-agent-3   72%    69%     45%     31/50   ready

dx metrics infra k8s-agent-1                    # detailed node metrics
dx metrics infra --cluster production           # cluster-wide view

# Custom application metrics (emitted by modules via OTel SDK)
dx metrics query "geoanalytics_coverage_report_duration_seconds" \
  --site trafficure-prod-india \
  --since 1h
  # Queries SigNoz PromQL-compatible metrics API

# Open metrics in SigNoz UI
dx metrics open geoanalytics api --site trafficure-prod-india
```

### Factory-level metrics (cross-Site)

```bash
# Fleet health overview
dx metrics fleet
  # Site                      Product      Release   Health  Tenants  Requests/s
  # trafficure-prod-india     Trafficure   v2.4.1    ✓       142     4,200
  # trafficure-prod-us-east   Trafficure   v2.4.1    ✓       89      2,800
  # trafficure-staging        Trafficure   v2.4.2    ✓       —       120
  # samsung-dedicated         Trafficure   v2.4.0    ⚠       1       890
  # networkaccess-prod-us     NetworkAcc   v1.2.0    ✓       34      1,100

# Build pipeline metrics
dx metrics build
  # Module          Avg Build   Success%  Builds/day  Avg Test
  # geoanalytics    2m 14s      94%       12          1m 42s
  # auth            1m 03s      98%       8           0m 48s
  # workflow        3m 22s      91%       6           2m 10s

# DORA-style metrics (calculated from build + deploy data)
dx metrics delivery --team analytics-eng --since 30d
  # Deployment frequency:       4.2/week
  # Lead time for changes:      2.3 days (commit → production)
  # Change failure rate:         8% (rollbacks / deployments)
  # Time to restore:            34 minutes (avg)
```

## 1.5 `dx alert` — Alert Management

Alerts are defined in SigNoz and managed via dx. The CLI is for viewing, acknowledging, and silencing — not for defining complex alert rules (that's the SigNoz UI or infrastructure-as-code).

```bash
# View active alerts
dx alert list
  # SEVERITY  ALERT                                   SITE                    SINCE     STATUS
  # critical  Pod CrashLoopBackOff                     trafficure-prod-india   3m ago    firing
  # warning   P99 latency > 500ms                     trafficure-prod-india   12m ago   firing
  # warning   Disk usage > 80%                        samsung-dedicated        2h ago    firing
  # info      Certificate expires in 14 days          trafficure-prod-eu       1d ago    acknowledged

dx alert list --site trafficure-prod-india           # alerts for one Site
dx alert list --severity critical                     # only critical
dx alert list --module geoanalytics                   # alerts involving geoanalytics

# Alert detail
dx alert show alert_abc123
  # Alert:      Pod CrashLoopBackOff
  # Severity:   critical
  # Site:       trafficure-prod-india
  # Module:     geoanalytics
  # Component:  worker
  # Pod:        geoanalytics-worker-5c8d2-j4kl
  # Since:      3 minutes ago
  # Restarts:   5 in last 10 minutes
  # Last log:   "Error: Redis connection refused"
  #
  # Suggested actions:
  #   dx logs geoanalytics worker --site trafficure-prod-india --since 10m
  #   dx metrics show geoanalytics worker --site trafficure-prod-india
  #   dx exec geoanalytics worker --site trafficure-prod-india -- bash

# Acknowledge (I'm looking at this)
dx alert ack alert_abc123 --reason "Investigating Redis connectivity"

# Silence (suppress notifications for a window)
dx alert silence --module geoanalytics --site trafficure-prod-india --duration 1h \
  --reason "Known issue during migration, monitoring manually"

# Resolve (manually close if auto-resolve didn't trigger)
dx alert resolve alert_abc123 --reason "Redis connection restored after restart"

# Alert history
dx alert history --site trafficure-prod-india --since 7d
dx alert history --module geoanalytics --since 30d --severity critical
```

### Basic alert rules via CLI (simple cases)

For common patterns, dx provides shortcuts that create SigNoz alert rules:

```bash
# Create a threshold alert
dx alert create \
  --name "Geoanalytics P99 > 500ms" \
  --module geoanalytics \
  --component api \
  --metric p99_latency \
  --threshold ">500ms for 5m" \
  --severity warning \
  --notify "#geoanalytics-alerts"

# Create an error rate alert
dx alert create \
  --name "Geoanalytics error spike" \
  --module geoanalytics \
  --component api \
  --metric error_rate \
  --threshold ">1% for 3m" \
  --severity critical \
  --notify "#on-call"

# List alert rules (not firing alerts — the rule definitions)
dx alert rules list
dx alert rules show rule_xyz
dx alert rules disable rule_xyz --reason "Flaky during data migration"
dx alert rules enable rule_xyz

# For complex rules: open SigNoz UI
dx alert rules edit                                  # opens SigNoz alert editor
```

## 1.6 `dx dashboard` — Open Dashboards

dx doesn't render full dashboards in the terminal — that's what the SigNoz UI and the dx web UI are for. The CLI is the quickest path to open the right dashboard.

```bash
# Open dashboards in browser
dx dashboard                                         # opens Factory overview dashboard
dx dashboard --site trafficure-prod-india            # opens Site dashboard
dx dashboard --module geoanalytics                   # opens module dashboard
dx dashboard --module geoanalytics --site trafficure-prod-india  # module in specific Site

# Open SigNoz directly
dx dashboard traces --site trafficure-prod-india     # SigNoz trace explorer
dx dashboard metrics --site trafficure-prod-india    # SigNoz metrics explorer
dx dashboard logs --site trafficure-prod-india       # SigNoz log explorer

# Deployment-specific dashboard (what happened during this rollout)
dx dashboard rollout rollout_def456                  # metrics/logs during the rollout window
```

## 1.7 How the OTel Pipeline Works Under the Hood

Everything is OpenTelemetry-native. The Service Plane SDK instruments modules automatically. dx provides the collection infrastructure.

```
Module (running in Site)
  │ OTel SDK (auto-instrumented by Service Plane SDK)
  │ Emits: traces, metrics, logs
  ▼
OTel Collector (sidecar or daemonset, per Site)
  │ Processes: sampling, tenant labeling, enrichment
  │ Adds: dx.dev/module, dx.dev/component, dx.dev/site, dx.dev/tenant
  ▼
SigNoz (per Site)
  │ Stores: traces, metrics, logs
  │ Evaluates: alert rules
  │ Serves: queries from dx CLI and dx UI
  │
  │ Export pipeline (if connected to Factory):
  ▼
SigNoz (Factory — fleet-wide)
  │ Aggregates: cross-Site metrics
  │ Serves: fleet dashboards, delivery metrics
```

The OTel Collector adds standard attributes to all telemetry:

```
dx.module = "geoanalytics"
dx.component = "api"
dx.site = "trafficure-prod-india"
dx.tenant = "samsung"
dx.namespace = "ns_samsung"
dx.deployment_target = "trafficure-prod-india"
dx.release = "v2.4.1"
dx.module_version = "2.3.0"
```

These attributes are what make `dx trace list --tenant samsung --module geoanalytics` work — it's querying SigNoz with these attribute filters.

---

# Part 2: `dx store` — Object Storage Operations

## 2.1 Where Object Storage Lives

MinIO is the S3-compatible object storage layer. It serves two distinct scopes:

**Factory scope** — Build Plane artifact storage (images, bundles, SBOMs), Agent Plane memory/embeddings, Factory backups. Managed by Infrastructure Plane.

**Site scope** — tenant data (file uploads, exports, reports, geospatial datasets), module data assets (ML models, tile caches, analytics outputs). Managed by Data Plane, scoped by tenant via bucket prefixes.

dx needs to give developers, data engineers, and ops a CLI for moving data in and out of these stores — like rsync/rclone but integrated with the Factory's authorization, tenant scoping, and target resolution.

## 2.2 Bucket Structure

```
Factory MinIO:
  factory-artifacts/          Build artifacts, SBOMs, bundles
  factory-agent-memory/       Agent embeddings and knowledge stores
  factory-backups/            Platform backups

Site MinIO (per Site):
  {namespace}/data/           Tenant data uploads
  {namespace}/exports/        Tenant export files
  {namespace}/assets/         Module-managed assets (tile caches, models, etc.)
  site-shared/                Cross-tenant shared data (public datasets, reference data)
  site-backups/               Site-level backups
```

Tenant scoping: a tenant can only access `{their-namespace}/*`. The SDK enforces this. `dx store` enforces it via the same authorization model.

## 2.3 Command Surface

### Basic Operations

```bash
# List buckets/prefixes
dx store ls                                          # list top-level buckets (in current context)
dx store ls data/                                    # list contents of data/ prefix
dx store ls data/uploads/ --site trafficure-prod-india --tenant samsung

# List with details
dx store ls data/exports/ -l                         # size, modified time, storage class
dx store ls data/ --recursive                        # flat recursive listing
dx store ls data/ --recursive --summary              # count and total size only

# Upload
dx store cp ./report.pdf data/reports/q1-2026.pdf
dx store cp ./exports/ data/exports/ --recursive     # upload directory
dx store cp ./model.bin assets/ml-models/coverage-v3.bin --site trafficure-staging

# Download
dx store cp data/reports/q1-2026.pdf ./local-copy.pdf
dx store cp data/exports/ ./local-exports/ --recursive
dx store cp assets/ml-models/coverage-v3.bin ./model.bin --site trafficure-prod-india --tenant samsung

# Delete
dx store rm data/exports/old-report.pdf
dx store rm data/temp/ --recursive                   # delete prefix recursively
dx store rm data/temp/ --recursive --older-than 30d  # delete files older than 30 days

# Move / rename
dx store mv data/exports/draft.pdf data/exports/final.pdf
```

### Sync — The rsync/rclone Equivalent

```bash
# Sync local directory to store (upload what's changed)
dx store sync ./data/ data/datasets/ --site trafficure-staging
  # Compares local files to remote by size + checksum
  # Uploads new and modified files
  # Does NOT delete remote files not present locally (use --delete for that)
  # Shows progress: files transferred, bytes, speed

# Sync store to local (download what's changed)
dx store sync data/datasets/ ./local-data/ --site trafficure-staging

# Bidirectional comparison (dry-run)
dx store sync ./data/ data/datasets/ --dry-run
  # Shows what would be uploaded/downloaded/deleted without doing it

# Sync with delete (mirror — make remote match local exactly)
dx store sync ./data/ data/datasets/ --delete --site trafficure-staging

# Sync between sites (cross-site data migration)
dx store sync \
  --from trafficure-prod-india:data/datasets/boundaries/ \
  --to trafficure-prod-us-east:data/datasets/boundaries/
  # Copies data between Sites. Requires authorization on both.

# Sync with filters
dx store sync ./data/ data/datasets/ \
  --include "*.geojson" \
  --include "*.csv" \
  --exclude "*.tmp" \
  --exclude ".DS_Store"

# Resume interrupted sync
dx store sync ./large-dataset/ data/datasets/census/ --resume
  # Tracks progress in .dx/.sync-state, resumes from where it left off
```

### Sync Profiles (for repeatable data operations)

```yaml
# .dx/sync-profiles/refresh-staging-geodata.yaml
description: "Refresh staging with latest geo boundary data"
source:
  target: trafficure-prod-india
  path: data/datasets/boundaries/
  tenant: site-shared
destination:
  target: trafficure-staging
  path: data/datasets/boundaries/
  tenant: site-shared
options:
  delete: true
  include: ["*.geojson", "*.topojson"]
  exclude: ["*.tmp"]
```

```bash
dx store sync --profile refresh-staging-geodata
dx store sync --profile refresh-staging-geodata --dry-run
```

### Bulk Operations

```bash
# Generate presigned URLs (for sharing with external systems / customers)
dx store presign data/exports/report.pdf --expires 24h
  # https://minio.trafficure-prod-india.lepton.io/ns_samsung/data/exports/report.pdf?X-Amz-...
  # Expires in 24h. Accessible without authentication.

dx store presign data/exports/report.pdf --expires 1h --download-as "Samsung Q1 Report.pdf"
  # Presigned URL with custom download filename

# Disk usage
dx store du data/                                    # total size of prefix
dx store du data/ --by-prefix                        # size per sub-prefix
dx store du --tenant samsung --site trafficure-prod-india   # total storage for tenant
dx store du --all-tenants --site trafficure-prod-india      # storage per tenant (admin)

# Find large files
dx store find data/ --min-size 100MB --sort size
dx store find data/ --older-than 90d                 # stale files
dx store find data/ --type "*.csv" --newer-than 7d   # recent CSV uploads
```

### Streaming & Pipes

```bash
# Pipe data directly (no local file)
dx db query "SELECT * FROM coverage_zones" --format csv --target staging \
  | dx store cp - data/exports/coverage-export.csv

# Download and pipe
dx store cat data/datasets/boundaries.geojson | jq '.features | length'

# Stream logs to store (for archival)
dx logs geoanalytics api --site trafficure-prod-india --since 24h --json \
  | dx store cp - site-backups/logs/geoanalytics-api-20260324.jsonl
```

### Site-Scoped Operations (Admin / Data Engineering)

```bash
# Cross-tenant data operations (requires platform-admin)
dx store ls --site trafficure-prod-india --all-tenants
  # Lists top-level prefixes for all tenants

# Storage quotas
dx store quota show --tenant samsung --site trafficure-prod-india
  # Used: 2.4 TB / 5.0 TB (48%)
  # Objects: 142,832
  # Largest: data/datasets/footfall-2025.parquet (890 MB)

dx store quota set --tenant samsung --site trafficure-prod-india --limit 10TB
  # Update tenant storage quota (Commerce Plane must authorize)

# Lifecycle policies
dx store lifecycle show --site trafficure-prod-india
  # Rule: exports/* → delete after 90 days
  # Rule: temp/*    → delete after 7 days
  # Rule: assets/*  → transition to cold storage after 180 days

dx store lifecycle set --prefix "temp/" --expire 7d --site trafficure-prod-india
dx store lifecycle set --prefix "data/archives/" --transition cold 90d --site trafficure-prod-india

# Bucket versioning (for critical data)
dx store versioning status data/datasets/ --site trafficure-prod-india
dx store versioning enable data/datasets/ --site trafficure-prod-india
dx store versions data/datasets/boundaries.geojson   # list versions of a file
dx store cp data/datasets/boundaries.geojson ./old.geojson --version abc123  # download old version
```

## 2.4 Authorization

Object storage authorization uses the same SpiceDB model:

| Operation | Sandbox/Dev | Staging | Production |
|---|---|---|---|
| Read own tenant data | Allowed | Team member | Explicit grant |
| Write own tenant data | Allowed | Team member | Explicit grant + audit |
| Read cross-tenant | N/A | Platform admin | Platform admin + audit |
| Read site-shared | Allowed | Allowed | Allowed |
| Write site-shared | Allowed | Platform admin | Platform admin + audit |
| Cross-site sync | N/A | Admin on both | Admin on both + audit |

Production data access always goes through the connection context system — same authorization, same audit trail, same read-only enforcement.

```bash
# Production read requires same authorization as dx db
dx store ls data/exports/ --site trafficure-prod-india --tenant samsung
  # Requires connect-production grant, audited

dx store cp data/exports/report.pdf ./report.pdf \
  --site trafficure-prod-india --tenant samsung --readonly
  # --readonly prevents accidental writes in the same session
```

## 2.5 How `dx store` Resolves Its Target

Same pattern as `dx db` and `dx dev`:

1. No flags → local MinIO (from docker-compose resource definitions, if object storage is declared) or Factory MinIO
2. `--site trafficure-staging` → that Site's MinIO instance
3. `--site trafficure-prod-india --tenant samsung` → tenant-scoped prefix in production MinIO
4. Factory-scope paths (`factory-artifacts/`, `factory-backups/`) → Factory MinIO directly

Under the hood, dx resolves the MinIO endpoint from the deployment target's infrastructure config, sets up credentials (from Vault or platform secrets), and proxies the S3 API calls. For remote targets, it uses the same tunnel infrastructure as `dx connect`.

## 2.6 Factory-Scope Storage Operations

For build artifacts, agent memory, and platform backups:

```bash
# Browse build artifacts
dx store ls factory-artifacts/geoanalytics/
dx store ls factory-artifacts/geoanalytics/2.3.0/

# Agent memory operations (Agent Plane)
dx store ls factory-agent-memory/qa-agent/
dx store cp ./knowledge-base.jsonl factory-agent-memory/qa-agent/kb/

# Platform backups
dx store ls factory-backups/
dx store ls factory-backups/db/
dx store cp factory-backups/db/20260324-0300.sql.gz ./backup.sql.gz
```

## 2.7 Integration with Other dx Commands

Object storage isn't isolated — it connects to other workflows:

```bash
# Seed database from a stored dataset
dx store cp data/seeds/production-sample-sanitized.sql.gz - \
  | gunzip | dx db query -f - --target local

# Export query results to store
dx db query -f ./reports/monthly-summary.sql --target staging --format csv \
  | dx store cp - data/exports/monthly-summary-march.csv --site trafficure-staging

# Backup database to store
dx db backup create --target staging \
  --output store://site-backups/db/staging-20260324.sql.gz

# Deploy a data asset alongside code (tile cache, ML model)
# In docker-compose.yaml, assets are declared via labels:
#   api:
#     labels:
#       catalog.asset.coverage-model.source: assets/coverage-model-v3.bin
#       catalog.asset.coverage-model.destination: assets/ml-models/coverage-v3.bin
# On dx deploy, the asset is synced to the Site's MinIO
```

---

# Part 3: Engineering Metrics — `dx metrics delivery`

Beyond operational metrics (request rate, latency), the Factory tracks engineering process metrics. These come from Build Plane and Fleet Plane data, not from SigNoz.

```bash
# Team delivery metrics
dx metrics delivery --team analytics-eng --since 30d
  # Deployment frequency:     4.2/week
  # Lead time for changes:    2.3 days (commit → production)
  # Change failure rate:       8.2% (rollbacks / total deploys)
  # Time to restore:          34 min (avg incident → resolution)
  # PR merge time:            6.4 hours (avg open → merge)
  # Build success rate:        94%
  # Test flakiness:           2.1% (tests that flip pass/fail without code change)

# Module-specific delivery metrics
dx metrics delivery --module geoanalytics --since 30d

# Company-wide (all teams)
dx metrics delivery --since 30d

# Trend comparison
dx metrics delivery --team analytics-eng --since 90d --interval weekly
  # Shows week-by-week trend for all metrics

# Convention compliance
dx metrics conventions --team analytics-eng --since 30d
  # Override rate:           3.2% (deploys with --force)
  # Branch naming compliance: 98%
  # Commit format compliance: 95%
  # Most overridden rule:    require-staging-first (6 times)
```

These metrics are computed from Factory DB data (builds, deployments, rollouts, overrides, work items). No additional instrumentation needed — the data already exists because every action goes through dx.

---

# Appendix: Complete Observability & Storage Command Reference

```
OBSERVABILITY (SigNoz-backed)
  dx logs <module> [component] [-f] [--level] [--grep] [--since] [--until] [--around]
  dx logs --build <id> | --rollout <id> | --migration <name>
  dx logs <vm-or-node> [--unit]

  dx trace list [--module] [--component] [--tenant] [--min-duration] [--status] [--since]
  dx trace show <trace-id> [--json] [--spans]
  dx trace open <trace-id>
  dx trace find --request-id | --deployment | --error

  dx metrics summary [--site]
  dx metrics show <module> <component> [--site]
  dx metrics series <module> <component> --metric <name> [--since] [--interval]
  dx metrics compare <module> <component> --sites <list> --metric <name>
  dx metrics infra [node] [--site] [--cluster]
  dx metrics fleet
  dx metrics build
  dx metrics delivery [--team] [--module] [--since] [--interval]
  dx metrics conventions [--team] [--since]

  dx alert list [--site] [--module] [--severity]
  dx alert show <id>
  dx alert ack <id> --reason
  dx alert silence [--module] [--site] --duration --reason
  dx alert resolve <id> --reason
  dx alert history [--site] [--module] [--since] [--severity]
  dx alert create --name --module --component --metric --threshold --severity --notify
  dx alert rules list | show | disable | enable

  dx dashboard [--site] [--module]
  dx dashboard traces | metrics | logs [--site]
  dx dashboard rollout <id>

OBJECT STORAGE (MinIO-backed)
  dx store ls [path] [-l] [--recursive] [--summary]
  dx store cp <src> <dst> [--recursive] [--resume]
  dx store mv <src> <dst>
  dx store rm <path> [--recursive] [--older-than]
  dx store cat <path>

  dx store sync <src> <dst> [--delete] [--include] [--exclude] [--dry-run] [--resume]
  dx store sync --from <site:path> --to <site:path>
  dx store sync --profile <name>

  dx store presign <path> --expires [--download-as]
  dx store du [path] [--by-prefix] [--tenant] [--all-tenants]
  dx store find <path> [--min-size] [--older-than] [--newer-than] [--type] [--sort]

  dx store quota show [--tenant] [--site]
  dx store quota set [--tenant] [--site] --limit
  dx store lifecycle show | set [--prefix] [--expire] [--transition]
  dx store versioning status | enable [path]
  dx store versions <path>
```
