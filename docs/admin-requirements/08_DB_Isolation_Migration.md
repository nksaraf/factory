# Step 08 — Database Isolation Migration (public → customer\_<slug>)

**Phase:** 1C
**Depends on:** 01, 02, 05
**Blocks:** 09, 10, 12, 22
**Owner:** Backend + Ops
**Estimated effort:** 8 days (includes rehearsal on staging)

---

## 1. Goal

Move every per-customer traffic data table out of the shared `public` schema into one dedicated Postgres schema per Customer (`customer_pune`, `customer_kolkata`, etc.). After this step, cross-customer data leaks are impossible at the SQL level — even a buggy `WHERE` clause cannot see another customer's rows because the query is physically scoped to one schema.

## 2. Why now

Today `traffic_observation` (126 GB) and `traffic_metric` (34 GB) have no `organization_id` column, so a single bug can spray data across tenants. App-level scope middleware (Step 05) is a first defense, but a compliance-grade story needs schema-level isolation.

## 3. Scope

### In scope

- Create `customer_<slug>` schema per existing Customer.
- Clone table structures from `public` into each new schema: `road_segment`, `road_hierarchy`, `traffic_observation`, `traffic_metric`, `analytics_hourly_road_metrics`, `alert`, `alert_policy_config`, `baselines`, `cities`, `network_hourly_snapshot`, `report`.
- Backfill: copy rows from `public.*` into the correct `customer_<slug>.*` based on `organization.id` join.
- Cut over ingestion pipeline to write directly to customer schemas.
- Cut over the application to read from customer schemas via a per-request `search_path`.
- Leave `public.*` tables in place (read-only, renamed) for 30 days as rollback safety, then drop.

### Out of scope

- Per-region DB instances (Phase 3).
- Customer schema deletion after churn — Step 12 retention handles this.

## 4. Deliverables

1. Migration generator script `generate_customer_schema.sh <slug>` — idempotent DDL.
2. Backfill orchestrator `backfill_customer_data.ts` with resumable per-customer runs.
3. Updated data access layer: `withCustomerSchema(customerId, query)`.
4. Ingestion-pipeline patch that routes writes by `organization_id → customer_id → schema`.
5. Runbook `docs/runbooks/customer_schema_migration.md` with exact cut-over procedure.
6. Rehearsal results from staging (written up and PM-signed).

## 5. Design

### 5.1 Target layout

```
postgres
├── enterprise/          (Better Auth — unchanged)
├── platform/            (control plane — Steps 01,04,05)
├── admin/               (notifications — unchanged for now; migrated in a later step)
├── raw/                 (ingestion staging, shared; routed on write)
├── customer_pune/
│   ├── road_segment
│   ├── traffic_observation
│   ├── traffic_metric
│   ├── analytics_hourly_road_metrics
│   ├── alert
│   ├── alert_policy_config
│   └── baselines
├── customer_kolkata/    (same tables)
├── customer_dehradun/
├── ...
└── public/              (keep empty/read-only; will be dropped after rollback window)
```

### 5.2 Schema creation script

```sql
-- generate_customer_schema(slug) — idempotent
CREATE SCHEMA IF NOT EXISTS customer_pune;

-- Tables that TODAY have organization_id column
CREATE TABLE IF NOT EXISTS customer_pune.road_segment (LIKE public.road_segment INCLUDING ALL);
CREATE TABLE IF NOT EXISTS customer_pune.road_hierarchy (LIKE public.road_hierarchy INCLUDING ALL);
CREATE TABLE IF NOT EXISTS customer_pune.cities (LIKE public.cities INCLUDING ALL);

-- Tables that DON'T today — they lose organization_id after migration (schema IS the isolation)
CREATE TABLE IF NOT EXISTS customer_pune.traffic_observation (
    LIKE public.traffic_observation INCLUDING INDEXES INCLUDING DEFAULTS
);
ALTER TABLE customer_pune.traffic_observation DROP COLUMN IF EXISTS organization_id;
-- repeat for traffic_metric, analytics_hourly_road_metrics, alert, alert_policy_config, baselines, network_hourly_snapshot, report
```

### 5.3 Backfill

Per-customer, resumable, batched. Runs off a replica when possible.

```sql
-- For each customer's org_ids, copy in chunks
WITH org_ids AS (SELECT id FROM enterprise.organization WHERE customer_id = $customer_id)
INSERT INTO customer_pune.traffic_observation
SELECT o.*
  FROM public.traffic_observation o
  JOIN public.road_segment r ON r.id = o.segment_id
 WHERE r.organization_id IN (SELECT id FROM org_ids)
   AND o.observed_at BETWEEN $batch_start AND $batch_end;
```

The orchestrator:

- Splits `observed_at` into 1-hour batches.
- Tracks progress per customer in `platform.schema_migration_progress`:
  ```sql
  CREATE TABLE platform.schema_migration_progress (
    customer_id UUID, table_name TEXT, batch_start TIMESTAMPTZ,
    batch_end TIMESTAMPTZ, rows_copied BIGINT, completed_at TIMESTAMPTZ,
    PRIMARY KEY (customer_id, table_name, batch_start));
  ```
- Can resume after crash.

### 5.4 Cut-over strategy

**Approach: dual-write, then flip reads.**

Phase A — Set up:

1. Create all customer schemas + empty tables.
2. Deploy ingestion that writes to BOTH `public.*` AND `customer_<slug>.*`.
3. Verify row counts match within 5 min for last hour.

Phase B — Backfill:

1. Backfill historical data from `public.*` to `customer_<slug>.*` (one customer at a time; largest last).
2. Verify per-customer: `SELECT count(*) FROM customer_pune.traffic_observation` ≈ expected.

Phase C — Flip reads:

1. Deploy app with `WITH_CUSTOMER_SCHEMA=true`. App sets `SET search_path TO customer_<slug>, public;` at the start of every request.
2. Canary: 1 org (Dehradun, smallest) for 48h.
3. Progressive rollout: 1 customer per day.

Phase D — Stop dual-write:

1. After 7 days of read-flip with no issues, switch ingestion to write only to customer schemas.
2. Rename `public.traffic_observation` → `public._deprecated_traffic_observation` to surface any orphan queries.

Phase E — Drop:

1. After 30 days, drop `public._deprecated_*` tables.

### 5.5 Data access layer

```ts
export async function withCustomerSchema<T>(
  customerId: string,
  fn: (tx) => Promise<T>
): Promise<T> {
  const schema = await resolveSchemaName(customerId) // 'customer_pune'
  return db.transaction(async (tx) => {
    await tx.raw(`SET LOCAL search_path TO ${schema}, public`)
    return fn(tx)
  })
}

// usage
const obs = await withCustomerSchema(ctx.customerId, (tx) =>
  tx("traffic_observation").where("observed_at", ">", since).select("*")
)
```

CI lint: no query may reference `public.traffic_observation` etc. outside ingestion tooling.

### 5.6 Ingestion routing

The ingestion worker resolves `organization_id` of each observation, looks up `customer_id` via `enterprise.organization`, then writes to the appropriate schema. Caches the map in memory, refreshes every 30s.

## 6. Enforcement / Runtime

- Every request middleware sets `search_path`.
- If a query runs without `search_path` set (e.g. background job without context), it errors out — `public.*` tables have been renamed with `_deprecated_` prefix.

## 7. Configuration surface

- `platform.customer.db_schema_name` (from Step 01) is the single source of truth; UI (Step 18) shows it read-only.

## 8. Migration plan (ops runbook)

| Day | Action                                               | Gate              |
| --- | ---------------------------------------------------- | ----------------- |
| -14 | Dry run on staging with prod-sized data              | CTO               |
| -7  | Rehearsal on staging with same prod dataset snapshot | CTO               |
| 0   | Phase A — create schemas + dual-write                | 3 eng + PM online |
| 1   | Phase B — backfill Dehradun                          | Ops               |
| 2   | Phase B — backfill Howrah, Barrackpore, Bidhan Nagar | Ops               |
| 3   | Phase B — backfill Kolkata                           | Ops               |
| 4   | Phase B — backfill Pune (largest)                    | Ops               |
| 5   | Phase C — read-flip canary Dehradun                  | PM                |
| 7   | Phase C — flip Kolkata                               | PM                |
| 9   | Phase C — flip Pune                                  | PM                |
| 14  | Phase D — stop dual-write                            | CTO               |
| 44  | Phase E — drop `public._deprecated_*`                | CTO               |

Rollback: at any point before Phase D, flip `WITH_CUSTOMER_SCHEMA=false` and the app reads from `public.*` again. Backfilled data in customer\_\* is harmless.

## 9. Acceptance criteria

1. `SELECT count(*) FROM customer_pune.traffic_observation` returns a number equal (±0.01%) to `SELECT count(*) FROM public.traffic_observation o JOIN public.road_segment r USING(segment_id) WHERE r.organization_id IN (pune orgs)`.
2. After flip, a query run as a user whose subject has only Dehradun scope cannot `SELECT * FROM customer_pune.traffic_observation` — `permission denied for schema customer_pune` at the Postgres role level.
3. Deleting `public._deprecated_traffic_observation` does not break the app.
4. Ingestion lag after flip: p95 < 30s (within 5× pre-flip baseline).
5. Backfill completes in < 12 hours for the largest customer (Pune) on the spec'd hardware.

## 10. Test plan

### Staging rehearsal (required before prod)

- Take a `pg_dump` snapshot of prod last Sunday at 02:00.
- Restore to staging.
- Run the full Day 0 → Day 14 sequence on staging.
- Measure: total backfill duration, peak disk, replication lag, application error rate.
- Write-up signed by PM + CTO.

### Chaos

- Kill the backfill orchestrator mid-run — resume completes to 100%.
- Kill ingestion mid dual-write — row counts reconcile within 60s.
- Simulate schema `customer_xxx` missing at flip time — app returns typed error, does not crash.

## 11. Edge cases

| Case                                                            | Behavior                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Customer slug renamed after schema created                      | DB schema stays; add `rename-schema` migration only with CTO approval. Practically: slug is immutable after activation. |
| Org moves from one customer to another                          | Out of scope for Phase 1. Would require per-org data migration. Document as "not supported."                            |
| Orphan `traffic_observation` rows whose `segment_id` has no org | Copied to `customer_shared_legacy` schema; flagged in a report; decision per-row.                                       |
| New table added later                                           | Must include a migration that creates it in every existing customer schema + updates the generator.                     |

## 12. Observability

- Metric: `ingestion_dual_write_skew_rows` — diff between `public` and `customer_*` counts over last hour; alert > 100.
- Metric: `customer_schema_query_total{schema}` — watch for the flip going wrong.
- Metric: `backfill_progress_rows{customer_id,table}` — dashboarded.
- Log: every missing `search_path` error ERROR-level.

## 13. Audit events

- `customer.schema_created` emitted by generator.
- `customer.schema_backfilled` emitted by orchestrator.
- `customer.schema_dropped` emitted in Phase E.

## 14. Open questions

- Q1. Postgres role-per-customer for belt-and-suspenders isolation at DB level? Recommendation: yes but in Phase 3. Currently app uses one role; schemas + `search_path` are the boundary.
- Q2. Do we need RLS (Row Level Security) as an additional safety net? Recommendation: no — schema separation is stronger and avoids the performance hit.
- Q3. Partitioning within `traffic_observation` per customer? Recommendation: it's already partitioned by time within public; keep that pattern inside each customer schema.
