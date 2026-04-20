# Step 03 — Configuration Registry

**Phase:** 1A
**Depends on:** 01
**Blocks:** 04, 09, 10, 11, 12, 13, 16, 19, 20, 21
**Owner:** Backend + PM
**Estimated effort:** 3 days

---

## 1. Goal

Define the **single source of truth for every configurable value in TraffiCure**. No feature, limit, threshold, default, toggle, or policy may be hardcoded — every one of them must appear as a row in this registry with an enforcement story attached.

After this step, an engineer picking up any future PRD can search the registry to see whether a new knob is needed and, if so, must add the registry row in the same PR as the feature.

## 2. Why now

All subsequent steps (alerts, data source, retention, flags, billing) reference config keys. If this registry doesn't exist, each team will invent their own JSON shapes and naming conventions, guaranteeing drift.

## 3. Scope

### In scope

- New table `platform.config_key` — the registry of every legal config key.
- New table `platform.config_value` — actual values at various scopes (platform/customer/org/user).
- Seed the registry with the initial ~85 keys listed below.
- Resolver function `platform.resolve_config(key, customer_id, org_id, user_id)` that walks the scope chain and returns the effective value.
- Typed accessors in the application layer (`ConfigClient.getInt(key, ctx)` etc.).

### Out of scope

- UI for editing config values — that's per-domain in Steps 19, 20, 21.
- Per-tenant config — current architecture uses Customer as the highest customer-facing scope.

## 4. Deliverables

1. Migration `20260417_001_config_registry.sql`.
2. Seed file `seed_config_keys.sql` with ~85 rows documented below.
3. `ConfigClient` library (Node/TS) with typed getters, Redis-backed cache (60s TTL), invalidation hook on any write to `platform.config_value`.
4. Admin API endpoints (spec lives here, implementation in Step 16):
   - `GET /admin/config/keys` — list registry
   - `GET /admin/config/values?scope=customer&scopeId=...` — list values at a scope
   - `PUT /admin/config/values` — upsert a value (emits audit event)
5. Code lint rule that flags string-literal config keys not present in the registry.

## 5. Design

### 5.1 `platform.config_key`

```sql
CREATE TABLE platform.config_key (
    key               VARCHAR(128) PRIMARY KEY,
    domain            VARCHAR(32)  NOT NULL,      -- alerts, data_source, retention, rbac, ui, auth, billing, notifications, flags, limits, locale, geo, branding, ops
    value_type        VARCHAR(16)  NOT NULL CHECK (value_type IN
                        ('int','float','bool','string','enum','json','duration','bytes')),
    allowed_scopes    VARCHAR(16)[] NOT NULL,     -- subset of {platform, customer, org, user}
    default_value     JSONB        NOT NULL,       -- always JSON-encoded
    allowed_values    JSONB,                       -- for enum: ["a","b","c"]; for int: {"min":0,"max":100}; null otherwise
    unit              VARCHAR(24),                 -- 'km/h', 'seconds', 'days', 'USD', 'count', etc.
    description       TEXT NOT NULL,
    ui_path           VARCHAR(200),                -- e.g. "Lepton Admin > Org Detail > City Config"
    api_path          VARCHAR(200),                -- e.g. "PUT /admin/orgs/{id}/config/{key}"
    enforcement_point VARCHAR(64) NOT NULL,        -- where in the codebase the value is read (see 5.5)
    cache_ttl_sec     INT         NOT NULL DEFAULT 60,
    audit_category    VARCHAR(32) NOT NULL,        -- 'config_change', 'entitlement_change', 'rbac_change', 'flag_change', 'security_change'
    min_role_to_edit  VARCHAR(32) NOT NULL         -- 'super_admin' | 'ops_admin' | 'customer_admin' | 'org_admin'
                      CHECK (min_role_to_edit IN
                             ('super_admin','ops_admin','customer_admin','org_admin')),
    requires_restart  BOOLEAN     NOT NULL DEFAULT false,
    deprecated        BOOLEAN     NOT NULL DEFAULT false,
    deprecated_in     VARCHAR(16),
    replaced_by       VARCHAR(128),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cfgkey_domain ON platform.config_key(domain);
```

### 5.2 `platform.config_value`

```sql
CREATE TABLE platform.config_value (
    id            BIGSERIAL PRIMARY KEY,
    key           VARCHAR(128) NOT NULL REFERENCES platform.config_key(key),
    scope_type    VARCHAR(16)  NOT NULL CHECK (scope_type IN ('platform','customer','org','user')),
    scope_id      VARCHAR(128),                    -- NULL when scope_type='platform'
    value         JSONB NOT NULL,
    set_by        UUID REFERENCES enterprise.user(id),
    set_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    note          TEXT,
    UNIQUE (key, scope_type, scope_id)
);
CREATE INDEX idx_cfgval_key_scope ON platform.config_value(key, scope_type, scope_id);
```

### 5.3 Resolver

```sql
CREATE OR REPLACE FUNCTION platform.resolve_config(
    p_key       VARCHAR,
    p_user_id   UUID DEFAULT NULL,
    p_org_id    UUID DEFAULT NULL,
    p_customer_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v JSONB;
BEGIN
    -- User scope
    IF p_user_id IS NOT NULL THEN
        SELECT value INTO v FROM platform.config_value
         WHERE key = p_key AND scope_type='user' AND scope_id = p_user_id::text;
        IF FOUND THEN RETURN v; END IF;
    END IF;
    -- Org scope
    IF p_org_id IS NOT NULL THEN
        SELECT value INTO v FROM platform.config_value
         WHERE key = p_key AND scope_type='org' AND scope_id = p_org_id::text;
        IF FOUND THEN RETURN v; END IF;
    END IF;
    -- Customer scope
    IF p_customer_id IS NOT NULL THEN
        SELECT value INTO v FROM platform.config_value
         WHERE key = p_key AND scope_type='customer' AND scope_id = p_customer_id::text;
        IF FOUND THEN RETURN v; END IF;
    END IF;
    -- Platform scope
    SELECT value INTO v FROM platform.config_value
     WHERE key = p_key AND scope_type='platform';
    IF FOUND THEN RETURN v; END IF;
    -- Default
    SELECT default_value INTO v FROM platform.config_key WHERE key = p_key;
    RETURN v;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 5.4 ConfigClient (TypeScript)

```ts
// packages/config-client/src/index.ts
export interface ConfigContext {
  userId?: string
  orgId?: string
  customerId?: string
}

export class ConfigClient {
  constructor(
    private db: PgClient,
    private redis: Redis
  ) {}

  async get<T>(key: string, ctx: ConfigContext): Promise<T> {
    const cacheKey = `cfg:${key}:${ctx.customerId ?? "-"}:${ctx.orgId ?? "-"}:${ctx.userId ?? "-"}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const row = await this.db.query(
      `SELECT platform.resolve_config($1,$2,$3,$4) AS v`,
      [key, ctx.userId, ctx.orgId, ctx.customerId]
    )
    const val = row.v as T

    const meta = await this.getMeta(key)
    await this.redis.setex(cacheKey, meta.cache_ttl_sec, JSON.stringify(val))
    return val
  }

  async getInt(k: string, c: ConfigContext) {
    return this.get<number>(k, c)
  }
  async getBool(k: string, c: ConfigContext) {
    return this.get<boolean>(k, c)
  }
  async getString(k: string, c: ConfigContext) {
    return this.get<string>(k, c)
  }
  async getJson<T>(k: string, c: ConfigContext): Promise<T> {
    return this.get<T>(k, c)
  }
}
```

### 5.5 Enforcement points (canonical list of loci)

Every config key names ONE enforcement point. These are the only allowed values:

| Code                          | Meaning                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `middleware.entitlement`      | Evaluated in the entitlement middleware before the request reaches the handler. |
| `middleware.scope`            | Evaluated in the scope middleware (row-level filter).                           |
| `middleware.auth`             | Session / login path.                                                           |
| `middleware.rate_limit`       | Rate limiter layer.                                                             |
| `job.alert_evaluator`         | Alert rule evaluator (Step 10).                                                 |
| `job.retention_pruner`        | Retention pruning job (Step 12).                                                |
| `job.ingestion`               | Ingestion pipeline (Step 09).                                                   |
| `job.notification_dispatcher` | Notification worker (Step 11).                                                  |
| `ui.runtime`                  | Read at UI render time.                                                         |
| `api.runtime`                 | Read at API handler runtime.                                                    |
| `billing.invoice_generator`   | Billing invoice job (Step 14).                                                  |

## 6. Initial Registry Seed

Below is the seed list. Engineers adding a new knob in a future step MUST PR an addition here.

### 6.1 Entitlements / limits (domain=`limits`)

| Key                                   | Type | Scope    | Default | Unit  | Description                                        |
| ------------------------------------- | ---- | -------- | ------- | ----- | -------------------------------------------------- |
| `limits.seat_limit`                   | int  | customer | 10      | count | Max active users across all orgs for this customer |
| `limits.org_limit`                    | int  | customer | 1       | count | Max organizations in this customer                 |
| `limits.ask_ai_monthly`               | int  | customer | 500     | count | Ask AI queries per billing month                   |
| `limits.segment_limit`                | int  | customer | 50      | count | Saved segments                                     |
| `limits.retention_days`               | int  | customer | 365     | days  | How long traffic data is kept                      |
| `limits.api_rpm`                      | int  | customer | 120     | count | API requests per minute                            |
| `limits.export_rows_per_request`      | int  | customer | 50000   | count | Max rows per export                                |
| `limits.concurrent_sessions_per_user` | int  | platform | 3       | count | Better Auth session cap                            |

### 6.2 Modules (domain=`modules`)

| Key                            | Type | Scope    | Default | Description     |
| ------------------------------ | ---- | -------- | ------- | --------------- |
| `modules.city_overview`        | bool | customer | true    | —               |
| `modules.citypulse_ask_ai`     | bool | customer | false   | —               |
| `modules.junction_analytics`   | bool | customer | false   | —               |
| `modules.corridor_diagnostics` | bool | customer | false   | —               |
| `modules.client_admin`         | bool | customer | false   | Phase 2 feature |
| `modules.data_export_api`      | bool | customer | false   | —               |

### 6.3 Alerts (domain=`alerts`)

| Key                                     | Type   | Scope | Default                                                                      | Unit | Description                                    |
| --------------------------------------- | ------ | ----- | ---------------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `alerts.engine_enabled`                 | bool   | org   | true                                                                         | —    | Master kill-switch for this org's alert engine |
| `alerts.eval_interval_seconds`          | int    | org   | 60                                                                           | sec  | How often the evaluator runs                   |
| `alerts.congestion_speed_threshold_kmh` | int    | org   | 15                                                                           | km/h | Speed below which a segment is "congested"     |
| `alerts.slow_speed_threshold_kmh`       | int    | org   | 30                                                                           | km/h | Slow-but-not-congested upper bound             |
| `alerts.min_delay_for_alert_minutes`    | int    | org   | 5                                                                            | min  | Minimum delay to emit an alert                 |
| `alerts.dedup_window_minutes`           | int    | org   | 15                                                                           | min  | Collapse repeat alerts in this window          |
| `alerts.auto_resolve_after_minutes`     | int    | org   | 20                                                                           | min  | Resolve alerts whose condition cleared         |
| `alerts.escalation_ladder`              | json   | org   | `[]`                                                                         | —    | Ordered list of `{after_min, notify_group}`    |
| `alerts.working_hours`                  | json   | org   | `{"tz":"Asia/Kolkata","days":[1,2,3,4,5,6,0],"start":"06:00","end":"22:00"}` | —    | When alerts fire                               |
| `alerts.holiday_calendar_id`            | string | org   | `""`                                                                         | —    | FK to calendar entries                         |

### 6.4 Data source (domain=`data_source`)

| Key                                   | Type   | Scope | Default                                      | Description                                   |
| ------------------------------------- | ------ | ----- | -------------------------------------------- | --------------------------------------------- |
| `data_source.provider`                | enum   | org   | `"here"`                                     | `here`/`tomtom`/`custom`                      |
| `data_source.poll_interval_seconds`   | int    | org   | 60                                           | —                                             |
| `data_source.credentials_ref`         | string | org   | `""`                                         | Secret manager ref, not the credential itself |
| `data_source.bbox`                    | json   | org   | `null`                                       | If null, uses `organization.geo_bounds`       |
| `data_source.road_types_included`     | json   | org   | `["motorway","trunk","primary","secondary"]` | OSM-style tags                                |
| `data_source.sampling_rate`           | float  | org   | 1.0                                          | 0–1; 0.5 = half the segments                  |
| `data_source.failover_provider`       | enum   | org   | `""`                                         | Secondary provider if primary fails           |
| `data_source.stale_threshold_minutes` | int    | org   | 5                                            | After this, pipeline is marked stale          |

### 6.5 Retention (domain=`retention`)

| Key                                  | Type   | Scope    | Default       | Description                                    |
| ------------------------------------ | ------ | -------- | ------------- | ---------------------------------------------- |
| `retention.traffic_observation_days` | int    | customer | 365           | Hard delete after N days                       |
| `retention.traffic_metric_days`      | int    | customer | 730           | Aggregated metrics kept longer                 |
| `retention.analytics_rollup_days`    | int    | customer | 1825          | 5-year rollup window                           |
| `retention.alert_history_days`       | int    | customer | 365           | —                                              |
| `retention.audit_log_days`           | int    | platform | 2555          | 7 years for compliance                         |
| `retention.archive_before_delete`    | bool   | customer | false         | If true, cold-storage before delete            |
| `retention.legal_hold`               | bool   | customer | false         | When true, pruner skips this customer entirely |
| `retention.pruner_cron`              | string | platform | `"0 3 * * *"` | 03:00 daily                                    |

### 6.6 Notifications (domain=`notifications`)

| Key                                     | Type   | Scope    | Default                   | Description                                  |
| --------------------------------------- | ------ | -------- | ------------------------- | -------------------------------------------- |
| `notifications.channels_enabled`        | json   | customer | `["email"]`               | Subset of `["email","sms","push","webhook"]` |
| `notifications.email_from`              | string | customer | `"alerts@trafficure.com"` | —                                            |
| `notifications.sms_sender_id`           | string | customer | `"TRFCRE"`                | —                                            |
| `notifications.webhook_urls`            | json   | org      | `[]`                      | `[{url,secret_ref,events:[...]}]`            |
| `notifications.user_max_email_per_hour` | int    | platform | 20                        | Per-user throttle                            |
| `notifications.digest_enabled`          | bool   | user     | false                     | Per-user: collapse into a daily digest       |
| `notifications.quiet_hours`             | json   | user     | `null`                    | `{start:"22:00",end:"06:00"}`                |

### 6.7 RBAC (domain=`rbac`)

| Key                               | Type | Scope    | Default | Description                                        |
| --------------------------------- | ---- | -------- | ------- | -------------------------------------------------- |
| `rbac.require_2fa_customer_admin` | bool | customer | true    | —                                                  |
| `rbac.require_2fa_org_admin`      | bool | customer | false   | —                                                  |
| `rbac.session_idle_minutes`       | int  | platform | 60      | —                                                  |
| `rbac.invite_expiry_days`         | int  | platform | 14      | —                                                  |
| `rbac.password_min_length`        | int  | platform | 10      | —                                                  |
| `rbac.allow_self_serve_invites`   | bool | customer | false   | Customer Admins can invite without Lepton approval |

### 6.8 Feature flags (domain=`flags`) — see Step 13

| Key                             | Type | Scope    | Default | Description          |
| ------------------------------- | ---- | -------- | ------- | -------------------- |
| `flags.citypulse_v2`            | bool | customer | false   | Gates the v2 rollout |
| `flags.ask_ai_gpt5`             | bool | customer | false   | —                    |
| `flags.new_heatmap_renderer`    | bool | org      | false   | —                    |
| `flags.junction_analytics_beta` | bool | customer | false   | —                    |

### 6.9 UI & locale (domain=`ui`, `locale`)

| Key                       | Type | Scope    | Default       | Description                        |
| ------------------------- | ---- | -------- | ------------- | ---------------------------------- |
| `ui.default_tab_overview` | enum | customer | `"dashboard"` | `dashboard`/`heatmap`/`comparison` |
| `ui.map_default_zoom`     | int  | org      | 13            | —                                  |
| `ui.speed_unit`           | enum | customer | `"kmh"`       | `kmh`/`mph`                        |
| `ui.week_starts_on`       | enum | customer | `"monday"`    | —                                  |
| `locale.default`          | enum | customer | `"en-IN"`     | `en-IN`/`en-US`/`ar-SA`/`hi-IN`    |

### 6.10 Billing (domain=`billing`) — see Step 14

| Key                             | Type  | Scope    | Default         | Description                                    |
| ------------------------------- | ----- | -------- | --------------- | ---------------------------------------------- |
| `billing.plan_template`         | enum  | customer | `"poc_starter"` | `poc_starter`/`city_enterprise`/`partner_demo` |
| `billing.currency`              | enum  | customer | `"USD"`         | —                                              |
| `billing.overage_policy`        | enum  | customer | `"block"`       | `block`/`allow_and_charge`/`warn_only`         |
| `billing.ask_ai_unit_price_usd` | float | platform | 0.06            | —                                              |
| `billing.billing_day_of_month`  | int   | customer | 1               | 1–28                                           |

### 6.11 Ops / security (domain=`ops`, `security`)

| Key                          | Type   | Scope    | Default             | Description         |
| ---------------------------- | ------ | -------- | ------------------- | ------------------- |
| `ops.maintenance_window_utc` | string | platform | `"SUN 18:00-20:00"` | Displayed in banner |
| `ops.read_only_mode`         | bool   | platform | false               | Kill switch         |
| `security.allowed_ip_ranges` | json   | customer | `[]`                | Empty = all         |
| `security.require_sso`       | bool   | customer | false               | WorkOS — Phase 3    |

### 6.12 Branding (domain=`branding`)

| Key                             | Type   | Scope    | Default        | Description          |
| ------------------------------- | ------ | -------- | -------------- | -------------------- |
| `branding.logo_url`             | string | customer | `""`           | —                    |
| `branding.primary_color`        | string | customer | `"#0D3B2E"`    | Hex                  |
| `branding.secondary_color`      | string | customer | `"#1DB954"`    | Hex                  |
| `branding.product_name_display` | string | customer | `"TraffiCure"` | White-label override |

**Total: ~85 seed keys. Every future PR that introduces a new knob must add a row here.**

## 7. Enforcement / Runtime

1. Request enters → middleware resolves `customerId`, `orgId`, `userId` from session.
2. Handler asks `ConfigClient.get('alerts.congestion_speed_threshold_kmh', ctx)` — returns Redis-cached value or resolves through scope chain.
3. On `PUT /admin/config/values`, backend writes to `platform.config_value`, invalidates `cfg:{key}:*` cache keys, and emits audit event.

## 8. Configuration surface

Different screens edit different subsets (see Steps 18–21):

- **Customer Detail → Entitlements tab** → `limits.*`, `modules.*`, `billing.*`
- **Org Detail → City Config tab** → `alerts.*`, `ui.*`, `locale.*`
- **Org Detail → Data Source tab** → `data_source.*`
- **Customer Detail → Retention tab** → `retention.*`
- **System → Feature Flags** → `flags.*`
- **System → Security** → `security.*`, `rbac.*`
- **Customer Detail → Branding** → `branding.*`
- **My Profile → Notifications** → `notifications.digest_enabled`, `notifications.quiet_hours`

## 9. Migration plan

Dev → Staging → Prod. DDL + seed is < 5 seconds. Roll forward by adding rows to `config_key`; never delete — mark `deprecated=true`.

## 10. Acceptance criteria

1. `platform.config_key` contains all seed rows listed above.
2. `platform.resolve_config('alerts.congestion_speed_threshold_kmh', NULL, <pune_org_id>)` returns `15` (default).
3. After `INSERT INTO platform.config_value (key, scope_type, scope_id, value) VALUES ('alerts.congestion_speed_threshold_kmh','org',<pune_org_id>,'20')`, same call returns `20`.
4. Writing an invalid JSON type for a `value_type='int'` key is rejected by application-level validator in `ConfigClient`.
5. Lint rule rejects any TS file with `config.get("some.key")` where `"some.key"` isn't in the registry (enforced via a pre-build script that reads the seed file).
6. Cache invalidation: after `PUT`, a second `get` within 200ms returns the new value.

## 11. Test plan

### Unit

- Resolver walks scope order correctly (user > org > customer > platform > default).
- Value-type validation: int/float/bool/string/enum/json.
- Enum allowed-values enforcement.
- Deprecated key with `replaced_by` logs a warning but still resolves.

### Integration

- Concurrent writes: last-write-wins, both audit events emitted.
- Cache invalidation across 3 app instances via Redis pub-sub.

### Manual

- PM walks every UI surface in Steps 18–21 and confirms the keys it edits match the registry.

## 12. Edge cases & errors

| Case                                                                       | Behavior                                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Key not in registry                                                        | `ConfigClient.get` throws `ConfigKeyNotFoundError`. Emit error log; do not silently default.              |
| `scope_id=NULL` with `scope_type='customer'`                               | Rejected by INSERT CHECK: `CHECK ((scope_type='platform' AND scope_id IS NULL) OR scope_id IS NOT NULL)`. |
| Recursive config (a config that controls config behavior — e.g. cache TTL) | Must have `cache_ttl_sec=0` and a warning note.                                                           |
| Value violates `allowed_values`                                            | Reject at write time; return `422 config_value_out_of_range`.                                             |
| User scope set on a key whose `allowed_scopes` does not include `user`     | Reject at write time.                                                                                     |

## 13. Observability

- Metric: `config_resolve_total{key,scope_hit}` — count by which scope the resolver hit.
- Metric: `config_cache_hit_ratio{key}`.
- Metric: `config_writes_total{key,actor_role}`.
- Log: every write, INFO level, structured.

## 14. Audit events emitted

`platform.audit_log` event (full schema lands in Step 05):

```json
{
  "action": "config.value.updated",
  "category": "config_change",
  "key": "alerts.congestion_speed_threshold_kmh",
  "scope_type": "org",
  "scope_id": "<org-uuid>",
  "old_value": 15,
  "new_value": 20,
  "actor_user_id": "<umang-uuid>",
  "actor_role": "super_admin",
  "at": "2026-04-17T10:12:03Z"
}
```

## 15. Open questions

- Q1. Should `user`-scope configs be editable by the user themselves or only by Lepton/Customer admins? Recommendation: users can edit user-scope configs on their own profile (notifications, digest, quiet hours). Anything else requires admin.
- Q2. Do we need versioning on config_value (full history)? Or is the audit log enough? Recommendation: audit log only in Phase 1; add history table in Phase 2 if needed.
- Q3. Who owns the seed list long-term — PM, eng, or ops? Recommendation: PM owns domain list; eng owns schema of each key; ops owns defaults for prod.
