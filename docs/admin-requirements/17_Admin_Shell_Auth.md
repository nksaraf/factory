# Step 17 — Lepton Admin Shell & Auth

**Phase:** 3A
**Depends on:** 16, 15'
**Blocks:** 18, 19, 20, 21
**Owner:** Frontend + Backend
**Estimated effort:** 5 days

---

## 1. Goal

Ship the Lepton Admin web app shell — layout, navigation, authentication, role-gated routing, impersonation banner, global search — ready for Steps 18–21 to drop feature screens into.

## 2. Why now

Separate app surface from the customer-facing product so super_admin pages can never accidentally leak into customer UI bundles. Also lets us independently deploy/version Admin.

## 3. Scope

### In scope

- Separate SPA at `admin.trafficure.ai`.
- Layout: left nav, top bar, content area, command-k palette.
- Auth: login (password + MFA), SSO not applicable (internal staff only; Google Workspace OIDC accepted).
- Route guards: `platform_role` must be `support_readonly`, `ops_admin`, or `super_admin`.
- Impersonation banner (Step 15).
- Global search (customers, orgs, users, audit events).
- Feature-flag-gated beta sections.
- Empty-state and error pages.

### Out of scope

- Individual feature screens — Steps 18–21.
- Theming — single TraffiCure theme, no per-customer branding in Admin.

## 4. Deliverables

1. `apps/admin/` Next.js app (or Vite+React — Umang to confirm; default Next.js 14 app router).
2. `@lepton/admin-ui` shared components.
3. Deployment pipeline → `admin.trafficure.ai` (separate CF/CDN or subdomain).
4. Sentry + request_id correlation.

## 5. Design

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ TraffiCure Admin    [customer search ⌘K]      user ▾  help  │  ← top bar (50px)
├───────────┬──────────────────────────────────────────────────┤
│ DASHBOARD │                                                  │
│ Customers │                                                  │
│ Orgs      │            Page content                          │
│ Users     │                                                  │
│ Entitle.. │                                                  │
│ Config    │                                                  │
│ Flags     │                                                  │
│ Billing   │                                                  │
│ Demos     │                                                  │
│ Audit     │                                                  │
│ Data srcs │                                                  │
│───────────│                                                  │
│ Settings  │                                                  │
│ Docs ↗    │                                                  │
└───────────┴──────────────────────────────────────────────────┘
```

Sidebar width 240px; top bar 50px; matches TraffiCure design system (Inter, Lucide 1.75 stroke, white bg, thin borders).

### 5.2 Route tree

```
/                       → redirects to /dashboard
/dashboard              → Global dashboard (Step 21)
/customers              → list (Step 18)
/customers/:id          → detail (Step 18)
/orgs/:id               → detail (Step 19)
/users                  → user search
/users/:id              → user detail
/entitlements           → per-customer table
/config                 → Configuration Registry (Step 21)
/config/:key            → key detail + values
/flags                  → list
/flags/:key             → rules editor
/billing                → invoices, plans
/demos                  → partner demo mgmt
/audit                  → event explorer
/data-sources           → health panel
/settings/profile       → own MFA, sessions
/settings/admins        → internal admin user mgmt (super_admin only)
```

### 5.3 Auth flow

- Login screen: email + password; then MFA challenge (TOTP).
- Google Workspace OIDC alt button; restricted to `@trafficure.ai`.
- After auth: fetch `/me` → if `platform_role == 'user'` → 403 page "This is the internal admin console. No access."
- Session: `auth_method`, `amr`, `customer_context_id` (null in Admin; all endpoints are cross-customer).
- Idle timeout: 30 min; absolute 8 hours.

### 5.4 Command-K palette

- Ctrl/Cmd-K anywhere.
- Search customers, orgs, users, flag keys, config keys, audit events (last 30 days).
- Results group by type with keyboard nav.
- Backed by `GET /admin/search?q=...` which fans out with scoring.

### 5.5 Impersonation banner

Persistent red strip (56px, sticky top, above top bar) when `session.impersonated_from != null`:
"Impersonating **user@customer.com** (Pune Traffic Dept) — started 14:22, expires 14:52. [End impersonation]"

Every network response during impersonation tagged so the banner auto-refreshes countdown.

### 5.6 Nav permission gates

Each item gated with `<Gate perm="...">` from Step 06:

- Customers → `admin.customers.manage` OR `admin.audit.view`
- Config → `admin.config.edit`
- Flags → `admin.flags.manage`
- Audit → `admin.audit.view`
- Impersonate (not nav, on user row) → `admin.impersonate`

Support_readonly sees read-only versions; edit buttons hidden not disabled.

### 5.7 Empty states

Every list page has a well-designed empty state with the exact action to take. "No customers yet → Create one" button links to Step 18 wizard.

### 5.8 Error pages

- 403: "You don't have access to this page"
- 404: "Not found"
- 500: "Something went wrong. Request ID: req\_... Copy to support."

### 5.9 Dev experience

- `yarn admin:dev` runs app against mock API from Step 16.
- Storybook for component library.
- Playwright e2e smoke on login → customer list → customer detail.

### 5.10 Two-admin confirmation token API

Destructive actions (customer.archive, legal_hold.release, etc.) require confirmation by a second admin. This is enforced via a confirmation token mechanism:

**Table:** `platform.confirmation_token`

```sql
CREATE TABLE platform.confirmation_token (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action              VARCHAR(64) NOT NULL,         -- 'customer.archive', 'legal_hold.release', etc.
  context_json        JSONB NOT NULL,               -- {'customer_id': '...', 'reason': '...'}
  created_by_user_id  UUID NOT NULL REFERENCES enterprise.user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,         -- 15 minutes from creation
  approved_by_user_id UUID REFERENCES enterprise.user(id),
  approved_at         TIMESTAMPTZ,
  rejected_at         TIMESTAMPTZ
);
CREATE INDEX idx_token_pending ON platform.confirmation_token(expires_at) WHERE approved_at IS NULL AND rejected_at IS NULL;
```

**Endpoints:**

- `POST /admin/confirmation-tokens` — called by initiating admin with `{action, context_json}` → returns token ID and shareable link `/confirm/:token_id`.
- `GET /admin/confirmation-tokens/:id` — retrieve token details (initiator, action, context, expiry, status). Requires `admin.confirm_action` permission. Token remains readable until expiry + 1 hour.
- `POST /admin/confirmation-tokens/:id/approve` — called by second admin with optional `{notes}` → sets `approved_by_user_id` and `approved_at`, executes the original action immediately, emits audit event. Returns error if already approved, rejected, or expired.
- `POST /admin/confirmation-tokens/:id/reject` — called by second admin → sets `rejected_at`, does NOT execute action. Initiator can create a new token.

**Token lifecycle:**

- **Created:** `created_at`, starts 15-minute countdown.
- **Approved:** `approved_at` set; action executes synchronously; token becomes historical.
- **Expired:** after 15 min with no approval → next access returns 410 Gone with `confirmation_token.expired`.
- **Rejected:** second admin rejects; token historical.

**Error codes (register in Step 23):**

- `confirmation_token.not_found` — token ID doesn't exist (400).
- `confirmation_token.expired` — token past expiry_at (410).
- `confirmation_token.already_approved` — action already executed (409).
- `confirmation_token.already_rejected` — token previously rejected (409).
- `confirmation_token.self_approval_forbidden` — same user cannot both initiate and approve (403).

**Audit events:**

- `platform.confirmation_token.created{action}` — token generated.
- `platform.confirmation_token.approved{action}` — action executed by second admin.
- `platform.confirmation_token.expired{action}` — token past TTL.
- `platform.confirmation_token.rejected{action}` — second admin rejected.

## 6. Enforcement / Runtime

- Admin bundle NEVER imported into customer product bundle (CI check: disallow `@lepton/admin-ui` in product).
- CSP header restricts origins; admin cookies SameSite=Strict, Secure, HttpOnly.
- Admin on separate origin so CSRF from product domain is impossible.

## 7. Configuration surface

- `admin.idle_timeout_minutes`, `admin.absolute_hours`, `admin.google_oidc_domain`.

## 8. Migration plan

1. Stand up `apps/admin/` scaffold.
2. Implement shell + auth against real API.
3. Drop placeholder pages for Steps 18–21 behind flags.

## 9. Acceptance criteria

1. Login → MFA → dashboard works end-to-end.
2. Non-admin user redirected to 403 page with support link.
3. Impersonation banner shows countdown and ends session cleanly on click.
4. Command-K returns a Pune customer within 300 ms on staging.
5. Sidebar items respect role gates (support_readonly: no Config/Flags; ops_admin: no Flags).
6. Playwright smoke green in CI.

## 10. Test plan

- Playwright: login, MFA enroll, impersonation start/end, switch-customer.
- Axe accessibility pass (no criticals).
- Bundle size budget: admin initial JS < 250KB gzipped.

## 11. Edge cases

| Case                                     | Behavior                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| User has MFA grace unmet                 | App renders only the MFA enroll flow; no nav.                              |
| Session expires mid-action               | 401 handler refreshes session or redirects to login preserving path.       |
| Two tabs open, one ends impersonation    | Broadcast channel syncs banner in other tab within 2s.                     |
| User's platform_role changes mid-session | Server sets pubsub flag; next request triggers `/me` refresh; nav adjusts. |

## 12. Observability

- `admin_page_views_total{route}`.
- `admin_api_errors_total{code}`.
- RUM: TTI for top 5 routes.

## 13. Audit events

- `admin.login`, `admin.logout`, `admin.session_expired`.

## 14. Open questions

- Q1. Do we want a "read-only weekend mode" for all admins (no writes)? Recommendation: not now; super_admin can flip `flags.admin_readonly` instead.
- Q2. Do we need a "second pair of eyes" confirmation flow for destructive ops (churn, archive, drop schema)? Recommendation: yes — ship a `require_two_admin_confirm` config per action, enforced via signed tokens. Start with `customer.archive` and `legal_hold.release`.
