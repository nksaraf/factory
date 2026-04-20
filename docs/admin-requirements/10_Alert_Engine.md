# Step 10 — Alert Engine & Rule DSL

**Phase:** 2A
**Depends on:** 03, 07, 08, 09
**Blocks:** 11, 20
**Owner:** Backend
**Estimated effort:** 7 days

---

## 1. Goal

Replace the scattered, city-specific alert cron jobs with a single typed rule engine. Every alert in the product is produced by evaluating a `AlertRule` (stored in DB, scoped to an org) against a stream of normalized observations from Step 09. Customer/Org Admins configure rules from the product UI; Lepton Super Admin configures defaults and guardrails from Lepton Admin.

## 2. Why now

Steps 08 and 09 guarantee ingestion is clean and per-customer. Without a rule engine, downstream (notifications in Step 11, dashboard in Step 17, rule builder in Step 20) cannot hang off a stable contract. Today there are 14 bespoke alert scripts across 6 cities; unifying them is prerequisite to shipping any new alert type without code changes.

## 3. Scope

### In scope

- `AlertRule` DSL (JSON, versioned).
- Evaluator worker (`alert-evaluator`) that runs per-org on a cron cadence driven by config.
- Alert state machine: `firing → acknowledged → resolved` (+ `auto_resolved`, `expired`, `suppressed`).
- Dedup / suppression logic (per segment/time-window).
- Escalation ladder.
- Working-hours / quiet-hours awareness.
- Per-org config via Step 03 keys.
- Audit trail for every state transition.

### Out of scope

- Notification delivery — Step 11.
- UI rule builder — Step 20.
- ML-derived dynamic baselines — Phase 2 (rules can reference `baselines.*` computed offline).
- Multi-signal correlation (alert IFF incident AND weather) — Phase 2.

## 4. Deliverables

1. `@lepton/alerts` package: DSL parser, evaluator, state machine.
2. Tables: `platform.alert_rule`, `customer_<slug>.alert`, `customer_<slug>.alert_transition`.
3. Worker `alert-evaluator` deployed per region.
4. REST endpoints (consumed by Step 16 & 20): CRUD on rules, acknowledge, resolve, suppress.
5. Seed of 6 default rule templates (congestion, slow-corridor, stale-data, jam-persistence, holiday-spike, planned-closure).

## 5. Design

### 5.1 Rule DSL

Stored as JSON in `platform.alert_rule.definition`. Versioned via `schema_version`.

```json
{
  "schema_version": 1,
  "name": "Sustained congestion on arterials",
  "severity": "high",
  "target": {
    "scope": "road_type",
    "road_types": ["motorway", "trunk", "primary"],
    "segments": null,
    "zones": null
  },
  "condition": {
    "op": "AND",
    "clauses": [
      {
        "metric": "speed_kmh",
        "cmp": "<",
        "value": { "ref": "alerts.congestion_speed_threshold_kmh" }
      },
      {
        "metric": "duration_minutes",
        "cmp": ">=",
        "value": { "ref": "alerts.congestion_min_duration_minutes" }
      }
    ]
  },
  "window": { "kind": "rolling", "minutes": 15 },
  "working_hours": { "ref": "alerts.working_hours" },
  "dedup": {
    "key": ["segment_id"],
    "window_minutes": { "ref": "alerts.dedup_window_minutes" }
  },
  "escalation": {
    "ladder_ref": "alerts.escalation_ladder",
    "start_after_minutes": 10
  },
  "auto_resolve": {
    "when": {
      "metric": "speed_kmh",
      "cmp": ">=",
      "value": { "ref": "alerts.auto_resolve_speed_kmh" }
    },
    "sustain_minutes": 5
  }
}
```

Every leaf `value` is either a literal OR a `{ref: "<config_key>"}` lookup into the Configuration Registry (Step 03), resolved at eval-time with the org's scope. That is how a Customer Admin can tune thresholds without an engineer touching the rule JSON.

### 5.2 `platform.alert_rule`

```sql
CREATE TABLE platform.alert_rule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES platform.customer(id),
  org_id         UUID REFERENCES enterprise.organization(id),  -- NULL = customer-wide
  key            VARCHAR(80) NOT NULL,      -- stable handle, e.g. 'sustained_congestion'
  name           VARCHAR(200) NOT NULL,
  severity       VARCHAR(16) NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  definition     JSONB NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  schema_version INT NOT NULL DEFAULT 1,
  created_by     UUID REFERENCES enterprise.user(id),
  updated_by     UUID REFERENCES enterprise.user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, org_id, key)
);
CREATE INDEX idx_alert_rule_enabled ON platform.alert_rule(customer_id, org_id) WHERE enabled;
```

### 5.3 `customer_<slug>.alert`

```sql
CREATE TABLE customer_pune.alert (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID NOT NULL,          -- FK in platform schema (enforced app-side)
  org_id          UUID NOT NULL,
  segment_id      VARCHAR(80),
  zone_id         UUID,
  severity        VARCHAR(16) NOT NULL,
  state           VARCHAR(24) NOT NULL DEFAULT 'firing'
                  CHECK (state IN ('firing','acknowledged','resolved','auto_resolved','expired','suppressed')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_fired_at  TIMESTAMPTZ NOT NULL,
  ack_at          TIMESTAMPTZ,
  ack_by          UUID,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  escalation_step INT NOT NULL DEFAULT 0,
  dedup_key       VARCHAR(200) NOT NULL,
  evidence        JSONB NOT NULL,          -- observation snapshot
  UNIQUE (rule_id, dedup_key, state) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_alert_state ON customer_pune.alert(state, opened_at DESC);
CREATE INDEX idx_alert_org_recent ON customer_pune.alert(org_id, opened_at DESC);
```

Transitions stored in `customer_<slug>.alert_transition` (append-only).

### 5.4 Evaluator loop

```ts
async function evaluateOrg(orgId) {
  const cfg = await configClient.resolveBundle(["alerts.*"], { orgId })
  if (!cfg["alerts.engine_enabled"]) return
  const rules = await loadEnabledRules(orgId)
  const window = cfg["alerts.eval_window_minutes"]
  const obs = await fetchObservations(orgId, now - window, now)

  for (const rule of rules) {
    const matches = evaluateRule(rule, obs, cfg)
    for (const m of matches) {
      await upsertAlert({
        ruleId: rule.id,
        orgId,
        severity: rule.severity,
        segmentId: m.segmentId,
        dedupKey: buildDedupKey(rule, m),
        evidence: m.snapshot,
        firstFiredAt: m.firstAt,
      })
    }
  }
  await runAutoResolve(orgId, cfg)
  await runEscalations(orgId, cfg)
}
```

Cadence: `alerts.eval_interval_seconds` (default 60). Enforced by a Redis lock per `(org_id, 'alert-eval')` so only one worker evaluates per org at a time.

### 5.5 Dedup

`dedup_key = sha1(rule.key + '|' + join(rule.dedup.key values))`. Upsert semantics:

- If an alert with `(rule_id, dedup_key)` exists in state `firing|acknowledged` → update `evidence`, do NOT create a new row.
- Else insert new.

Suppression window: once an alert transitions to `resolved|auto_resolved`, a new alert with the same dedup_key is suppressed for `alerts.dedup_window_minutes` (default 20). Suppressed attempts are logged but don't produce rows.

### 5.6 Escalation

`alerts.escalation_ladder` config shape:

```json
[
  { "after_minutes": 0, "channels": ["in_app"], "roles": ["operator"] },
  {
    "after_minutes": 10,
    "channels": ["email"],
    "roles": ["operator", "org_admin"]
  },
  { "after_minutes": 30, "channels": ["sms"], "roles": ["org_admin"] },
  { "after_minutes": 60, "channels": ["voice"], "roles": ["customer_admin"] }
]
```

`runEscalations` increments `escalation_step` on any `firing` alert whose age crosses the next threshold, and emits a `notify.requested` event (consumed in Step 11). Acknowledging halts further escalation.

### 5.7 Alert state machine

| From                  | Event                      | To            | Actor                         | Side effects                               |
| --------------------- | -------------------------- | ------------- | ----------------------------- | ------------------------------------------ |
| —                     | fire                       | firing        | system                        | emit `alert.opened`, schedule escalation   |
| firing                | acknowledge                | acknowledged  | any with `alerts.acknowledge` | halt escalation, emit `alert.acknowledged` |
| firing / acknowledged | resolve                    | resolved      | any with `alerts.acknowledge` | emit `alert.resolved`                      |
| firing                | auto_resolve_condition_met | auto_resolved | system                        | emit `alert.auto_resolved`                 |
| firing / acknowledged | expire                     | expired       | system (24h no activity)      | emit `alert.expired`                       |
| firing                | suppress                   | suppressed    | system (dedup window)         | log only                                   |

Governed by the Step 07 FSM runner.

### 5.8 Working / quiet hours

`alerts.working_hours` config:

```json
{
  "tz": "Asia/Kolkata",
  "days": ["mon", "tue", "wed", "thu", "fri", "sat"],
  "start": "07:00",
  "end": "22:00"
}
```

If a rule's `working_hours` ref resolves to a window and the current time is outside it, the rule does not fire. Override per-rule supported.

## 6. Enforcement / Runtime

- Rules are loaded into evaluator memory at startup + on pub-sub `alert_rule:updated:{customer_id}`. No poll-the-DB-every-tick.
- Every alert write goes through `withCustomerSchema` (Step 08).
- Every state transition flows through the FSM runner (Step 07).
- Rule JSON validated against a JSON Schema on write; reject invalid with typed error.

## 7. Configuration surface

All config keys created in Step 03:

| Key                                      | Scope         | Default  | UI location             |
| ---------------------------------------- | ------------- | -------- | ----------------------- |
| `alerts.engine_enabled`                  | customer, org | true     | Org Detail → Alerts tab |
| `alerts.eval_interval_seconds`           | customer, org | 60       | Lepton Admin only       |
| `alerts.eval_window_minutes`             | org           | 15       | Org Detail → Alerts tab |
| `alerts.congestion_speed_threshold_kmh`  | org, zone     | 12       | Rule Builder (Step 20)  |
| `alerts.congestion_min_duration_minutes` | org           | 10       | Rule Builder            |
| `alerts.auto_resolve_speed_kmh`          | org           | 25       | Rule Builder            |
| `alerts.dedup_window_minutes`            | org           | 20       | Rule Builder            |
| `alerts.escalation_ladder`               | org           | see §5.6 | Rule Builder            |
| `alerts.working_hours`                   | org           | see §5.8 | Org Detail → Alerts tab |
| `alerts.max_rules_per_org`               | customer      | 50       | Lepton Admin only       |

## 8. Migration plan

1. Ship tables + package + evaluator, disabled by flag `flags.alert_engine_v2`.
2. Import existing 14 cron-based alert logics as 6 rule templates; parameterize differences via config.
3. Run dual-mode: legacy crons + new evaluator for 72h. Compare fired alert counts per segment. Expect ≤5% divergence.
4. Flip flag on per-org (Dehradun first, Pune last).
5. Delete legacy crons after 14 days clean.

## 9. Acceptance criteria

1. A rule with threshold `speed_kmh < 12 for 10min` fires exactly once per segment when violated, and does not fire again until dedup window elapses.
2. Acknowledging a firing alert stops further escalation within 1 evaluation cycle.
3. Changing `alerts.congestion_speed_threshold_kmh` via config takes effect within `config.cache_ttl_sec` (default 60s) without worker restart.
4. When `alerts.engine_enabled=false` for an org, zero alerts are created.
5. A rule with invalid JSON is rejected on write with error code `alert_rule.schema_invalid`.
6. Two concurrent evaluators cannot double-fire: Redis lock holder proven via metric.
7. Outside working hours, rules do not fire even when conditions are met.

## 10. Test plan

### Unit

- DSL parser: 30 valid + 30 invalid fixtures.
- Evaluator: synthetic observation streams → expected alerts.
- Dedup key computation stable across process restarts.

### Integration

- Full loop on staging with HERE mock (Step 09) feeding observations; verify alert rows land in correct `customer_<slug>.alert`.
- Escalation ladder fires `notify.requested` events at exactly the configured minutes (± eval interval).

### Load

- 10k segments × 20 rules → single evaluator cycle completes in < 30s on standard worker.

## 11. Edge cases

| Case                                                   | Behavior                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rule references deleted segment                        | Evidence snapshot keeps the segment name; next cycle produces no match → alert auto-resolves after `auto_resolve.sustain_minutes`. |
| Clock skew (obs timestamp in future)                   | Clamp to `now`; log WARN.                                                                                                          |
| Config key ref missing at eval time                    | Rule marked `errored` for that cycle; surfaced in health panel; does not crash evaluator.                                          |
| Alert count for an org > `alerts.max_alerts_per_cycle` | Emit top-N by severity, warn, increment `alert_eval_truncated_total`.                                                              |
| Evaluator worker dies mid-cycle                        | Redis lock TTL 90s releases; next cycle re-evaluates; idempotent via dedup.                                                        |
| Rule disabled while firing alerts exist                | Existing alerts continue their lifecycle (ack/resolve allowed); no NEW alerts for that rule.                                       |

## 12. Observability

- `alert_eval_duration_ms{org_id}` histogram.
- `alert_fired_total{rule_key,severity,org_id}`.
- `alert_auto_resolved_total{rule_key}`.
- `alert_rule_errors_total{rule_key,reason}`.
- `alert_escalations_total{step}`.
- Trace: `alert.evaluate` span wraps each org's cycle.
- Log: every rule error with rule_id + sanitized config snapshot.

## 13. Audit events

- `alert_rule.created / updated / deleted / enabled / disabled`.
- `alert.opened / acknowledged / resolved / auto_resolved / expired / suppressed`.
- `alert.escalated{step}`.

## 14. Open questions

- Q1. Do we support custom user-written SQL conditions? Recommendation: no — DSL only. Keeps surface safe, auditable, and engine-agnostic.
- Q2. Should `resolve` require a reason/comment? Recommendation: optional now, mandatory when `alerts.require_resolution_note` is true (default false).
- Q3. Cross-org rules (e.g. "any city where traffic is crashing")? Recommendation: defer to Phase 2; customer-level rules cover 80%.
