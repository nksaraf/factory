# Step 13 — Feature Flag System

**Phase:** 2A
**Depends on:** 03, 05
**Blocks:** 17, 22
**Owner:** Backend
**Estimated effort:** 3 days

---

## 1. Goal

A boolean / multivariant flag service that lets Lepton Super Admin turn features on/off per customer, per org, per user, or globally, without deploys. Used to gate migrations (e.g. `flags.alert_engine_v2`), gradual rollouts (e.g. new dashboard to 10% of orgs), and dark features.

## 2. Why now

Steps 08, 09, 10, 11 all reference `flags.*` for cutover. Without a real flag system they're just env vars; we need targeted rollouts and instant kill-switches.

## 3. Scope

### In scope

- `platform.feature_flag` definition table.
- `platform.feature_flag_rule` targeting table (scope, percentage, allow/deny list).
- Flag evaluation API: `flags.eval(key, subject)` → boolean/variant.
- Client SDK (server-side): `FlagClient` with 30s in-memory cache + pub-sub invalidation.
- Admin endpoints for CRUD + targeting.
- Bulk eval for frontend bootstrap (`GET /me/flags`).

### Out of scope

- A/B experimentation analytics (we're flagging, not measuring) — Phase 2.
- Client SDKs for mobile — Phase 2.
- Time-based schedules — Phase 2 (workaround: flip manually).

## 4. Deliverables

1. Tables + seed of ~15 current flags.
2. `@lepton/flags` package.
3. REST endpoints (Step 16).
4. Lepton Admin → Flags screen (Step 21).

## 5. Design

### 5.1 Tables

```sql
CREATE TABLE platform.feature_flag (
  key           VARCHAR(120) PRIMARY KEY,
  description   TEXT NOT NULL,
  kind          VARCHAR(16) NOT NULL CHECK (kind IN ('boolean','multivariant')),
  variants      JSONB,                       -- for multivariant: {"control":..,"treatment":..}
  default_value JSONB NOT NULL,
  owner         VARCHAR(120),                -- team/person
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE platform.feature_flag_rule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key      VARCHAR(120) NOT NULL REFERENCES platform.feature_flag(key),
  priority      INT NOT NULL,                -- lower = earlier
  match         JSONB NOT NULL,              -- see §5.2
  value         JSONB NOT NULL,
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flag_key, priority)
);
CREATE INDEX idx_flag_rule_key ON platform.feature_flag_rule(flag_key, priority);
```

### 5.2 `match` grammar

```json
{
  "all": [
    { "customerId": { "in": ["cust_pune", "cust_kolkata"] } },
    { "platformRole": { "neq": "super_admin" } },
    { "percentage": { "salt": "flag:new_dashboard", "lt": 10 } }
  ]
}
```

Operators: `eq`, `neq`, `in`, `nin`, `exists`, `gt`, `lt`, `percentage`. Composables: `all`, `any`, `not`.

`percentage`: deterministic `hash(salt + subject.userId) % 100 < N`. Same user always gets same bucket for a given salt.

### 5.3 Evaluation

```ts
function evalFlag(key, subject): Value {
  const flag = cache.get(key) ?? default;
  const rules = cache.getRules(key);           // sorted by priority asc
  for (const r of rules) {
    if (matches(r.match, subject)) return r.value;
  }
  return flag.default_value;
}
```

Subject shape (constructed once per request from `/me`):

```ts
{
  userId, customerId, orgId?, platformRole,
  roleKeys: string[],            // flattened from memberships
  country, city, locale,
  tenantId, deviceKind,
}
```

### 5.4 Cache invalidation

On any write to `feature_flag` or `feature_flag_rule`, publish Redis event `flags:updated:{key}`. Each server subscribes; drops cache entry. TTL fallback 60s.

### 5.5 Frontend bootstrap

`GET /me/flags` returns `{ [key]: value }` for flags relevant to the subject. Frontend uses it for the session; reloads on route change OR after receiving `flags-updated` SSE.

## 6. Enforcement / Runtime

- Every feature gate code uses `FlagClient.isOn(key, subject)`; no direct DB reads (CI lint).
- Flag keys documented in a single source `docs/flags.md` (auto-generated from DB).
- Super Admin only (role: `admin.flags.manage`).

## 7. Configuration surface

- Lepton Admin → Flags (Step 21): list, toggle, edit rules, view evaluation playground ("what would user X in org Y get?").

Flag keys currently expected:

- `flags.alert_engine_v2`
- `flags.notify_engine_v2`
- `flags.customer_schema_migration`
- `flags.new_global_dashboard`
- `flags.ask_ai_beta_models`
- `flags.mobile_push_v2`
- `flags.retention_dry_run`
- `flags.webhook_delivery`
- `flags.city_config_v2_editor`
- `flags.impersonation_banner`
- `flags.audit_log_export`
- `flags.billing_past_due_ui`
- `flags.partner_demo_self_serve`
- `flags.entitlement_soft_cap_warnings`
- `flags.rbac_custom_roles` (off — Phase 2)

## 8. Migration plan

1. Ship tables + SDK.
2. Seed the 15 flags above, each defaulting to their current prod behavior.
3. Replace existing env-var checks with `FlagClient.isOn()` one PR at a time.
4. Delete env vars after all references migrated.

## 9. Acceptance criteria

1. A boolean flag defaults to its `default_value` when no rules match.
2. A rule with `percentage.lt=10` returns true for ~10% of distinct users, stable per user.
3. Flipping a flag takes effect within 5s on all servers via pub-sub.
4. Super Admin is the only role that can create/edit/delete flag rules.
5. `/me/flags` response <10 KB; p95 latency <20 ms.
6. Every rule write produces an audit event with before/after diff.

## 10. Test plan

### Unit

- `matches()` truth table across all operators.
- Percentage hash stability across process restarts.
- Rule priority ordering.

### Integration

- Flip a flag via admin API, assert every running eval sees new value within 5s.
- User in multiple orgs: `orgId` bound by active org header.

## 11. Edge cases

| Case                                            | Behavior                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Flag key not found                              | `isOn` returns false; metric `flag_missing_total{key}`++; log WARN.      |
| Subject missing `customerId` (e.g. super_admin) | Rules referencing customerId treated as `not matched`; default returned. |
| Percentage + another rule with higher priority  | Higher-priority wins; percentage is just a filter at its own priority.   |
| Flag archived                                   | Rules ignored; always returns default; eventually deleted by retention.  |

## 12. Observability

- `flag_eval_total{key,result}`.
- `flag_cache_hit_ratio`.
- `flag_missing_total{key}`.

## 13. Audit events

- `flag.created / updated / archived / rule_added / rule_removed / rule_updated`.

## 14. Open questions

- Q1. Should `percentage` be org-based instead of user-based? Recommendation: support both via `salt_field` ("userId" | "orgId").
- Q2. Schedule flag flips? Recommendation: defer; Lepton Admin's one-click flip is fine for now.
