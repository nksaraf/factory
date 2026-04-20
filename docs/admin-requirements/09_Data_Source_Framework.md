# Step 09 — Data Source & Ingestion Framework

**Phase:** 1C
**Depends on:** 03, 08
**Blocks:** 10, 22
**Owner:** Backend
**Estimated effort:** 5 days

---

## 1. Goal

Replace the current "data source is env vars and bespoke per-city code" with a typed, pluggable, per-org framework. A Customer/Org Admin can add or reconfigure a data source from the Lepton Admin UI, test the connection, watch health, and never need an engineer to touch code.

## 2. Why now

Step 08 just isolated the storage; this step isolates the _input_. Every downstream analytic (alerts, baselines, exports) assumes ingestion is stable, uniform, and observable. Today it isn't.

## 3. Scope

### In scope

- Abstract `DataSourceProvider` interface.
- Concrete implementations: `HereTrafficProvider`, `TomTomMoveProvider`, `CustomWebhookProvider` (receives POSTs), `CustomSftpProvider` (reads drops).
- Credential storage via secret-manager references (not inline).
- Test-connection flow: single-shot fetch, returns normalized sample or typed error.
- Health signals: `last_poll_at`, `last_success_at`, `consecutive_failures`, `rows_ingested_last_hour`.
- Failover: primary fails → secondary provider activates for `data_source.failover_duration_minutes`.
- Per-org config living in `enterprise.organization.data_source_config` (populated via Step 03 keys).

### Out of scope

- Backfill from historical periods — separate ops tool.
- Real-time stream (Kafka/PubSub) providers — Phase 2.
- Multi-source merge (HERE + CCTV fused) — Phase 3.

## 4. Deliverables

1. `@lepton/ingestion` package with the interface and 4 providers.
2. `platform.data_source_health` table.
3. `platform.data_source_credential` table (pointers only — real secrets in AWS Secrets Manager / GCP Secret Manager).
4. `POST /admin/orgs/:id/data-source/test` endpoint.
5. Ingestion worker orchestrating provider polls + failover.
6. Dashboard panel wired to `data_source_health` (consumed in Global Dashboard, Step 17).

## 5. Design

### 5.1 Interface

```ts
// @lepton/ingestion/src/provider.ts
export interface NormalizedObservation {
  segmentId: string
  observedAt: Date
  speedKmh: number
  freeFlowKmh?: number
  jamFactor?: number // 0..10
  confidence?: number // 0..1
  source: "here" | "tomtom" | "custom"
  providerRaw?: unknown
}

export interface DataSourceProvider {
  id: string
  kind: "here" | "tomtom" | "custom_webhook" | "custom_sftp"

  validateConfig(config: unknown): Promise<void> // throws if shape invalid
  testConnection(config, cred): Promise<TestResult> // single-shot fetch
  poll(ctx: PollContext): AsyncIterable<NormalizedObservation> // streaming
  onShutdown(): Promise<void>
}

export interface TestResult {
  ok: boolean
  sample?: NormalizedObservation[]
  latencyMs: number
  error?: { code: string; message: string }
}
```

### 5.2 `enterprise.organization.data_source_config` JSON shape

```json
{
  "provider": "here",
  "credentials_ref": "secrets://gcp/projects/lepton-prod/secrets/here-pune-apikey/versions/latest",
  "poll_interval_seconds": 60,
  "bbox": null,
  "road_types_included": ["motorway", "trunk", "primary", "secondary"],
  "sampling_rate": 1.0,
  "failover_provider": "tomtom",
  "failover_credentials_ref": "secrets://gcp/.../tomtom-pune",
  "stale_threshold_minutes": 5,
  "provider_options": { "flow": true, "incidents": false }
}
```

Validated against the Config Registry definitions (Step 03) on write.

### 5.3 Health table

```sql
CREATE TABLE platform.data_source_health (
  org_id              UUID PRIMARY KEY REFERENCES enterprise.organization(id),
  provider            VARCHAR(32) NOT NULL,
  state               VARCHAR(24) NOT NULL
                      CHECK (state IN ('healthy','degraded','stale','failing','disabled')),
  last_poll_at        TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error          TEXT,
  consecutive_failures INT NOT NULL DEFAULT 0,
  rows_last_hour      BIGINT NOT NULL DEFAULT 0,
  current_failover    BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

State machine:

- `healthy`: last_success within `data_source.stale_threshold_minutes`, `consecutive_failures = 0`.
- `degraded`: ≥ 1 failure in last 10 min but at least 1 success.
- `stale`: no success for `stale_threshold_minutes` but not yet `failing`.
- `failing`: `consecutive_failures ≥ 5`.
- `disabled`: org.provisioning_state ≠ active.

### 5.4 Credential table (pointers only)

```sql
CREATE TABLE platform.data_source_credential (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES platform.customer(id),
  name           VARCHAR(120) NOT NULL,
  provider       VARCHAR(32)  NOT NULL,
  secret_ref     VARCHAR(500) NOT NULL,   -- pointer into secrets manager
  created_by     UUID REFERENCES enterprise.user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rotated_at TIMESTAMPTZ,
  UNIQUE (customer_id, name)
);
```

Credentials themselves NEVER live in Postgres. `secret_ref` is a URI like:

- `secrets://gcp/projects/lepton-prod/secrets/here-pune-apikey/versions/latest`
- `secrets://aws/us-east-1/trafficure/here-pune-apikey`

### 5.5 Test-connection flow

```
POST /admin/orgs/{org_id}/data-source/test
body: { config: { ... }, credentials_ref: "secrets://..." }

→ backend fetches credential from secret manager
→ spins up provider.testConnection(config, cred)
→ returns { ok, sample[], latencyMs, error }
→ DOES NOT persist anything; test is stateless
```

### 5.6 Worker orchestration

One `ingestion-worker` per region runs a pool of org-pollers. Each poller:

```ts
async function pollOrg(orgId) {
  const cfg = await configClient.getJson("data_source", { orgId })
  const provider = providers.get(cfg.provider)
  try {
    for await (const obs of provider.poll({ orgId, config: cfg })) {
      await writeToCustomerSchema(obs)
    }
    await health.markSuccess(orgId)
  } catch (e) {
    await health.markFailure(orgId, e)
    if (shouldFailover(await health.get(orgId))) {
      await failoverActivate(orgId)
    }
  }
}
```

Scheduling: at `poll_interval_seconds` cadence per org, enforced via a single Redis-backed lock per org (so only one worker polls per org at a time).

### 5.7 Failover

When `consecutive_failures ≥ 3` and `failover_provider` is set:

1. Atomic swap: mark `current_failover = true`, switch provider in memory.
2. Emit `data_source.failover_activated` audit event.
3. Try primary again every 5 min; when primary succeeds 3x in a row, revert.

## 6. Enforcement / Runtime

- Every write to traffic tables goes through `writeToCustomerSchema`, which sets `search_path` and records the source.
- `provider.poll` is rate-limited to `poll_interval_seconds` via Redis.
- `testConnection` has a hard 15-second timeout.

## 7. Configuration surface

- **Org Detail → Data Source tab** (Step 19): provider picker, credential picker, interval, bbox, test-connection button, health panel.
- **Customer Detail → Credentials tab** (Step 18): CRUD on `data_source_credential` rows.

## 8. Migration plan

1. Ship framework + HERE provider first. Backfill `data_source_config` for each of the 6 live orgs by reading current env vars.
2. Run both old and new ingestion paths in parallel for 48h; compare row counts.
3. Cut over, remove env-var path.
4. Ship TomTom + Custom providers as follow-ups.

## 9. Acceptance criteria

1. Test-connection for a valid HERE config returns `ok: true` with at least 1 sample observation.
2. Test-connection for an invalid API key returns `ok: false, error.code: 'credential_invalid'`.
3. `data_source_health.state` transitions `healthy → degraded → stale → failing` correctly as failures accumulate.
4. With `failover_provider='tomtom'` and HERE down, TomTom begins polling within 60s and `current_failover=true`.
5. Rotating a credential (updating `secret_ref`) takes effect on the next poll without worker restart.
6. Removing a provider (set `provider=''`) cleanly stops polling within 2 intervals.

## 10. Test plan

### Unit

- Each provider: validateConfig happy path + 5 malformed inputs.
- Health state transitions from every start state on every event.

### Integration

- Spin up HERE mock server; confirm 1-hour poll produces expected row count.
- Kill HERE mock mid-poll → failover to TomTom mock fires.
- Test `search_path` is correctly set per-org during write.

### Manual

- PM uses Org Detail → Data Source UI to swap a credential on staging Dehradun; watches health stay green.

## 11. Edge cases

| Case                                           | Behavior                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Secret manager down                            | `testConnection` returns `error.code: 'credential_unreachable'`; poll retries with exponential backoff. |
| Provider returns 200 with empty body           | `rows_last_hour = 0`; state transitions to `stale` after threshold.                                     |
| Two workers pick up same org (Redis lock race) | Second one bails silently.                                                                              |
| Sampling rate 0.5                              | Provider must deterministically hash(segmentId) to decide; idempotent replays stable.                   |
| Clock skew between provider and us             | Observations older than 1 hour rejected as "stale source".                                              |
| Org archived mid-poll                          | Current poll completes; next is skipped.                                                                |

## 12. Observability

- Metric: `ingest_rows_total{provider,org_id}`.
- Metric: `ingest_poll_duration_ms{provider,org_id}` histogram.
- Metric: `ingest_failover_events_total{from,to}`.
- Metric: `data_source_state{org_id}` gauge (0–4).
- Trace: span `ingest.poll` wraps each poll.
- Log: every failure ERROR-level with provider response snippet (credentials scrubbed).

## 13. Audit events

- `data_source.config_updated` — any write to `organization.data_source_config`.
- `data_source.credential_rotated`.
- `data_source.failover_activated` / `failover_reverted`.
- `data_source.test_run` — user-triggered test (no PII, just result).

## 14. Open questions

- Q1. Are we committing to HERE, TomTom, both, for Phase 1 actual production? Recommendation: HERE only for the 6 live cities; TomTom provider code is ready but not deployed until a customer needs it.
- Q2. SFTP provider — who needs it? Recommendation: defer until a real customer asks (likely WGS).
- Q3. Do we bill per-observation against Ask AI or separately? — Ingestion is always free-of-quota; it's a platform cost to Lepton. Confirmed with Umang.
