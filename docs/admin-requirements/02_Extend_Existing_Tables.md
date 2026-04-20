# Step 02 — Extend `enterprise.organization` and `enterprise.user`

**Phase:** 1A
**Depends on:** 01
**Blocks:** 04, 05, 08, 16
**Owner:** Backend
**Estimated effort:** 2 days

---

## 1. Goal

Stitch the existing Better Auth `enterprise.*` tables into the new platform hierarchy by adding `customer_id`, `org_type`, `city_config`, `data_source_config`, `timezone`, `country`, and a user-level `platform_role` column. Backfill all existing rows. After this step, every organization can be traced to a customer, and every user has a platform-level role.

## 2. Why now

Before Step 04 (entitlements) and Step 05 (RBAC with scope) can work, the ownership chain **user → organization → customer** must exist on every row. This is also the moment to isolate the "Personal Organization" artifacts (32 spurious orgs in prod) from real city orgs.

## 3. Scope

### In scope

- `ALTER TABLE enterprise.organization` — add `customer_id`, `org_type`, `timezone`, `country`, `city_config`, `data_source_config`, `geo_center`, `geo_bounds`.
- `ALTER TABLE enterprise.user` — add `platform_role`, `locale`, `mobile_number_verified_at`, `last_activity_at`.
- Backfill: map every real city org to its `platform.customer` seed row; mark the 32 "Personal Organization" rows as `org_type='personal'`.
- Default every existing user to `platform_role='user'`.
- Promote Umang's user to `platform_role='super_admin'`.
- Add `platform.customer.created_by` FK now that `enterprise.user` is finalized.

### Out of scope

- Changes to `enterprise.member_organization_role` — Step 05.
- Traffic data ownership columns — Step 08.
- Any new tables — Step 01 delivered those.

## 4. Deliverables

1. Migration `20260416_001_extend_enterprise.sql` (forward + rollback).
2. Backfill script `backfill_org_customer_mapping.sql` — explicit mapping of the 6 real orgs to the 6 seeded customers; `org_type='personal'` for the 32 spurious ones.
3. Data quality report `post_migration_audit.sql` — counts that must match: `SELECT org_type, count(*) FROM enterprise.organization GROUP BY 1;` expected `{city: 6, personal: 32}`.
4. Documented super-admin promotion SQL (committed but gated behind PM sign-off to run).

## 5. Design

### 5.1 `enterprise.organization` alterations

```sql
ALTER TABLE enterprise.organization
  ADD COLUMN customer_id        UUID REFERENCES platform.customer(id),
  ADD COLUMN org_type           VARCHAR(24) NOT NULL DEFAULT 'personal'
             CHECK (org_type IN ('city','region','highway','partner_demo','personal')),
  ADD COLUMN timezone           VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN country            VARCHAR(2)  NOT NULL DEFAULT 'IN',
  ADD COLUMN city_config        JSONB       NOT NULL DEFAULT '{}',
  ADD COLUMN data_source_config JSONB       NOT NULL DEFAULT '{}',
  ADD COLUMN geo_center         GEOGRAPHY(POINT, 4326),
  ADD COLUMN geo_bounds         GEOGRAPHY(POLYGON, 4326),
  ADD COLUMN provisioning_state VARCHAR(24) NOT NULL DEFAULT 'active'
             CHECK (provisioning_state IN
                    ('draft','provisioning','active','suspended','archived'));

CREATE INDEX idx_org_customer ON enterprise.organization(customer_id);
CREATE INDEX idx_org_type     ON enterprise.organization(org_type) WHERE org_type <> 'personal';
CREATE INDEX idx_org_state    ON enterprise.organization(provisioning_state) WHERE provisioning_state <> 'archived';
```

Rationale for each column — _engineers should not add more columns here without a Config Registry entry (Step 03)_:

| Column                      | Why                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `customer_id`               | Links org to its billing parent. Mandatory for every org after backfill; nullable during backfill window only.               |
| `org_type`                  | Separates real city orgs from Better Auth's default "Personal Organization" rows. Also distinguishes partner demo sandboxes. |
| `timezone`                  | Used by alert rules (Step 10), retention jobs (Step 12), and time-bucketed analytics.                                        |
| `country`                   | Needed for regional data residency (Phase 3) and country-specific data source defaults.                                      |
| `city_config`               | The **configurability forcing function** — every per-city knob lives here. Schema in Step 03.                                |
| `data_source_config`        | HERE / TomTom / Custom config. Schema in Step 09.                                                                            |
| `geo_center` / `geo_bounds` | Default map extent + membership test for observations.                                                                       |
| `provisioning_state`        | Separate from Customer state — an org can be mid-provisioning while its Customer is already active.                          |

### 5.2 `enterprise.user` alterations

```sql
ALTER TABLE enterprise.user
  ADD COLUMN platform_role VARCHAR(24) NOT NULL DEFAULT 'user'
             CHECK (platform_role IN ('user','support_readonly','ops_admin','super_admin')),
  ADD COLUMN locale        VARCHAR(10) NOT NULL DEFAULT 'en-IN',
  ADD COLUMN mobile_number_verified_at TIMESTAMPTZ,
  ADD COLUMN last_activity_at          TIMESTAMPTZ;

CREATE INDEX idx_user_platform_role ON enterprise.user(platform_role) WHERE platform_role <> 'user';
CREATE INDEX idx_user_last_activity ON enterprise.user(last_activity_at);
```

- `platform_role` = **Lepton staff role**, NOT a customer-facing role. Customer-facing roles are in `enterprise.member_organization_role` (Step 05).
- `support_readonly` = read-only Lepton staff who can view customer data for debugging.
- `ops_admin` = day-to-day Lepton ops team — full CRUD on customers/orgs/users.
- `super_admin` = Umang-tier — can also edit config registry, permission catalog, feature flags.

### 5.3 Late-binding FK on `platform.customer.created_by`

```sql
ALTER TABLE platform.customer
  ADD CONSTRAINT fk_customer_created_by
  FOREIGN KEY (created_by) REFERENCES enterprise.user(id);
```

### 5.4 Backfill

```sql
-- Real city orgs → customers (explicit mapping; do not guess)
UPDATE enterprise.organization o
   SET customer_id = c.id,
       org_type    = 'city',
       provisioning_state = 'active'
  FROM platform.customer c
 WHERE LOWER(o.name) = c.slug
   AND o.name IN ('pune','kolkata','howrah','barrackpore','bidhan-nagar','dehradun');

-- Everything else is a Better Auth 'Personal Organization' artifact
UPDATE enterprise.organization
   SET org_type = 'personal'
 WHERE customer_id IS NULL;

-- Promote Umang
UPDATE enterprise.user
   SET platform_role = 'super_admin'
 WHERE email = 'umangsaraf98@gmail.com';
```

Backfill must complete before the NOT-NULL constraint below is added:

```sql
-- After verification, in a second migration, enforce NOT NULL on real orgs:
ALTER TABLE enterprise.organization
  ADD CONSTRAINT chk_org_customer_required
  CHECK (org_type = 'personal' OR customer_id IS NOT NULL);
```

### 5.5 Rollback

Reverse ALTERs in the inverse order. Backfill is non-destructive (only sets columns on rows where they are NULL/default), so rolling back just drops the columns.

## 6. Enforcement / Runtime

- No application code reads these columns yet. Step 05 (scope middleware) is the first reader.
- `provisioning_state` is the single source of truth for "should this org be accessible to its users?" after Step 22.

## 7. Configuration surface

- `city_config` — edited via Lepton Admin → Org Detail → Config tab (Step 19).
- `data_source_config` — edited via Lepton Admin → Org Detail → Data Source tab (Step 19) + Step 09 framework.
- `platform_role` — edited via Lepton Admin → System → Staff (Step 21).

## 8. Migration plan

| Env     | Action                                                                                                                                                                                                 | Rollback gate |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Dev     | Run forward migration + backfill. Verify counts.                                                                                                                                                       | —             |
| Staging | Forward + backfill. Spot-check every city org has a `customer_id`.                                                                                                                                     | —             |
| Prod    | **Run during low-traffic window** (DDL is fast but `ADD CONSTRAINT ... CHECK` on large tables can lock). For `enterprise.organization` (38 rows) and `enterprise.user` (<500 rows) this is sub-second. | CTO sign-off  |

Post-migration verification query (must return 0):

```sql
SELECT count(*) FROM enterprise.organization
 WHERE org_type = 'city' AND customer_id IS NULL;
```

## 9. Acceptance criteria

1. Every existing `enterprise.organization` has a non-null `org_type`.
2. The 6 known city orgs have `org_type='city'` AND non-null `customer_id` pointing at the correct seeded customer.
3. All other existing orgs have `org_type='personal'`.
4. Every existing `enterprise.user` has `platform_role='user'` except Umang, who has `platform_role='super_admin'`.
5. Attempting to insert an org with `org_type='region'` and `customer_id=NULL` is rejected (after the NOT-NULL constraint migration lands).
6. Attempting to insert a user with `platform_role='owner'` is rejected.
7. `platform.customer.created_by` FK resolves.
8. No existing query in the product regresses — check `SELECT * FROM enterprise.organization LIMIT 1;` succeeds from the app.

## 10. Test plan

### Unit

- `test_org_type_check.sql` — every enum value + 2 invalid values.
- `test_user_platform_role_check.sql` — every enum value + 2 invalid values.
- `test_city_config_default.sql` — new row has `city_config = '{}'::jsonb`.

### Integration

- Insert an org with valid `customer_id`, update state to `'archived'`, confirm index `idx_org_state` excludes it.
- Delete a customer that owns an org — expect FK error (ON DELETE default = NO ACTION).

### Manual

- From a fresh app boot, confirm login still works end-to-end (no regression in Better Auth code paths).

## 11. Edge cases & errors

| Case                                                            | Expected behavior                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Org exists in prod with a name that doesn't match any seed slug | Backfill leaves `customer_id=NULL` and marks it `org_type='personal'`. Surfaced in post-migration report. |
| User record has no email (Better Auth edge case)                | `platform_role` defaults to `'user'`. Super-admin promotion update is guarded by email.                   |
| Concurrent writes during migration                              | Not expected at prod size. For larger tables later, add `NOT VALID` → `VALIDATE CONSTRAINT` pattern.      |
| Backfill partially fails                                        | Migration is wrapped in a transaction; failure rolls the whole thing back.                                |

## 12. Observability

- After deploy, log `org_type` distribution once via a scheduled job — any org that transitions to `org_type='city'` without a `customer_id` is a bug.
- Metric: `platform_orgs_missing_customer{env="prod"}` — alert on > 0.

## 13. Audit events emitted

Not applicable in Step 02 (audit system lands in Step 05). However, the super-admin promotion is logged via a simple `pg_write` notice that ops keeps in the migration run log.

## 14. Open questions

- Q1. `locale` default is `en-IN`. Is that correct for Riyadh demos or do we need `ar-SA` there? — Recommendation: default stays `en-IN`, per-customer override lives in `customer.branding_config.locale` (Step 03).
- Q2. Should we immediately hard-purge the 32 "Personal Organization" rows or leave them marked `personal` and invisible? — Recommendation: leave them. Better Auth may still reference them as fallback org for orphaned users.
- Q3. `platform_role='support_readonly'` — who is this for in Q2 2026? Currently no one. Keep the enum value but don't grant it yet.
