# Step 06 — Permissions Matrix & Role Templates

**Phase:** 1B
**Depends on:** 05
**Blocks:** 17, 18, 19, 20, 21
**Owner:** Backend + PM
**Estimated effort:** 2 days

---

## 1. Goal

Deliver the exhaustive grid of **permission × role = allow/deny** for every permission in the catalog, the canonical seed of role templates, and the code path that guarantees the grid is kept in sync. After this step, engineers building any UI can read this file and know immediately which buttons to hide/show/disable for any user.

## 2. Why now

Step 05 shipped the _mechanism_. This step ships the _policy_. The Lepton Admin UI and the product UI both need this grid to decide which controls to render.

## 3. Scope

### In scope

- The complete permission × role truth table as a Markdown document (this file, §6).
- A machine-readable `permission_matrix.yaml` committed in the repo, used to generate the seed and to validate at CI time.
- A test suite that asserts every role template in `platform.role_template` matches the YAML.
- A UI helper `hasPermission(subject, perm, target)` wired into the React app (`<Gate perm="x" target={...}>...</Gate>` component).

### Out of scope

- Custom (non-template) role creation — Phase 2.
- Deny-overrides — Phase 2.

## 4. Deliverables

1. `permission_matrix.yaml` at repo root under `/config/rbac/`.
2. Updated `seed_permissions_and_roles.sql` (regenerated from YAML).
3. `@lepton/rbac/react` package exporting `<Gate>` component.
4. CI check `test:matrix-drift` — fails if DB seed diverges from YAML.

## 5. Design

### 5.1 YAML shape

```yaml
# config/rbac/permission_matrix.yaml
version: 1
permissions:
  - key: alerts.view
    roles: [viewer, analyst, operator, org_admin, customer_admin]
  - key: alerts.acknowledge
    roles: [analyst, operator, org_admin, customer_admin]
  - key: alerts.configure
    roles: [org_admin, customer_admin]
  # ... every row
```

Generation flow: `yarn rbac:generate` reads YAML → writes `seed_permissions_and_roles.sql` → `yarn db:seed` applies → `yarn rbac:verify` diffs DB vs YAML and fails if mismatch.

### 5.2 `<Gate>` React component

```tsx
export function Gate({ perm, target, fallback = null, children }) {
  const allowed = useCan(perm, target)
  return allowed ? <>{children}</> : <>{fallback}</>
}
```

Used everywhere instead of prop-drilling role checks:

```tsx
<Gate perm="alerts.configure" target={{ orgId }}>
  <button>Edit rules</button>
</Gate>
```

## 6. The Matrix

Legend: ● = allow, ○ = deny. Scopes are enforced separately; this grid is permission-only.

| Permission                            | Viewer | Analyst | Operator | Org Admin | Customer Admin | Super Admin |
| ------------------------------------- | :----: | :-----: | :------: | :-------: | :------------: | :---------: |
| **Dashboard**                         |        |         |          |           |                |             |
| dashboard.view                        |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| **Alerts**                            |        |         |          |           |                |             |
| alerts.view                           |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| alerts.acknowledge                    |   ○    |    ●    |    ●     |     ●     |       ●        |      ○      |
| alerts.escalate                       |   ○    |    ○    |    ●     |     ●     |       ●        |      ○      |
| alerts.configure                      |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| **Analytics**                         |        |         |          |           |                |             |
| analytics.view                        |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| analytics.export                      |   ○    |    ●    |    ○     |     ●     |       ●        |      ○      |
| **Reports**                           |        |         |          |           |                |             |
| reports.view                          |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| reports.create                        |   ○    |    ●    |    ●     |     ●     |       ●        |      ○      |
| reports.schedule                      |   ○    |    ●    |    ○     |     ●     |       ●        |      ○      |
| reports.delete                        |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| **CityPulse / Ask AI**                |        |         |          |           |                |             |
| citypulse.view                        |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| ask_ai.query                          |   ○    |    ●    |    ●     |     ●     |       ●        |      ○      |
| **Incidents**                         |        |         |          |           |                |             |
| incidents.view                        |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| incidents.manage                      |   ○    |    ○    |    ●     |     ●     |       ●        |      ○      |
| **Members**                           |        |         |          |           |                |             |
| members.view                          |   ●    |    ●    |    ●     |     ●     |       ●        |      ○      |
| members.invite                        |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| members.remove                        |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| roles.assign                          |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| **Organizations** (within customer)   |        |         |          |           |                |             |
| orgs.view                             |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| orgs.create                           |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| orgs.update                           |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| orgs.archive                          |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| orgs.city_config.edit                 |   ○    |    ○    |    ○     |     ●     |       ●        |      ○      |
| orgs.data_source.edit                 |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| **Mobile**                            |        |         |          |           |                |             |
| mobile.notifications                  |   ○    |    ○    |    ●     |     ●     |       ●        |      ○      |
| **Billing / Entitlements / Branding** |        |         |          |           |                |             |
| billing.view                          |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| entitlements.view                     |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| branding.edit                         |   ○    |    ○    |    ○     |     ○     |       ●        |      ○      |
| **Lepton-internal admin**             |        |         |          |           |                |             |
| admin.customers.manage                |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.orgs.manage                     |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.users.manage                    |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.entitlements.manage             |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.flags.manage                    |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.audit.view                      |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.config.edit                     |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |
| admin.impersonate                     |   ○    |    ○    |    ○     |     ○     |       ○        |      ●      |

### 6.1 Notes on "Super Admin" column

Super Admin gets **only the admin.\* permissions** via platform*role, not the product permissions. To actually \_use* a customer's product (e.g. trigger an Ask AI query), a super_admin must use `admin.impersonate` to act as a real customer user. This keeps the audit trail clean (every product action is attributable to a real user).

### 6.2 Platform-role → admin permissions

| Permission                | `support_readonly` | `ops_admin` | `super_admin` |
| ------------------------- | :----------------: | :---------: | :-----------: |
| admin.customers.manage    |         ○          |      ●      |       ●       |
| admin.orgs.manage         |         ○          |      ●      |       ●       |
| admin.users.manage        |         ○          |      ●      |       ●       |
| admin.entitlements.manage |         ○          |      ●      |       ●       |
| admin.flags.manage        |         ○          |      ○      |       ●       |
| admin.audit.view          |         ●          |      ●      |       ●       |
| admin.config.edit         |         ○          |      ○      |       ●       |
| admin.impersonate         |         ○          |      ●      |       ●       |

## 7. Enforcement / Runtime

- Backend: `can()` from Step 05 consults `subject.memberships[].permissions` (flattened from template at login) and `subject.platformRole`.
- Frontend: `<Gate>` consults the same subject object, shipped in the initial `/me` response.
- Both are cache-invalidated on any role assignment change (Redis pub-sub key `rbac:subject:{userId}`).

## 8. Migration plan

1. Ship YAML + generator + seed.
2. Validate at CI.
3. Existing users keep their current templates via the 5.3 backfill in Step 05.

## 9. Acceptance criteria

1. The YAML compiles to SQL with zero diff against the checked-in seed.
2. Every cell in §6 has a passing integration test (total ≈ 36 × 6 = 216 assertions — generated from YAML).
3. `<Gate>` renders `children` iff `can` returns true.
4. `yarn rbac:verify` passes in CI.

## 10. Test plan

Generated test suite walks the YAML and, for each `{permission, role}` cell, constructs a synthetic subject and asserts `can()` returns the expected value.

## 11. Edge cases

- User with no memberships at all → `can()` returns false for all product permissions. Login still succeeds; the app shows "No access" empty state.
- User revoked mid-session → cache invalidation hit; next request returns 403.
- Role template edited by super_admin → all subjects with that template have cache invalidated.

## 12. Observability

- `rbac_template_drift_total` — 0 if YAML matches DB.

## 13. Audit events

- `role_template.updated` — any change to a template emits a diff.

## 14. Open questions

- Q1. Should Analyst get `incidents.manage`? Currently no. Confirm with ops lead.
- Q2. Operator has `mobile.notifications` but not `analytics.export`. Is that the intent for traffic control room staff? Confirm with Pune team.
