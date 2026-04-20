# Step 16 — API Surface (REST)

**Phase:** 2B
**Depends on:** 04, 09, 10, 11, 13, 15'
**Blocks:** 17, 18, 19, 20, 21, 22
**Owner:** Backend
**Estimated effort:** 6 days

---

## 1. Goal

Define and ship the complete REST API surface that Lepton Admin (Steps 17–21) and the TraffiCure product (Step 22) call. After this step, every mutation in the system has exactly one endpoint, one permission check, one audit trail, and one typed error shape.

## 2. Why now

All previous steps produced engines (RBAC, FSM, alerts, flags, billing). Now they need a uniform HTTP surface. Doing this before the UI prevents the UI from papering over inconsistencies.

## 3. Scope

### In scope

- OpenAPI 3.1 spec as source of truth (`/docs/openapi/lepton-admin.yaml` and `/docs/openapi/product.yaml`).
- Typed error catalogue (code, http status, shape).
- Pagination, filtering, sorting conventions.
- Idempotency-Key support on unsafe methods.
- Rate limiting per API key / per user.
- Versioning strategy (URL-path `/v1/`).
- Generated TS client (`@lepton/api-client`) and generated docs site.

### Out of scope

- GraphQL — not doing it.
- gRPC internal — only if a service boundary justifies; not in Phase 1.
- Public developer API keys for customers — Phase 2.

## 4. Deliverables

1. Two OpenAPI files checked in; CI validates against implementation.
2. Error catalogue `docs/errors.md` (auto-generated).
3. `@lepton/api-client` package (TS types + fetch helpers).
4. Mock server for FE dev (`yarn api:mock`).
5. Contract tests (Pact-style) for each consumer.

## 5. Design

### 5.1 Conventions

- Base URL: `https://app.trafficure.ai/api/v1`.
- Admin prefix: `/admin/*` — requires platform_role >= support_readonly.
- Content-Type: `application/json` only (multipart only for upload endpoints).
- Auth: session cookie for browser; `Authorization: Bearer <pat>` for machine clients.
- Every list endpoint: `?page_size=50&cursor=abc&sort=-created_at&filter[state]=active`.
- Every mutation accepts `Idempotency-Key` header; server dedups for 24h.

### 5.2 Standard error shape

```json
{
  "error": {
    "code": "alert_rule.schema_invalid",
    "message": "Rule definition failed JSON Schema validation.",
    "details": [{ "path": "/condition/clauses/0/cmp", "error": "not in enum" }],
    "request_id": "req_01J..."
  }
}
```

HTTP mapping:

- 400: validation / schema / bad input
- 401: missing/expired auth
- 403: permission denied / mfa_required / module_disabled
- 404: not found (also returned instead of 403 for cross-scope reads)
- 409: conflict / state violation / duplicate
- 422: semantic errors (e.g. fsm.invalid_transition)
- 429: rate_limited / entitlement_exceeded
- 5xx: server errors — never leaks internal details

### 5.3 Endpoint inventory

**Admin surface (consumed by Steps 17–21):**

```
# Customers
GET    /admin/customers
POST   /admin/customers
GET    /admin/customers/:id
PATCH  /admin/customers/:id
POST   /admin/customers/:id/activate
POST   /admin/customers/:id/suspend
POST   /admin/customers/:id/reactivate
POST   /admin/customers/:id/churn
POST   /admin/customers/:id/archive

# Organizations
GET    /admin/customers/:id/orgs
POST   /admin/customers/:id/orgs
GET    /admin/orgs/:id
PATCH  /admin/orgs/:id
POST   /admin/orgs/:id/activate | /suspend | /reactivate | /archive
GET    /admin/orgs/:id/city-config
PUT    /admin/orgs/:id/city-config
POST   /admin/orgs/:id/data-source/test
PUT    /admin/orgs/:id/data-source

# Members
GET    /admin/customers/:id/members
POST   /admin/customers/:id/invites
DELETE /admin/invites/:id
POST   /admin/members/:id/role
DELETE /admin/members/:id

# Entitlements
GET    /admin/customers/:id/entitlements
PATCH  /admin/customers/:id/entitlements
GET    /admin/customers/:id/usage?period=...

# Config
GET    /admin/config/keys
GET    /admin/config/values?scope_type=...&scope_id=...
PUT    /admin/config/values
DELETE /admin/config/values

# Flags
GET    /admin/flags
POST   /admin/flags
GET    /admin/flags/:key
PATCH  /admin/flags/:key
POST   /admin/flags/:key/rules
PATCH  /admin/flags/:key/rules/:ruleId
DELETE /admin/flags/:key/rules/:ruleId
POST   /admin/flags/:key/evaluate   # playground

# Billing
GET    /admin/plans
POST   /admin/plans
GET    /admin/customers/:id/billing
PATCH  /admin/customers/:id/billing
GET    /admin/customers/:id/invoices
POST   /admin/customers/:id/invoices/:invId/mark-paid
POST   /admin/customers/:id/invoices/:invId/void

# Demos
GET    /admin/partner-demos
POST   /admin/partner-demos
PATCH  /admin/partner-demos/:id
POST   /admin/partner-demos/:id/archive

# Alerts — rule management
GET    /admin/orgs/:id/alert-rules
POST   /admin/orgs/:id/alert-rules
GET    /admin/alert-rules/:id
PATCH  /admin/alert-rules/:id
DELETE /admin/alert-rules/:id

# Audit
GET    /admin/audit?actor_id=...&action=...&since=...

# Impersonation
POST   /admin/impersonate/start
POST   /admin/impersonate/end
GET    /admin/impersonate/active

# Health & data sources
GET    /admin/data-sources/health
GET    /admin/data-sources/:orgId

# Legal hold
GET    /admin/legal-holds
POST   /admin/legal-holds
POST   /admin/legal-holds/:id/release
```

**Product surface (consumed by TraffiCure app):**

```
# Self
GET    /me
GET    /me/flags
GET    /me/notifications
POST   /me/notifications/:id/read
GET    /me/sessions
DELETE /me/sessions/:id
POST   /me/switch-customer

# Auth
POST   /auth/login | /auth/logout | /auth/mfa/* | /auth/sso/*

# Orgs (customer-scoped)
GET    /orgs
GET    /orgs/:id
GET    /orgs/:id/members
POST   /orgs/:id/invites

# Alerts
GET    /orgs/:id/alerts
GET    /alerts/:id
POST   /alerts/:id/acknowledge
POST   /alerts/:id/resolve

# Traffic
GET    /orgs/:id/segments
GET    /orgs/:id/segments/:segId/observations?window=...
GET    /orgs/:id/metrics/hourly?...

# CityPulse / Ask AI
POST   /orgs/:id/ask-ai/query
GET    /orgs/:id/ask-ai/history

# Reports
GET    /orgs/:id/reports
POST   /orgs/:id/reports
GET    /reports/:id
POST   /reports/:id/run
```

### 5.4 OpenAPI source of truth

Every endpoint is specified in YAML with request/response schemas, required permission, example payloads. CI job `yarn api:verify`:

- Starts the server with a fixture DB.
- For each endpoint in YAML, sends example request, asserts response matches schema.
- Fails if any implementation drifts.

### 5.5 Generated client

```ts
import { createClient } from "@lepton/api-client"
const api = createClient({ baseUrl, fetcher })
const cust = await api.admin.customers.create({
  body: { name, slug, customer_type: "enterprise" },
})
```

Types generated from OpenAPI via `openapi-typescript`.

### 5.6 Rate limiting

- Browser session: 300 req/min per session.
- PAT: per-token bucket per minute, configured in `admin.api_keys` (Phase 2; placeholder now).
- 429 with `Retry-After`.

### 5.7 Idempotency

Server stores `(key, user_id, method, path, body_sha, response)` for 24h in `platform.idempotency_log`. Replay returns stored response.

## 6. Enforcement / Runtime

- Every handler decorated with `withPermission(perm, targetOf)` (Step 05). CI lint: handlers that mutate MUST declare a permission.
- Every mutation wrapped in a single transaction that also writes its audit log row.
- Response shape strictly typed; no `any` escapes.

## 7. Configuration surface

- `api.rate_limit_session_per_min`, `api.rate_limit_pat_per_min`, `api.idempotency_retention_hours`.

## 8. Migration plan

1. Write OpenAPI for endpoints that already exist in code (reverse-engineer).
2. Add CI drift check.
3. Greenfield all new endpoints from spec-first.

## 9. Acceptance criteria

1. `yarn api:verify` green.
2. Typed client compiles against every endpoint with zero `unknown`.
3. Every mutation returns audit event correlation `request_id` in response header.
4. Replayed Idempotency-Key returns identical response within 24h.
5. Unauthenticated request to any `/admin/*` returns 401; authenticated but unauthorized returns 403 OR 404 (cross-scope reads return 404).

## 10. Test plan

- Contract tests: each consumer (admin UI, product UI, mobile) runs Pact against provider in CI.
- Fuzz: send malformed bodies; confirm typed 400, never 5xx.
- Permission matrix: for each endpoint, assert every role returns expected 2xx/403.

## 11. Edge cases

| Case                                           | Behavior                    |
| ---------------------------------------------- | --------------------------- |
| Idempotency-Key reused with different body     | 409 `idempotency_conflict`. |
| PATCH partial update misses required invariant | 422 with field path.        |
| Cursor tampered                                | 400 `invalid_cursor`.       |
| Clock skew on token                            | ±5 min tolerance; else 401. |

## 12. Observability

- `http_requests_total{route,method,status}`.
- `http_duration_ms{route}` histogram.
- `http_error_total{code}`.
- Correlation: every log line carries `request_id`.

## 13. Audit events

- One per mutation; action naming mirrors URL (`customer.create`, `alert_rule.update`).

## 14. Open questions

- Q1. Public developer API now or later? Recommendation: later. Surface ships internal-only with PAT placeholder.
- Q2. Cursor vs offset pagination? Recommendation: cursor for all list endpoints; drop offset support. Sorts stable on (sort_field, id).
