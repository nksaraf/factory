# Step 22 — Product Integration & Middleware Wiring

**Phase:** 3B
**Depends on:** 16, 18, 19, 20, 21
**Blocks:** —
**Owner:** Backend + Frontend
**Estimated effort:** 6 days

---

## 1. Goal

Wire the new control plane into the existing TraffiCure product so every page, query, and action goes through: auth → session → RBAC scope → entitlement check → feature flag → customer schema → audit. After this step there are zero code paths in the product that bypass the platform.

## 2. Why now

All engines shipped. This is the "plug it in" step that retires the old hardcoded paths and enforces the new invariants project-wide.

## 3. Scope

### In scope

- Middleware stack order fixed and documented.
- Product UI consumes `/me`, `/me/flags`, `<Gate>`, switch-customer.
- Product reads/writes always go through `withCustomerSchema`.
- All entitlement-gated actions decorated with `withEntitlement`.
- Banners: suspended, past_due, entitlement near-limit, impersonation, demo-expires-soon.
- Mobile app changes: device token registration, push opt-in flow.
- Sunset of legacy env-var-driven paths.

### Out of scope

- New product features — this step is plumbing only.

## 4. Deliverables

1. `@lepton/server-middleware` composed pipeline.
2. Product UI refactor PR bundle (large; staged behind flag).
3. Mobile app v1.4 with device token + push.
4. Decommission tickets closed: 14 legacy alert crons, env-var ingestion path, ad-hoc audit logger.

## 5. Design

### 5.1 Middleware order (per request)

```
requestId()            → generate or propagate
logger()               → bind request_id
auth()                 → parse cookie/PAT → subject OR 401
sessionBind()          → attach customer_context_id, impersonated_from
customerSchema()       → set SET LOCAL search_path for DB tx
rbacLoad()             → memberships + permissions + scope cache
rateLimit()            → session / PAT bucket
idempotency()          → on unsafe methods
handler()              → inside: withPermission, withEntitlement, fsm.apply, etc.
audit()                → emit audit row inside handler's tx
```

Every step has a documented contract and failure shape.

### 5.2 Frontend subject bootstrap

On app load:

```
GET /me        → subject (user, platformRole, customers[], memberships, prefs)
GET /me/flags  → flag values
```

React Provider exposes:

- `useSubject()`, `useCan(perm, target)`, `useFlag(key)`.
- `<Gate perm=...>` + `<FlagGate flag=...>`.

Refresh on: pub-sub `subject_invalidated:{userId}` (via SSE), or on 401 (re-auth and retry).

### 5.3 Customer switcher

Users with memberships in >1 customer get a top-bar dropdown. Switching:

- `POST /me/switch-customer { customerId }` → new session cookie with customer_context_id.
- All routes refetch.
- Mobile: forces re-select on next open if last-used customer is suspended.

### 5.4 Banners

Stacked at top, under top bar. Priority order (top-most first):

1. Impersonation (red).
2. Suspended (red): "This customer is suspended. Reason: billing_past_due. Contact your admin."
3. Past-due (amber): "Invoice INV-... is past due. Pay now / See invoice."
4. Demo-expires-soon (amber): "Demo ends in 3 days."
5. Entitlement near-limit (amber): "Ask AI: 4,800 / 5,000 this month."
6. MFA-grace-nag (amber): "Enroll MFA before Apr 29."

Dismissible only if severity ≤ info AND role has `dashboard.view` (persisted 24h).

### 5.5 Product data reads

Before: `db('traffic_observation').where('organization_id', orgId)`.
After:

```ts
await withCustomerSchema(ctx.customerId, tx =>
  tx('traffic_observation').where(...) );
```

CI check: any reference to `public.traffic_observation` outside `@lepton/ingestion` fails build.

### 5.6 Entitlement decoration

Every gated action handler wraps with Step 04 middleware:

```ts
router.post('/ask-ai/query',
  withPermission('ask_ai.query'),
  withEntitlement({ module: 'modules.ask_ai', limitKey: 'limits.ask_ai_monthly', cost: 1 }),
  async (req, res) => { ... });
```

### 5.7 Mobile

- Device token registration on login: `POST /me/devices { platform, token }`.
- Push opt-in prompt on first alert after login.
- Deep-link to alert detail from push payload.
- Respect user notification prefs (Step 11).

### 5.8 Sunset checklist

Each legacy path retired behind a PR + flag:

- 14 alert crons → disable in k8s, delete after 14 days.
- Env-var ingestion → remove from helm, delete module.
- Ad-hoc audit logger (the Loki grep one) → replaced by `platform.audit_log`.
- Hardcoded thresholds in product code → replaced by Config Registry reads.
- `organization_id` column reads on traffic tables → replaced by `search_path`.

## 6. Enforcement / Runtime

- Bundler plugin checks imports across package boundaries (product must not import admin).
- ESLint rule: no direct Redis or DB access outside repository layer.
- CI blocks merges that reduce audit coverage (measured by snapshot of `audit_log.action` distinct count).

## 7. Configuration surface

- `flags.legacy_ingestion_enabled` default false (kept as kill-switch 30 days).
- `ui.banners_enabled` default true.

## 8. Migration plan

1. Ship middleware + subject bootstrap behind `flags.platform_v2`.
2. Per-customer cutover in the order: Dehradun → Bidhan Nagar → Barrackpore → Howrah → Kolkata → Pune.
3. 48h soak between cutovers.
4. Flip `flags.legacy_ingestion_enabled=false` after all customers live.
5. Delete legacy code paths 30 days later.

## 9. Acceptance criteria

1. Every product request has a `request_id` in logs and a matching `audit_log` row for any mutation.
2. Suspending a customer produces visible banner and logs user out within 30s.
3. Ask AI query for user in org A writes to `customer_<A>.usage_log` and counts against org A's entitlements only.
4. CI lint catches a PR that bypasses `withCustomerSchema`.
5. Mobile receives push for an alert within 60s of firing when opted in.

## 10. Test plan

- Full e2e on staging: create customer via wizard → user logs in on mobile → alert fires → push received → ack in app → audit log shows whole chain.
- Chaos: DB primary failover mid-session; retries succeed without re-auth.
- Perf: p95 page TTI ≤ 2s after middleware stack added.

## 11. Edge cases

| Case                                                  | Behavior                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| User in 2 customers, both suspended                   | Show chooser with suspended banners on both; no data access. |
| Device token registered to user who later deactivates | Push dropped at dispatch; token cleaned up nightly.          |
| Impersonated admin tries to acknowledge an alert      | Allowed (acts as target); audited with both IDs.             |
| Flag flip changes banner set mid-session              | Banners refresh on next route nav.                           |

## 12. Observability

- `api_subject_load_ms` histogram.
- `api_middleware_pipeline_ms{stage}`.
- `api_legacy_path_hit_total{path}` — must be zero after sunset.
- `admin_banner_impressions_total{type}`.

## 13. Audit events

- `user.switch_customer`.
- `device.registered / removed`.
- `banner.dismissed{type}` (info-level).

## 14. Open questions

- Q1. Keep mobile app backward compatible with v1 API? Recommendation: ship v1.4 with both; force-upgrade v1.x by v1.5 (Phase 2).
- Q2. Should `switch-customer` be instant or require re-auth? Recommendation: instant, but bumps `amr` expiry — heightened actions (suspend, etc.) re-prompt for MFA within the new customer context.
