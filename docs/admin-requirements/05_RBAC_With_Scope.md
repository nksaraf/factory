# Step 05 — RBAC with Scope (Permissions + Role Assignments + Scope Middleware + Audit Log)

**Phase:** 1B
**Depends on:** 02, 04
**Blocks:** 06, 08, 16, 17, 22
**Owner:** Backend
**Estimated effort:** 5 days

---

## 1. Goal

Deliver the authorization layer. After this step, every API call is evaluated against **permissions** (what you can do) bounded by **scope** (where you can do it — which customer, org, or zone), with denials producing a structured 403 and every allow/deny logged to `platform.audit_log`.

Concretely:

- Create `platform.permission`, `platform.role_template`, extend `enterprise.member_organization_role` with `scope_type` + `scope_id`.
- Create `platform.audit_log` (partitioned).
- Ship `@lepton/rbac` package with `can(permission, target)` + `withPermission` middleware + `scopeFilter(query)` ORM helper.
- Seed the ~40 permission atoms and 6 default role templates (Viewer / Analyst / Operator / Org Admin / Customer Admin / Super Admin).

## 2. Why now

Scope middleware is the load-bearing guarantee against cross-customer data leaks. Step 08 (schema isolation) adds a second layer of defense, but the app-level filter must exist first. Permissions also underpin every Lepton Admin screen — nothing in Steps 17+ can check "is this user allowed to edit city_config" without this.

## 3. Scope

### In scope

- Permission catalog table + seed (~40 rows).
- Role template table + seed (6 default templates).
- Extend `enterprise.member_organization_role` → add `scope_type`, `scope_id`, `granted_by`, `granted_at`, `expires_at`.
- `platform.audit_log` table (partitioned monthly).
- `@lepton/rbac` package: `can`, `withPermission`, `scopeFilter`, `getUserScopes`, `assignRole`, `revokeRole`.
- Audit emission hook usable by every other package.

### Out of scope

- UI for role assignment — Step 18/19/21.
- Full exhaustive permission × role matrix — Step 06.
- Staff roles (`platform_role`) enforcement in admin surfaces — Step 17.
- Zone-level RBAC (scope_type='zone') — defined here but not used until Phase 2.

## 4. Deliverables

1. Migration `20260419_001_rbac_schema.sql`.
2. Seed `seed_permissions_and_roles.sql`.
3. `@lepton/rbac` package.
4. `@lepton/audit` package (thin; just writes to `platform.audit_log`).
5. Integration tests covering 20+ allow/deny scenarios.

## 5. Design

### 5.1 Permission catalog

```sql
CREATE TABLE platform.permission (
    key         VARCHAR(128) PRIMARY KEY,          -- e.g. 'alerts.configure'
    module      VARCHAR(64)  NOT NULL,              -- 'alerts','citypulse','admin','billing',...
    action      VARCHAR(32)  NOT NULL,              -- 'view','create','update','delete','configure','acknowledge'
    description TEXT         NOT NULL,
    scope_level VARCHAR(16)  NOT NULL               -- lowest scope at which this permission is meaningful
                CHECK (scope_level IN ('platform','customer','org','zone')),
    deprecated  BOOLEAN      NOT NULL DEFAULT false
);
```

### 5.2 Role template

```sql
CREATE TABLE platform.role_template (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key           VARCHAR(64) UNIQUE NOT NULL,      -- 'viewer','analyst','operator','org_admin','customer_admin','super_admin'
    display_name  VARCHAR(120) NOT NULL,
    description   TEXT,
    permissions   JSONB NOT NULL,                   -- array of permission keys
    default_scope VARCHAR(16) NOT NULL CHECK (default_scope IN ('customer','org','zone')),
    system        BOOLEAN NOT NULL DEFAULT true,    -- system templates cannot be deleted
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.3 Extend `enterprise.member_organization_role`

```sql
ALTER TABLE enterprise.member_organization_role
  ADD COLUMN scope_type  VARCHAR(16) NOT NULL DEFAULT 'org'
             CHECK (scope_type IN ('customer','org','zone')),
  ADD COLUMN scope_id    UUID,                                 -- customer_id / org_id / zone_id
  ADD COLUMN granted_by  UUID REFERENCES enterprise.user(id),
  ADD COLUMN granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN expires_at  TIMESTAMPTZ;

-- Backfill: existing rows become scope_type='org', scope_id=organization_id
UPDATE enterprise.member_organization_role
   SET scope_id = organization_id
 WHERE scope_id IS NULL;

ALTER TABLE enterprise.member_organization_role
  ALTER COLUMN scope_id SET NOT NULL;

CREATE INDEX idx_mor_scope ON enterprise.member_organization_role(scope_type, scope_id);
CREATE INDEX idx_mor_user  ON enterprise.member_organization_role(user_id);
```

### 5.4 `platform.audit_log`

```sql
CREATE TABLE platform.audit_log (
    id              BIGSERIAL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    action          VARCHAR(128) NOT NULL,          -- dotted: 'customer.created','role.assigned','config.value.updated'
    category        VARCHAR(32)  NOT NULL,          -- from config_key.audit_category
    actor_user_id   UUID REFERENCES enterprise.user(id),
    actor_role      VARCHAR(32),                     -- snapshot of role at time of action
    actor_ip        INET,
    actor_user_agent TEXT,
    target_type     VARCHAR(64),                     -- 'customer','org','user','role','config','flag',...
    target_id       VARCHAR(128),
    customer_id     UUID REFERENCES platform.customer(id),
    org_id          UUID REFERENCES enterprise.organization(id),
    before          JSONB,
    after           JSONB,
    request_id      UUID,
    result          VARCHAR(16) NOT NULL DEFAULT 'allow'
                    CHECK (result IN ('allow','deny','error')),
    note            TEXT,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_audit_cust_time   ON platform.audit_log (customer_id, occurred_at DESC);
CREATE INDEX idx_audit_actor_time  ON platform.audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_action_time ON platform.audit_log (action, occurred_at DESC);
```

Partition creator analogous to `ensure_usage_log_partition` from Step 04.

### 5.5 Permission seed (initial ~40 atoms)

```sql
-- alerts
INSERT INTO platform.permission VALUES
 ('alerts.view','alerts','view','View alerts','org',false),
 ('alerts.acknowledge','alerts','update','Acknowledge/dismiss alerts','org',false),
 ('alerts.configure','alerts','update','Edit alert rules','org',false),
 ('alerts.escalate','alerts','update','Escalate a running alert','org',false);

-- dashboard
INSERT INTO platform.permission VALUES
 ('dashboard.view','dashboard','view','View overview dashboard','org',false);

-- analytics
INSERT INTO platform.permission VALUES
 ('analytics.view','analytics','view','View analytics','org',false),
 ('analytics.export','analytics','view','Export analytics','org',false);

-- reports
INSERT INTO platform.permission VALUES
 ('reports.view','reports','view','View reports','org',false),
 ('reports.create','reports','create','Create a report','org',false),
 ('reports.schedule','reports','update','Schedule recurring reports','org',false),
 ('reports.delete','reports','delete','Delete a report','org',false);

-- citypulse / ask ai
INSERT INTO platform.permission VALUES
 ('citypulse.view','citypulse','view','Use CityPulse','org',false),
 ('ask_ai.query','ask_ai','create','Submit an Ask AI query','org',false);

-- members
INSERT INTO platform.permission VALUES
 ('members.view','members','view','View members of an org','org',false),
 ('members.invite','members','create','Invite a member','org',false),
 ('members.remove','members','delete','Remove a member','org',false),
 ('roles.assign','roles','update','Assign a role to a member','org',false);

-- orgs (within a customer)
INSERT INTO platform.permission VALUES
 ('orgs.view','orgs','view','View orgs in this customer','customer',false),
 ('orgs.create','orgs','create','Create an org','customer',false),
 ('orgs.update','orgs','update','Update org profile','org',false),
 ('orgs.archive','orgs','update','Archive an org','org',false),
 ('orgs.city_config.edit','orgs','update','Edit city_config','org',false),
 ('orgs.data_source.edit','orgs','update','Edit data_source_config','org',false);

-- billing / entitlements
INSERT INTO platform.permission VALUES
 ('billing.view','billing','view','View billing + usage','customer',false),
 ('entitlements.view','entitlements','view','View current entitlements','customer',false);

-- branding
INSERT INTO platform.permission VALUES
 ('branding.edit','branding','update','Edit branding','customer',false);

-- incidents
INSERT INTO platform.permission VALUES
 ('incidents.view','incidents','view','View incidents','org',false),
 ('incidents.manage','incidents','update','Manage incident lifecycle','org',false);

-- mobile
INSERT INTO platform.permission VALUES
 ('mobile.notifications','mobile','update','Receive push notifications','org',false);

-- admin (Lepton-internal)
INSERT INTO platform.permission VALUES
 ('admin.customers.manage','admin','update','CRUD on customers','platform',false),
 ('admin.orgs.manage','admin','update','CRUD on orgs across customers','platform',false),
 ('admin.users.manage','admin','update','CRUD on users across customers','platform',false),
 ('admin.entitlements.manage','admin','update','Edit any customer entitlement','platform',false),
 ('admin.flags.manage','admin','update','Edit feature flags','platform',false),
 ('admin.audit.view','admin','view','View cross-customer audit log','platform',false),
 ('admin.config.edit','admin','update','Edit platform-scope config values','platform',false),
 ('admin.impersonate','admin','update','Impersonate a customer user','platform',false);
```

### 5.6 Role template seed

```sql
INSERT INTO platform.role_template (key, display_name, description, default_scope, permissions) VALUES
 ('viewer', 'Viewer', 'Read-only across one org', 'org', '[
   "dashboard.view","alerts.view","analytics.view","reports.view",
   "incidents.view","members.view","citypulse.view"
 ]'),
 ('analyst', 'Analyst', 'Viewer + deeper data + exports', 'org', '[
   "dashboard.view","alerts.view","alerts.acknowledge",
   "analytics.view","analytics.export","reports.view","reports.create","reports.schedule",
   "incidents.view","members.view","citypulse.view","ask_ai.query"
 ]'),
 ('operator', 'Operator / Control Room', 'Analyst + incident + alert actions', 'org', '[
   "dashboard.view","alerts.view","alerts.acknowledge","alerts.escalate",
   "analytics.view","reports.view","reports.create",
   "incidents.view","incidents.manage","members.view",
   "mobile.notifications","citypulse.view","ask_ai.query"
 ]'),
 ('org_admin', 'Org Admin', 'Manages one city end-to-end', 'org', '[
   "dashboard.view","alerts.view","alerts.acknowledge","alerts.configure","alerts.escalate",
   "analytics.view","analytics.export","reports.view","reports.create","reports.schedule","reports.delete",
   "incidents.view","incidents.manage",
   "members.view","members.invite","members.remove","roles.assign",
   "orgs.update","orgs.city_config.edit","orgs.data_source.edit",
   "citypulse.view","ask_ai.query"
 ]'),
 ('customer_admin', 'Customer Admin', 'Top-level admin across all orgs in a customer', 'customer', '[
   "dashboard.view","alerts.view","alerts.acknowledge","alerts.configure","alerts.escalate",
   "analytics.view","analytics.export","reports.view","reports.create","reports.schedule","reports.delete",
   "incidents.view","incidents.manage",
   "members.view","members.invite","members.remove","roles.assign",
   "orgs.view","orgs.create","orgs.update","orgs.archive","orgs.city_config.edit","orgs.data_source.edit",
   "billing.view","entitlements.view","branding.edit",
   "citypulse.view","ask_ai.query"
 ]'),
 ('super_admin', 'Super Admin (Lepton staff)', 'Lepton internal — can do anything', 'customer', '[
   "admin.customers.manage","admin.orgs.manage","admin.users.manage",
   "admin.entitlements.manage","admin.flags.manage","admin.audit.view",
   "admin.config.edit","admin.impersonate"
 ]');
```

### 5.7 RBAC package API

```ts
// @lepton/rbac
export interface Subject {
  userId: string
  platformRole: "user" | "support_readonly" | "ops_admin" | "super_admin"
  memberships: Array<{
    permissions: string[] // flattened from role templates + direct grants
    scopeType: "customer" | "org" | "zone"
    scopeId: string
  }>
}

export interface Target {
  customerId?: string
  orgId?: string
  zoneId?: string
}

export function can(subject: Subject, perm: string, target: Target): boolean {
  // 1. platform roles short-circuit
  if (perm.startsWith("admin.")) {
    return (
      subject.platformRole === "super_admin" ||
      (subject.platformRole === "ops_admin" && perm !== "admin.config.edit")
    )
  }
  // 2. walk memberships, find one whose scope covers target
  return subject.memberships.some(
    (m) => m.permissions.includes(perm) && scopeCovers(m, target)
  )
}

function scopeCovers(m, t) {
  if (m.scopeType === "customer") return t.customerId === m.scopeId
  if (m.scopeType === "org") return t.orgId === m.scopeId
  if (m.scopeType === "zone") return t.zoneId === m.scopeId
  return false
}

export function withPermission(perm: string, targetOf: (req) => Target) {
  return async (req, res, next) => {
    const target = targetOf(req)
    const allowed = can(req.subject, perm, target)
    await audit.write({
      action: allowed ? `${perm}.allow` : `${perm}.deny`,
      category: "rbac_check",
      actor_user_id: req.subject.userId,
      target_type: perm.split(".")[0],
      customer_id: target.customerId,
      org_id: target.orgId,
      result: allowed ? "allow" : "deny",
      request_id: req.id,
    })
    if (!allowed) return next(new PermissionDenied(perm))
    next()
  }
}

export function scopeFilter(subject: Subject): {
  customerIds: string[]
  orgIds: string[]
} {
  const custs = subject.memberships
    .filter((m) => m.scopeType === "customer")
    .map((m) => m.scopeId)
  const orgs = subject.memberships
    .filter((m) => m.scopeType === "org")
    .map((m) => m.scopeId)
  // Customer-scope membership implies access to all orgs under it — resolved at query time
  return { customerIds: custs, orgIds: orgs }
}
```

### 5.8 Scope middleware

```ts
// Every router downstream of this sees `req.subject` and `req.scope`.
app.use(async (req, res, next) => {
  const session = await auth.getSession(req)
  req.subject = await rbac.loadSubject(session.userId)
  req.scope = rbac.scopeFilter(req.subject)
  next()
})
```

And the ORM helper:

```ts
// Every query against an org-scoped table must pass through this.
export function applyScope<T>(query: QB<T>, subject: Subject): QB<T> {
  const { customerIds, orgIds } = scopeFilter(subject)
  return query.where((builder) => {
    builder.whereIn("organization_id", orgIds)
    if (customerIds.length) {
      builder.orWhere((qb) => qb.whereIn("customer_id", customerIds))
    }
  })
}
```

## 6. Enforcement / Runtime

- Every HTTP route attaches `withPermission(...)`.
- Every data read goes through `applyScope`. Lint rule: raw `knex('traffic_metric')` usage without `.applyScope(...)` fails CI.

## 7. Configuration surface

- Role templates editable only by super_admin (Step 21).
- Role assignment happens in Customer Detail → Users (Step 18) and Org Detail → Members (Step 19).
- Permission catalog is seed-managed; only migrations add new permissions.

## 8. Migration plan

1. Deploy DDL + seed in dev → staging → prod.
2. Backfill `member_organization_role.scope_id` (SQL in 5.3).
3. Deploy `@lepton/rbac` package with `withPermission` as a **no-op logging mode** initially (flag `flags.rbac_enforcement=false`).
4. Let it run 48h in prod, watching `result='deny'` rows that weren't actually denied — fix false negatives.
5. Flip `flags.rbac_enforcement=true`.

## 9. Acceptance criteria

1. Permission catalog has ≥ 40 rows.
2. Role templates has all 6 rows listed.
3. A user with `customer_admin` scope_type='customer' can access any org under that customer in queries run through `applyScope`.
4. A user with `org_admin` scope_type='org' cannot see other orgs' data.
5. `withPermission('orgs.city_config.edit', ...)` on Pune rejects a user whose only membership is Org Admin of Kolkata.
6. Audit log contains an `allow` row for every successful permission check and a `deny` row for every denial.
7. Flipping `flags.rbac_enforcement` to `false` turns denials into warnings without breaking downstream handlers (fail-open for emergency).

## 10. Test plan

### Unit

- `can()` truth table for every (subject, perm, target) combo that exercises a template.
- `scopeCovers()` edge cases: undefined target IDs, zone without org.
- `applyScope()` produces correct SQL for each of the 4 member types.

### Integration

- Simulate 3 users of different roles hitting 15 endpoints × 2 orgs — expect 90 results matching a truth table.
- Confirm audit log has one row per check.

### Manual

- Sign in as Umang, attempt to access each admin endpoint; confirm allow.
- Sign in as a test Org Admin for Pune, attempt cross-org access; confirm deny.

## 11. Edge cases & errors

| Case                                                                                    | Behavior                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User has a membership that lost its role_template (deleted)                             | Treat as zero permissions; log ERROR.                                                                                                                         |
| User has two conflicting memberships in the same scope (e.g. Viewer + Operator on Pune) | Union of permissions.                                                                                                                                         |
| Membership with `expires_at < now()`                                                    | Ignored. A cron also marks it `revoked_at` for audit.                                                                                                         |
| Scope middleware runs for an unauthenticated request                                    | `req.subject = anonymous`; downstream routes without `withPermission` 401 at auth, not here.                                                                  |
| User with platform_role=super_admin but zero memberships                                | Can pass all `admin.*` checks; other product endpoints still require scope membership (super admins use impersonation to act as a customer user, not direct). |

## 12. Observability

- Metric: `rbac_checks_total{perm,result}`.
- Metric: `rbac_denials_total{perm,customer_id}` — alert on spikes.
- Log: every deny at INFO with subject+target.
- Trace: span `rbac.check` inside `withPermission`.

## 13. Audit events emitted

Every permission check emits. Also:

- `role.assigned` — when assignRole is called
- `role.revoked` — when revokeRole is called
- `role_template.updated` — super_admin only
- `permission.added` — catalog change via migration (one-shot)

## 14. Open questions

- Q1. Do we want negative grants ("deny X even if role allows")? Recommendation: not in Phase 1. Overrides live at role_template level.
- Q2. Should `support_readonly` (platform role) have a specific permission set or use impersonation? Recommendation: use impersonation only — simpler audit story.
- Q3. Is there ever a legitimate cross-customer permission for a non-super_admin? Recommendation: no. If a customer has multiple customers in their corporate hierarchy, they get multiple memberships.
