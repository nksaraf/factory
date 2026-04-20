# Step 01 — Platform Schema & Tenant/Customer Tables

**Phase:** 1A
**Depends on:** —
**Blocks:** 02, 03, 04, and everything downstream
**Owner:** Backend
**Estimated effort:** 3 days

---

## 1. Goal

Create the new `platform` Postgres schema and the core control-plane tables (`tenant`, `customer`) that sit above the existing `enterprise.*` (Better Auth) schema. After this step, the database can represent the four-level hierarchy **Tenant → Customer → Organization → User** even though no application code is using it yet.

## 2. Why now

Every downstream step (entitlements, RBAC, data isolation, admin UI) FK-references `platform.customer` and `platform.tenant`. Nothing can start without these rows existing.

## 3. Scope

### In scope

- Create `platform` schema.
- Create `platform.tenant` and `platform.customer` tables + indexes + FKs.
- Create seed row `platform.tenant(id='lepton-primary', ...)` — the default tenant for all existing orgs.
- Migration that inserts one `platform.customer` row per currently-live city (Pune, Kolkata, Howrah, Barrackpore, Bidhan Nagar, Dehradun) so the foreign keys in Step 02 can attach.
- DB-level constraints + check constraints.

### Out of scope (belongs to other steps)

- Altering `enterprise.organization` to add `customer_id` — Step 02.
- Entitlement rows — Step 04.
- RBAC extensions — Step 05.
- Moving traffic data — Step 08.

## 4. Deliverables

1. Migration file `20260415_001_platform_schema.sql` (forward + rollback).
2. Seed script `seed_initial_customers.sql` with the 6 live cities.
3. Updated `ERD.drawio` committed to the repo.
4. Updated local `docker-compose` DB fixtures.

## 5. Design

### 5.1 Schema

```sql
CREATE SCHEMA IF NOT EXISTS platform;
COMMENT ON SCHEMA platform IS
  'Control plane — tenant, customer, entitlement, usage, audit. Owned by Lepton Admin.';
```

### 5.2 Tables

#### `platform.tenant`

The infrastructure boundary — which physical cluster this customer runs on. Today there is one row (`lepton-primary`). Multi-tenant-on-dedicated-infra is a Phase 3 concern but the column exists now.

```sql
CREATE TABLE platform.tenant (
    id              VARCHAR(64)   PRIMARY KEY,                  -- e.g. 'lepton-primary', 'wgs-riyadh'
    display_name    VARCHAR(200)  NOT NULL,
    hosting_model   VARCHAR(32)   NOT NULL
                    CHECK (hosting_model IN
                          ('lepton_shared','lepton_dedicated','client_hosted')),
    region          VARCHAR(32)   NOT NULL,                     -- 'asia-south1', 'me-central1', etc.
    db_instance_ref VARCHAR(128)  NOT NULL,                     -- logical DB instance identifier
    status          VARCHAR(24)   NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','degraded','draining','archived')),
    metadata        JSONB         NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_region ON platform.tenant(region);
CREATE INDEX idx_tenant_status ON platform.tenant(status);
```

#### `platform.customer`

The contract / billing entity.

```sql
CREATE TABLE platform.customer (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(64)   NOT NULL REFERENCES platform.tenant(id),
    slug            VARCHAR(64)   NOT NULL UNIQUE                -- URL + schema-name source
                    CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
    display_name    VARCHAR(200)  NOT NULL,
    legal_entity    VARCHAR(300),
    customer_type   VARCHAR(24)   NOT NULL
                    CHECK (customer_type IN ('poc','paid','internal','partner_demo')),
    lifecycle_state VARCHAR(24)   NOT NULL DEFAULT 'draft'
                    CHECK (lifecycle_state IN
                          ('draft','provisioning','active','suspended','churned','archived')),
    primary_region  VARCHAR(32)   NOT NULL,                     -- copy-of tenant.region or a sub-region
    db_schema_name  VARCHAR(100)  NOT NULL UNIQUE               -- e.g. 'customer_pune_smart_city'
                    CHECK (db_schema_name ~ '^customer_[a-z0-9_]{1,80}$'),
    contract_start  DATE,
    contract_end    DATE,
    primary_contact_name  VARCHAR(200),
    primary_contact_email VARCHAR(254),
    branding_config JSONB         NOT NULL DEFAULT '{}',         -- logo, colors; schema in Step 03
    billing_config  JSONB         NOT NULL DEFAULT '{}',         -- see Step 14
    suspended_reason TEXT,
    suspended_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,                                        -- FK to enterprise.user added in Step 02
    archived_at     TIMESTAMPTZ,

    CONSTRAINT chk_contract_dates
      CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start)
);
CREATE INDEX idx_customer_tenant  ON platform.customer(tenant_id);
CREATE INDEX idx_customer_type    ON platform.customer(customer_type);
CREATE INDEX idx_customer_state   ON platform.customer(lifecycle_state)
  WHERE lifecycle_state <> 'archived';
CREATE INDEX idx_customer_region  ON platform.customer(primary_region);
```

#### `platform.customer_audit_trail` (thin)

A very thin trail specifically for customer lifecycle transitions. The full audit log lands in Step 05.

```sql
CREATE TABLE platform.customer_audit_trail (
    id            BIGSERIAL PRIMARY KEY,
    customer_id   UUID NOT NULL REFERENCES platform.customer(id) ON DELETE CASCADE,
    from_state    VARCHAR(24),
    to_state      VARCHAR(24) NOT NULL,
    reason        TEXT,
    actor_user_id UUID,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cat_customer ON platform.customer_audit_trail(customer_id, occurred_at DESC);
```

### 5.3 `updated_at` trigger

```sql
CREATE OR REPLACE FUNCTION platform.set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_updated
    BEFORE UPDATE ON platform.tenant
    FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();

CREATE TRIGGER trg_customer_updated
    BEFORE UPDATE ON platform.customer
    FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
```

### 5.4 Seed data

```sql
-- Default tenant
INSERT INTO platform.tenant (id, display_name, hosting_model, region, db_instance_ref, status)
VALUES ('lepton-primary', 'Lepton Primary (asia-south1)', 'lepton_shared',
        'asia-south1', 'trafficure-prod-01', 'active');

-- One customer per currently-live city. During Step 02, enterprise.organization rows
-- are stitched to these via organization.customer_id.
INSERT INTO platform.customer
 (tenant_id, slug, display_name, customer_type, lifecycle_state,
  primary_region, db_schema_name)
VALUES
 ('lepton-primary','pune','Pune Smart City','paid','active','asia-south1','customer_pune'),
 ('lepton-primary','kolkata','Kolkata Traffic Police','paid','active','asia-south1','customer_kolkata'),
 ('lepton-primary','howrah','Howrah City Police','poc','active','asia-south1','customer_howrah'),
 ('lepton-primary','barrackpore','Barrackpore Police','poc','active','asia-south1','customer_barrackpore'),
 ('lepton-primary','bidhan-nagar','Bidhan Nagar Police','poc','active','asia-south1','customer_bidhan_nagar'),
 ('lepton-primary','dehradun','Dehradun Smart City','poc','active','asia-south1','customer_dehradun');
```

### 5.5 Rollback

```sql
DROP TABLE IF EXISTS platform.customer_audit_trail;
DROP TABLE IF EXISTS platform.customer;
DROP TABLE IF EXISTS platform.tenant;
DROP FUNCTION IF EXISTS platform.set_updated_at();
DROP SCHEMA IF EXISTS platform;
```

## 6. Enforcement / Runtime

No application code consumes these tables in Step 01. This step is DDL-only.

## 7. Configuration surface

None yet. Step 18 (Customer CRUD UI) consumes `platform.customer`.

## 8. Migration plan

| Env     | Action                                                                                                                                                                                          | Gate         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Dev     | Run forward migration, seed data. Verify `\dt platform.*`.                                                                                                                                      | Engineer     |
| Staging | Forward migration + seed. Run smoke SELECTs.                                                                                                                                                    | PM sign-off  |
| Prod    | Forward migration during normal business hours (DDL only, ~seconds). Do **not** run seed on prod — prod already has 6 orgs; real customer rows are inserted via the Lepton Admin UI in Step 18. | CTO sign-off |

Rollback window: ≤ 30 minutes after migration if application health degrades.

## 9. Acceptance criteria

1. `platform.tenant` has ≥ 1 row with id = `lepton-primary`.
2. `platform.customer` has 6 rows in dev/staging, 0 or more in prod.
3. `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'platform.customer'::regclass;` returns CHECK constraints for `customer_type`, `lifecycle_state`, `slug`, `db_schema_name`, and `chk_contract_dates`.
4. Inserting a customer with `slug = 'Pune!'` fails.
5. Inserting a customer with `customer_type = 'trial'` fails.
6. Inserting a customer with `contract_end < contract_start` fails.
7. Updating any row bumps `updated_at`.
8. Seed script is idempotent (`INSERT ... ON CONFLICT DO NOTHING` or guarded).

## 10. Test plan

### Unit (SQL)

- `test_customer_slug_regex.sql` — 10 valid, 10 invalid slugs.
- `test_customer_type_check.sql` — every valid + 2 invalid.
- `test_lifecycle_state_transitions.sql` — insertability of each state.
- `test_updated_at_trigger.sql` — `UPDATE ... SET slug = slug` bumps `updated_at`.

### Integration

- Create tenant + 2 customers + delete tenant → expect FK error.
- Create tenant, archive it (status=archived), customers still queryable.

### Manual

- Open `psql`, run `\d+ platform.customer`, verify column comments render.

## 11. Edge cases & errors

| Case                                                        | Expected behavior                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Slug collision across tenants                               | Blocked — slug is globally UNIQUE.                                                                                            |
| Schema name collision                                       | Blocked — `db_schema_name` is UNIQUE.                                                                                         |
| Setting `lifecycle_state='active'` without `contract_start` | Allowed at DB level; enforced at application level in Step 07.                                                                |
| Archiving a tenant that has active customers                | Allowed at DB level; warned in Admin UI in Step 18.                                                                           |
| Deleting a customer                                         | **Disallowed for now.** Only `lifecycle_state='archived'` + `archived_at=now()`. A later step will decide hard-delete policy. |

## 12. Observability

- Metric: `pg_stat_user_tables` — row counts for `platform.tenant`, `platform.customer`. Nothing to alert on yet.
- Log: nothing (DDL step).

## 13. Audit events emitted

This step doesn't emit audit events at the application layer — the audit log itself is Step 05. The `customer_audit_trail` table is created here so Step 07 (state machines) can write to it.

## 14. Open questions (for PM)

- Q1. Should `platform.customer.slug` allow underscores (`pune_smart_city`) or only hyphens (`pune-smart-city`)? Current regex allows both. Recommendation: hyphens only in URLs, underscores allowed in `db_schema_name` only. — _PM decide before migration runs in prod._
- Q2. Should `platform.tenant` rows be manageable from the Lepton Admin UI, or stay infra-only (operator-managed via migrations)? — _Defer to Step 21; for now, infra-only._
- Q3. Soft-delete vs hard-delete policy for customers after `archived_at` + N days? — _Defer; not in Phase 1._
