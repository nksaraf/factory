# Step 07 — State Machines (Customer / Org / Invite / Partner Demo)

**Phase:** 1B
**Depends on:** 02, 05
**Blocks:** 08, 16, 18
**Owner:** Backend
**Estimated effort:** 2 days

---

## 1. Goal

Codify the allowed lifecycle transitions for every long-lived entity in the system. After this step, no code path can mutate `lifecycle_state` directly — all transitions flow through typed transition functions that validate the source state, check permissions, emit the audit event, and run side effects (e.g. pausing ingestion on suspend).

## 2. Why now

Raw state columns were added in Steps 01 and 02. Without a machine around them, any endpoint can mutate them, and edge cases (reactivating an archived customer, reviving an expired POC, forcing a stuck provisioning back to draft) will appear as one-off SQL scripts in `#ops-emergency`. That's exactly the state we're trying to escape.

## 3. Scope

### In scope

- Customer lifecycle FSM.
- Organization provisioning FSM.
- Invite lifecycle FSM (new — table created here).
- Partner demo lifecycle FSM (new — table created here).
- User status (activation / deactivation / lockout) FSM.
- `@lepton/state-machine` package with a small generic FSM runner + 5 concrete machines.

### Out of scope

- Alert lifecycle — Step 10.
- Data source health states — Step 09.
- Billing states (trial, past_due, suspended, churned) — Step 14.

## 4. Deliverables

1. Migration `20260420_001_invite_and_demo_tables.sql` — adds `platform.invite`, `platform.partner_demo`, `enterprise.user_status` column.
2. `@lepton/state-machine/` package.
3. 5 concrete machine modules with transition functions and side-effect hooks.
4. Integration tests covering every legal transition + every illegal one.

## 5. Design

### 5.1 Customer FSM

States: `draft` → `provisioning` → `active` → (`suspended` ↔ `active`) → `churned` → `archived`.

```
             ┌─────────┐   activate()    ┌──────────────┐  provisioning_complete  ┌────────┐
 create() ──▶│  draft  │ ───────────────▶│ provisioning │ ──────────────────────▶ │ active │
             └────┬────┘                 └──────┬───────┘                         └───┬─┬──┘
                  │ discard()                   │ abort()                 suspend()   │ │
                  ▼                             ▼                                     │ │
             ┌─────────┐                   ┌─────────┐                         ┌─────────┐
             │archived │                   │archived │                         │suspended│
             └─────────┘                   └─────────┘                         └────┬────┘
                                                                      reactivate()  │
                                                                                    │
                                                                ◀───────────────────┘
 churn() from active or suspended ──▶ churned ──archive()──▶ archived
```

| From               | Event                 | To           | Required permission    | Side effects                                                 |
| ------------------ | --------------------- | ------------ | ---------------------- | ------------------------------------------------------------ |
| draft              | activate              | provisioning | admin.customers.manage | kick off schema + ingestion provisioning job                 |
| provisioning       | provisioning_complete | active       | system                 | send welcome email to primary_contact                        |
| provisioning       | abort                 | archived     | admin.customers.manage | roll back schema creation                                    |
| active             | suspend               | suspended    | admin.customers.manage | revoke sessions, pause ingestion, disable UI login for users |
| suspended          | reactivate            | active       | admin.customers.manage | resume ingestion                                             |
| active / suspended | churn                 | churned      | admin.customers.manage | freeze config, mark all users inactive                       |
| churned            | archive               | archived     | admin.customers.manage | drop schema after `retention.post_churn_days` grace          |
| draft              | discard               | archived     | admin.customers.manage | nothing                                                      |

No transitions backwards from archived. Ever.

### 5.2 Organization FSM

States: `draft` → `provisioning` → `active` → (`suspended` ↔ `active`) → `archived`.

Identical shape to Customer but scoped to one org. Independent because an org can be suspended while its parent customer is active (e.g. data source broken for one city).

| From               | Event                 | To           | Permission                          | Side effects                                  |
| ------------------ | --------------------- | ------------ | ----------------------------------- | --------------------------------------------- |
| draft              | activate              | provisioning | customer_admin OR admin.orgs.manage | run `city_config` defaults, spin up ingestion |
| provisioning       | provisioning_complete | active       | system                              | none                                          |
| provisioning       | abort                 | archived     | admin.orgs.manage                   | rollback                                      |
| active             | suspend               | suspended    | customer_admin OR admin.orgs.manage | pause ingestion, 503 product for this org     |
| suspended          | reactivate            | active       | same                                | resume                                        |
| active / suspended | archive               | archived     | customer_admin OR admin.orgs.manage | after grace, drop per-org ingestion config    |

### 5.3 Invite FSM (new)

```sql
CREATE TABLE platform.invite (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES platform.customer(id),
  org_id        UUID REFERENCES enterprise.organization(id),
  email         VARCHAR(254) NOT NULL,
  role_template VARCHAR(64) NOT NULL REFERENCES platform.role_template(key),
  scope_type    VARCHAR(16) NOT NULL,
  scope_id      UUID,
  token_hash    VARCHAR(128) NOT NULL,
  state         VARCHAR(24) NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','accepted','revoked','expired')),
  invited_by    UUID REFERENCES enterprise.user(id),
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  accepted_by   UUID REFERENCES enterprise.user(id),
  revoked_at    TIMESTAMPTZ,
  UNIQUE (customer_id, email)       -- only one pending invite per (customer,email)
);
CREATE INDEX idx_invite_state ON platform.invite(state);
CREATE INDEX idx_invite_expires ON platform.invite(expires_at) WHERE state='pending';
```

States: `pending` → `accepted` | `revoked` | `expired`.

| From    | Event         | To       | Permission           | Side effects                                                 |
| ------- | ------------- | -------- | -------------------- | ------------------------------------------------------------ |
| pending | accept(token) | accepted | (token possession)   | create user if not exists, attach membership, consume invite |
| pending | revoke        | revoked  | members.remove scope | send "invite revoked" email                                  |
| pending | expire        | expired  | system (cron)        | (silent)                                                     |

Expiry cron runs every 10 min: `UPDATE platform.invite SET state='expired' WHERE state='pending' AND expires_at < now()`.

### 5.4 Partner Demo FSM (new)

```sql
CREATE TABLE platform.partner_demo (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL UNIQUE REFERENCES platform.customer(id),
  partner_name VARCHAR(200) NOT NULL,
  requested_by UUID REFERENCES enterprise.user(id),
  purpose      TEXT,
  state        VARCHAR(24) NOT NULL DEFAULT 'scheduled'
               CHECK (state IN ('scheduled','active','expired','archived')),
  starts_at    TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  auto_archive BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_demo_state_exp ON platform.partner_demo(state, expires_at);
```

States: `scheduled` → `active` → `expired` → `archived`.

| From      | Event                  | To       | Permission             | Side effects                                              |
| --------- | ---------------------- | -------- | ---------------------- | --------------------------------------------------------- |
| scheduled | starts_at reached      | active   | system                 | emit "demo started" audit event, activate parent Customer |
| active    | expires_at reached     | expired  | system                 | revoke all sessions, UI shows "demo ended"                |
| expired   | auto_archive or manual | archived | admin.customers.manage | set Customer → archived, drop schema                      |

### 5.5 User status FSM

```sql
ALTER TABLE enterprise.user
  ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','inactive','locked','deactivated'));
```

| From            | Event      | To          | Trigger                        | Side effects                                     |
| --------------- | ---------- | ----------- | ------------------------------ | ------------------------------------------------ |
| active          | lock       | locked      | 5 failed logins in 10 min      | session revoked; email sent                      |
| locked          | unlock     | active      | admin action OR 30-min timeout | (none)                                           |
| active          | deactivate | deactivated | admin action                   | sessions revoked; invites to this email rejected |
| deactivated     | reactivate | active      | admin action                   | (none)                                           |
| active/inactive | inactive   | inactive    | no login in 180 days           | banner on next login                             |

### 5.6 Generic runner

```ts
// @lepton/state-machine
export interface Transition<S, E, Ctx> {
  from: S; event: E; to: S;
  permission?: string;
  guard?: (ctx: Ctx) => Promise<void>;
  sideEffects?: (ctx: Ctx) => Promise<void>;
}

export class FSM<S, E, Ctx> {
  constructor(private transitions: Transition<S, E, Ctx>[]) {}
  async apply(currentState: S, event: E, ctx: Ctx, subject: Subject): Promise<S> {
    const t = this.transitions.find(x => x.from === currentState && x.event === event);
    if (!t) throw new InvalidTransition(currentState, event);
    if (t.permission && !can(subject, t.permission, ctx as any)) throw new PermissionDenied(t.permission);
    if (t.guard) await t.guard(ctx);
    const next = t.to;
    await db.transaction(async tx => {
      await persistNewState(tx, ctx, next);
      await audit.write({ action:`${ctx.entity}.${String(event)}`, before:{state:currentState}, after:{state:next}, ... });
      if (t.sideEffects) await t.sideEffects({ ...ctx, tx });
    });
    return next;
  }
}
```

## 6. Enforcement / Runtime

Any endpoint that mutates state calls the FSM. Example:

```ts
router.post(
  "/admin/customers/:id/suspend",
  withPermission("admin.customers.manage", (r) => ({})),
  async (req, res) => {
    const cust = await loadCustomer(req.params.id)
    const next = await customerFsm.apply(
      cust.lifecycle_state,
      "suspend",
      { customerId: cust.id, reason: req.body.reason },
      req.subject
    )
    res.json({ state: next })
  }
)
```

CI lint: no code may contain `UPDATE platform.customer SET lifecycle_state =` outside `@lepton/state-machine/src/customer.ts`. Same for the other entities.

## 7. Configuration surface

- `retention.post_churn_days` (Step 03) controls the delay before `churned → archived` auto-advances.
- `rbac.invite_expiry_days` controls invite default expiry.

## 8. Migration plan

1. DDL for `invite`, `partner_demo`, `user.status`.
2. Backfill: all existing customers remain `active`; all orgs remain `active`.
3. Ship code with FSM in logging-only mode for 24h (invalid transitions logged but allowed) → flip to enforcing.

## 9. Acceptance criteria

1. Every illegal transition throws `InvalidTransition`.
2. Every legal transition persists the new state AND emits an audit event AND runs side effects — all three or none (atomic).
3. Suspending a customer revokes all active sessions within 30 seconds.
4. Expired invites cannot be accepted (`accept` from `expired` throws).
5. Partner demo auto-activates exactly at `starts_at` (cron granularity: 1 min).
6. Reactivating a user does not re-grant revoked memberships.

## 10. Test plan

For each FSM: enumerate all `(state, event)` pairs. For every legal pair, assert success. For every illegal pair, assert `InvalidTransition`. Total ≈ 250 generated cases.

## 11. Edge cases

| Case                                                                  | Behavior                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Two concurrent `suspend` calls on same customer                       | DB row-level lock; second one sees `suspended` state and no-ops (idempotent). |
| Crash mid-side-effect                                                 | Transaction rolls back; state stays at `from`. Ops retries.                   |
| FSM for an entity in a state not in the enum (data corruption)        | Defensive: `InvalidTransition` with clear log; no auto-recovery.              |
| Invite accepted for an email that's already a member (different case) | Normalize email to lowercase before compare; attach to existing user.         |
| Partner demo `archived` before `expired` (manual early archive)       | Allowed — `active → archived` direct transition via `admin.customers.manage`. |

## 12. Observability

- Metric: `fsm_transitions_total{entity,from,to,result}`.
- Metric: `fsm_invalid_transitions_total{entity,from,event}` — alert on > 5/min.
- Trace: span `fsm.apply` wraps every transition.

## 13. Audit events

Every transition = one `platform.audit_log` row. Action naming:

- `customer.activated`, `customer.suspended`, `customer.reactivated`, `customer.churned`, `customer.archived`.
- `org.activated`, `org.suspended`, `org.archived`, ...
- `invite.accepted`, `invite.revoked`, `invite.expired`.
- `demo.started`, `demo.expired`, `demo.archived`.
- `user.locked`, `user.unlocked`, `user.deactivated`, `user.reactivated`.

## 14. Open questions

- Q1. Should `churned → archived` be automatic after N days, or always manual? Recommendation: automatic after `retention.post_churn_days` (default 30) to prevent forgotten data sitting forever.
- Q2. User lockout threshold — 5 / 10min default. Tunable via config? Recommendation: yes, add `rbac.lockout_threshold` + `rbac.lockout_window_minutes` keys in Step 03.
- Q3. Invite reuse: if an admin revokes and re-sends, should it be a new token? Yes — new row, old row `revoked`.
