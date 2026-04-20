# Step 18 — Lepton Admin: Customer CRUD + Detail

**Phase:** 3A
**Depends on:** 16, 17
**Blocks:** 22
**Owner:** Frontend
**Estimated effort:** 6 days

---

## 1. Goal

Ship the most frequently used pages in Lepton Admin: the Customers list, the 6-step Create Customer wizard (already mocked in `mockups/Create_Customer_Flow.html`), and the Customer Detail page (8 tabs: Overview, Orgs, Members, Entitlements, Billing, Security, Retention, Audit).

## 2. Why now

All backing APIs exist post-Step 16. Customer management is the daily workflow for the ops team and the entry point for every other screen.

## 3. Scope

### In scope

- `/customers` list with filters (state, tenant, customer_type, region, created_at).
- `/customers/new` wizard — 6 steps from the approved mockup.
- `/customers/:id` detail with 8 tabs.
- Lifecycle action buttons (activate/suspend/reactivate/churn/archive) wired to Step 07 FSM.
- Two-admin confirmation for destructive actions (from Step 17 Q2).

### Out of scope

- Cross-customer reports — Step 21 global dashboard handles it.
- Bulk operations — Phase 2.

## 4. Deliverables

1. `/customers`, `/customers/new`, `/customers/:id` routes.
2. Reusable components: `<CustomerStateBadge>`, `<LifecycleActions>`, `<EntitlementEditor>`, `<MembersTable>`, `<InvoicesTable>`.
3. Playwright coverage for full wizard and each lifecycle transition.

## 5. Design

### 5.1 Customers list

Table columns: Name, Slug, Type, Region, State (badge), Orgs count, Active seats, MRR, Created, Actions (kebab).

Filters in sticky toolbar; persist in URL. Default sort `created_at desc`. Virtualized list (20k customers safe).

Row click → `/customers/:id`. Kebab: quick actions (suspend, open billing, copy slug).

### 5.2 Create Customer wizard (6 steps)

Matches `mockups/Create_Customer_Flow.html`:

1. **Customer Basics** — name, slug (auto from name, editable, regex-validated), type (enterprise/poc/partner_demo/internal), tenant (dropdown), region, primary_contact_email, legal_name, tax_country, tax_id.
2. **Entitlements** — plan picker (radio) shows inherited entitlements; override individual limits with inline editors. Inline "what this means" explainers.
3. **First Organization** — name, city, country, timezone, geo_center (lat/lon), bbox (optional; drawn on Leaflet mini-map).
4. **Admin Invites** — up to 5 emails + role_template (default customer_admin) + "send now" checkbox.
5. **Data Provisioning** — choose provider (here/tomtom/custom_webhook/custom_sftp), credential_ref (dropdown of existing creds for that customer OR "create new" button), poll_interval, bbox; [Test connection] inline with result.
6. **Review & Activate** — full summary; "Activate customer" button triggers:
   - `POST /admin/customers` → creates customer (state=draft)
   - `POST /admin/customers/:id/orgs` → first org
   - `POST /admin/customers/:id/invites` → admin invites
   - `PUT  /admin/orgs/:id/data-source` → data source config
   - `POST /admin/customers/:id/activate` → draft→provisioning
   - Backend fires provisioning job; UI polls `/admin/customers/:id` until `active`.

   If any step fails: show error with retry; offer "save as draft" to resume later.

All 6 steps save progress to `platform.customer_draft` so wizard can be resumed across sessions.

### 5.3 Customer Detail tabs

**Overview**

- Header: name, slug, state badge, `<LifecycleActions>`, "Impersonate a user" button.
- Stat cards: Orgs (N), Members (N), MRR, Ask AI this month, Retention class.
- Recent activity (audit log last 10 rows).
- Health mini-panel: data-source state per org (colored dot each).

**Orgs**

- Table of orgs for this customer. Inline state badge, data source, health, "Open →".
- "Add Organization" button → wizard (reuses step 3 of new customer flow).

**Members**

- Table: user, email, role_template, scope, last_active, MFA status.
- Invite button → modal with role + scope picker.
- Row actions: change role, revoke membership.

**Entitlements**

- Per-limit table: key, plan value, current override (editable), usage this period, % used.
- Module toggles (`modules.*`) with confirmation.
- "Reset to plan defaults" button.

**Billing**

- Billing account form (editable).
- Subscription: current plan, next renewal, change-plan action.
- Invoices table with status badges, PDF link, mark-paid, void.
- Usage chart (last 12 months).

**Security**

- SSO config (kind, metadata, enforced toggle).
- IP allowlist editor.
- Session idle / absolute editors.
- MFA policy summary.

**Retention**

- Per-data-class current retention days + effective source (plan default / override).
- Legal-hold panel: active holds, [Create hold], [Release].
- Last pruner run summary.

**Audit**

- Filtered audit log for this customer — scoped `customer_id=:id`.
- Columns: time, actor, action, before→after diff, request_id.
- Export CSV.

### 5.4 Destructive action confirmations

Churn / archive / legal-hold-release all require two-admin confirmation:

1. Admin A clicks action → modal asks for reason + generates a pending token.
2. Modal shows "Send this token to another admin for approval: TOKEN-xxxx".
3. Admin B goes to `/confirm/:token`, sees full action context, approves.
4. Action executes; audit log records both admins.

Token expires in 15 minutes.

### 5.5 Lifecycle action button rules

| Current state | Visible actions       |
| ------------- | --------------------- |
| draft         | Activate, Discard     |
| provisioning  | (none — wait)         |
| active        | Suspend, Churn        |
| suspended     | Reactivate, Churn     |
| churned       | Archive (after grace) |
| archived      | (none)                |

Each button calls the corresponding FSM endpoint from Step 16.

## 6. Enforcement / Runtime

- All edits use PATCH with optimistic UI + rollback on error.
- Every write shows a toast with request_id for support correlation.
- Forms validate client-side using the OpenAPI schemas from Step 16.

## 7. Configuration surface

- `admin.require_two_admin_confirm` list defaults to `['customer.archive','legal_hold.release']`.

## 8. Migration plan

1. Ship list + detail read-only first (safest).
2. Ship lifecycle actions gated behind flag.
3. Ship wizard; run 3 staged test creations on staging before enabling in prod.
4. Migrate the 6 live customers from their ad-hoc draft records into the wizard schema.

## 9. Acceptance criteria

1. Creating a customer through the wizard results in: `customer` row (state=active), 1 org (state=active), invites sent, data source configured, dashboard data flowing within 5 min.
2. Suspending a customer: all active sessions terminated within 30s; ingestion paused; banner visible in product if user still logged in (stale tab) on next request.
3. All tabs load <500ms on staging with the largest customer.
4. Two-admin confirm blocks single-admin archive: (a) Single admin clicking Archive on an active customer shows modal requesting reason + token generation. (b) Second admin navigates to /confirm/:token, sees full action context. (c) If second admin approves, action executes. (d) If only one admin acts, action remains pending after 15 min; token expires; revert UI. Verify via audit log: both admin user_ids recorded for the action.
5. Entitlement override takes effect on next entitlement check (via Step 04 cache invalidation).

## 10. Test plan

- Playwright: create → suspend → reactivate → churn → archive full cycle.
- Each tab snapshot test.
- Cross-browser: Chrome, Safari, Firefox latest.
- Load: customer with 500 orgs renders Orgs tab <2s.

## 11. Edge cases

| Case                                         | Behavior                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Slug collides                                | Server 409; wizard inline error, suggests next free slug.                                           |
| Wizard step 5 test fails                     | Allow user to proceed with warning; mark data source `pending`; health goes red after provisioning. |
| User archives customer with active invoices  | Block with 409 `billing.open_invoices_exist`; link to Billing tab.                                  |
| Two admins both click Suspend simultaneously | Second gets 409 `state_already_suspended`; toast "already suspended".                               |

## 12. Observability

- `admin_customer_actions_total{action,result}`.
- `admin_wizard_completion_rate_percent`.
- `admin_wizard_drop_step_count` histogram (which step did users abandon).

## 13. Audit events

- Every tab mutation emits the correct action (`customer.updated`, `entitlement.set`, `legal_hold.created`, etc.).

## 14. Open questions

- Q1. Should slug be immutable post-activation? Recommendation: yes — schema name depends on it. Enforce via API 409.
- Q2. Show live-ingestion rows count on Overview? Recommendation: yes — sampled once per 60s from Step 09 health.
