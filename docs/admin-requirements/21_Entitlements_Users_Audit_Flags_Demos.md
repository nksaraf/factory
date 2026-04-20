# Step 21 — Lepton Admin: Global Admin Surfaces

**Phase:** 3B
**Depends on:** 16, 17, 15'
**Blocks:** 22
**Owner:** Frontend
**Estimated effort:** 9 days
**Note:** This step contains 3 independently shippable substeps (21a, 21b, 21e). Each has its own effort estimate, acceptance criteria, and test plan. They can be parallelized or shipped separately.

---

## 1. Goal

Fill out the remaining Lepton Admin screens: global dashboard, entitlements catalog, and audit explorer (with flags and partner demo subsections).

## 2. Why now

Without the global dashboard, entitlements surface, and audit explorer, super_admins cannot operate the platform. Config registry editor and internal user management are deferred to improve MVP shipping speed.

## 3. Scope

This step encompasses 3 independently shippable substeps:

- **21a — Global Dashboard** (`/dashboard`) — cross-customer operational overview. Effort: 3 days.
- **21b — Entitlements Surface** (`/entitlements`) — plans catalog + per-customer view. Effort: 2 days.
- **21e — Audit Explorer, Flags, Demos** (`/audit`, `/flags`, `/demos`) — three related read/write surfaces. Effort: 4 days.

Deferred to post-MVP:

- **21c — Internal Users** — Lepton staff management via UI (SQL access sufficient for ops).
- **21d — Config Registry Editor** — Configuration knob editor (can use SQL for now).
- **21f — Feature Flags UI** — Part of larger flags admin surface.
- **21g — Partner Demos UI** — Included in 21e Audit Explorer.

### Out of scope

- Analytics on the admin usage itself — Phase 2.

## 4. Deliverables

Three routes + their shared components (`<DiffViewer>`, `<EvalPlayground>`, `<DashboardCard>`).

## 5. Design

### 5.1 21a — Global Dashboard (`/dashboard`)

Cross-customer operational overview, not commercial:

- **Row 1 — Health strip**: customers active / suspended / past_due / churned; orgs active; data sources healthy / degraded / failing.
- **Row 2 — Volume**: rows ingested last hour by customer (bar); Ask AI queries last 24h (sparkline); alerts fired last 24h by severity (stacked bar).
- **Row 3 — Usage vs entitlement**: table of customers approaching limits (>80%) with [Go to customer] link.
- **Row 4 — Recent high-severity alerts** across all customers (top 10).
- **Row 5 — Platform errors**: top 5 error codes from last 1h.

Refresh 60s. All widgets respect `support_readonly` (read-only everywhere anyway).

### 5.2 21b — Entitlements Surface (`/entitlements`)

Two tabs:

- **Plans catalog** — table of `platform.plan`; edit entitlements JSON via form; new plan action.
- **By customer** — pivot: rows=customers, columns=limit keys, cells show `{override ?? plan_default} / usage`. Click cell → edit override.

### 5.3 21e — Audit explorer (`/audit`)

- Filter bar: time range (default 24h), actor, customer, action (multi-select from catalog), request_id search.
- Infinite scroll virtual table.
- Row click → drawer with full diff, request metadata, IP, UA, MFA factors.
- Export CSV (respects filters; capped at 100k rows; larger → email async with link).

### 5.3a Flags (`/flags`) — part of 21e

- Table: key, kind, default, active rules count, owner, last_edited.
- Detail: flag metadata + rule list (ordered by priority, drag-to-reorder) + [Add rule] + [Evaluate for user…] playground:
  - Playground: input fields for subject (userId or synthetic: customerId, orgId, platformRole, roleKeys, country, …) → shows which rule matched and resulting value.
- Archive flag: soft-delete; stays in DB 30 days then pruned.

### 5.3b Demos (`/demos`) — part of 21e

- List of `platform.partner_demo` with state, partner_name, expires_at, customer link.
- [New demo] wizard: partner_name, customer slug (auto-generate `partner-wgs-2026-q2` etc.), purpose, start/end dates, auto_archive toggle.
- Detail: timeline (scheduled → active → expired → archived), associated customer link, [End early] action.

### 5.4 Shared: DiffViewer (used by 21e)

Used in audit detail, config history, flag rule history. JSON diff with add/remove/change highlighted. Handles nested objects; collapsible.

## 6. Enforcement / Runtime

- Every edit goes through Step 16 API with permission checks.
- Rule-list reordering sends a single PATCH with array of `{ruleId, priority}`.
- Export jobs queued to background worker; delivered via Step 11 notifications.

## 7. Configuration surface

- `admin.dashboard_refresh_seconds`.
- `admin.audit_export_cap_rows`.

## 8. Migration plan

1. Ship Global Dashboard and Entitlements concurrently.
2. Ship Audit + Flags next (includes Demos subsection).

## 9. Acceptance criteria

### 21a — Global Dashboard

1. Dashboard refreshes every 60s without blocking the UI.
2. All five rows load in <2s combined with 30-day range.
3. All widgets respect `support_readonly` role restrictions.

### 21b — Entitlements Surface

1. Plan editor allows creation, edit, disable of plan rows.
2. Customer pivot view shows usage vs limits; cell edit persists.
3. Plan changes apply to future invoices without affecting past ones.

### 21e — Audit explorer, Flags, Demos

1. Audit CSV export completes for 10k rows within 30s.
2. Flag rule drag-reorder persists and re-evaluates correctly.
3. Playground evaluation matches server eval for same subject 100% of the time.
4. Demo auto-archive triggers at correct time and transitions state.

## 10. Test plan

- Playwright per screen.
- Load: audit search with 50k-row range returns paged response in <2s.
- Axe accessibility on every screen.

## 11. Edge cases

| Case                                               | Behavior                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Config value write for key with `deprecated=true`  | Warn; require confirm.                                                      |
| Flag rule deleted while being evaluated            | Eval uses old snapshot for current request; next request uses new ordering. |
| Audit export for customer with 10M events in range | Server rejects sync; triggers async job + notification on completion.       |
| Demo customer created with past `starts_at`        | Immediately transitions to `active`.                                        |

## 12. Observability

- `admin_config_edits_total{key}`.
- `admin_audit_queries_total`.
- `admin_flag_edits_total`.
- `admin_dashboard_load_duration_ms` histogram.

## 13. Audit events

- Everything in this step is itself audited — edits to config, flags, demos, internal user roles.

## 14. Open questions

- Q1. Should the global dashboard include commercial metrics (MRR, AR)? Recommendation: separate `/billing/overview` for that; keep this one operational.
- Q2. Expose a read-only version of this dashboard to investors/board via time-bound link? Recommendation: no — too many leaky aggregates; summarized quarterly exports instead.
