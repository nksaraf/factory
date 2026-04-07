# Product Requirements Document

# **Portal & Dashboard Layer (Progressive Authorization Management Surfaces)**

---

# 1. Purpose

The Portal & Dashboard Layer provides the human interfaces to Platform Fabric's authorization, identity, tenancy, and governance systems.

It comprises four portals:

- **User Portal** — self-service for end-users of products (Trafficure, NetworkAccess, SmartMarket)
- **Org Admin Console** — tenant administration for customer organization administrators
- **Platform Admin Console** — Factory-scope operations for the internal platform team
- **Developer Portal** — API consumers and module developers building integrations

These portals are the presentation layer for the Control Plane's authorization model. Every screen, form, and dashboard is grounded in the authorization stack: entitlements, scopes, role bindings, relationship tuples, ABAC policies, data classifications, and quotas.

The portals do **not**:

- Own authorization logic (Control Plane owns evaluation)
- Own identity storage (Control Plane owns principals)
- Own entitlement lifecycle (Commerce Plane owns)
- Own deployment operations (Fleet Plane owns)
- Implement product business logic (Service Plane owns)

---

# 2. Design Principles

1. **Progressive disclosure is the primary UX principle.** Complexity is revealed as the customer's needs grow, never before.
2. **Visible features = entitlement ∩ module capabilities ∩ activation state.** No feature appears unless all three conditions are met.
3. **Portals consume Control Plane APIs — they never bypass them.** Every action flows through the authorization stack.
4. **The scope tree is the navigation spine.** Authorization management is always grounded in the scope hierarchy: site → organization → namespace → module_instance → resource.
5. **Every authorization concept must be explainable in context.** Denied actions show why. Granted access shows through what path. No opaque 403s.
6. **Air-gapped Sites must have fully functional portals.** No portal feature may depend on Factory connectivity at runtime.
7. **Audit everything.** Every portal action that changes authorization state produces an audit event.

---

# 3. Core Concepts

## 3.1 Complexity Tiers

A customer's authorization sophistication exists on a gradient. The portal adapts to the customer's position on this gradient.

### Tier 0 — Solo / Tiny Team

One user or a handful. No org structure. Authorization is invisible. The user is the admin and has access to everything in their namespace. The portal shows profile, security, billing. No roles UI, no scope tree, no policies.

### Tier 1 — Small Team with Roles

5–30 users. One org, one namespace. The admin invites members and assigns one of 3–4 roles (admin, editor, viewer, plus product-specific defaults). The portal shows a flat member list with role dropdowns. No mention of namespaces, scopes, tuples, or policies.

### Tier 2 — Growing Org with Multiple Workspaces

30–200 users. Multiple namespaces (per-department, per-project, per-environment). Groups become useful. Namespace management, group-based role assignment, and basic quota visibility appear. Scopes are presented as "workspaces" — not as an abstract hierarchy.

### Tier 3 — Enterprise with Governance

200+ users. SSO/SCIM. Custom roles beyond defaults. Policies: IP allowlisting, MFA enforcement, session limits. Data classification if the product handles sensitive data. Full audit log. Custom role editor, policy builder, classification labels.

### Tier 4 — Regulated / Sovereign / Air-Gapped

Full governance. Mandatory data classification. Complex ABAC policies. Relationship tuples managed directly for fine-grained resource access. Quota partitioning across namespaces. Compliance reporting and export. Full authorization topology management.

---

## 3.2 Tier Progression Drivers

Three forces push a customer up the gradient:

**Entitlement** — Commerce-driven gate. If a plan does not include SSO, custom roles, or policy management, those features are absent from the portal — not greyed out, not behind an upgrade banner, absent. This is the coarsest disclosure mechanism.

**Module Authorization Declaration** — each module declares what authorization capabilities it uses (resource types, default roles, quota types, classification support). The portal surfaces authorization UI only for capabilities active modules declare. If no module uses classifications, the classification UI does not exist.

**Admin Activation** — features activate when the admin first uses them. Creating a second namespace reveals the namespace switcher. Creating a custom role reveals the role editor. Enabling SSO expands the federation section.

---

## 3.3 Module Authorization Declaration

Every module registers an authorization manifest as part of its Service Plane SDK integration. This manifest drives portal composition.

```yaml
module: smartmarket-geo-engine
authorization:
  resource_types:
    - name: dataset
      actions: [read, write, share, delete, archive]
      supports_classification: true
    - name: spatial_query
      actions: [execute, schedule]
      supports_classification: false
    - name: pipeline
      actions: [read, execute, delete]
      supports_classification: false

  default_roles:
    - name: geo-analyst
      grants:
        dataset: [read]
        spatial_query: [execute]
        pipeline: [read]
    - name: geo-editor
      grants:
        dataset: [read, write, share]
        spatial_query: [execute, schedule]
        pipeline: [read, execute]
    - name: geo-admin
      inherits: geo-editor
      grants:
        dataset: [delete, archive]
        pipeline: [delete]

  quota_types:
    - storage
    - spatial_query_count
    - dataset_count

  features:
    classification: true
    custom_roles: true
    resource_level_access: true
```

A simpler module declares less:

```yaml
module: basic-dashboard
authorization:
  resource_types: []
  default_roles:
    - name: viewer
      grants: {}
    - name: editor
      grants: {}
  quota_types: []
  features:
    classification: false
    custom_roles: false
    resource_level_access: false
```

The portal reads these manifests and constructs its UI surface accordingly. A namespace running only `basic-dashboard` gets the Tier 1 admin experience. A namespace running `smartmarket-geo-engine` gets classification UI, resource-level access management, and quota partitioning — but only for the resource types that module declared.

---

## 3.4 Authorization Capability Surface

The Control Plane exposes a resolved feature surface per scope:

```
GET /namespace/{id}/authorization-capabilities

Response:
{
  "resource_types": [...],
  "available_roles": [...],
  "quota_types": [...],
  "features": {
    "classification": true,
    "custom_roles": true,
    "resource_level_access": true,
    "policy_management": true,
    "sso": true,
    "scim": true
  },
  "activation_state": {
    "namespaces_count": 3,
    "custom_roles_defined": 2,
    "policies_active": 5,
    "sso_configured": true,
    "scim_configured": true,
    "classifications_in_use": ["pii", "confidential"]
  }
}
```

Portals consume this endpoint to determine what to render.

---

# 4. Functional Requirements

---

# 4.1 User Portal

The end-user's self-service surface. Adapts from minimal (Tier 0) to full governance visibility (Tier 4).

## 4.1.1 Profile & Security

All tiers. Standard account management.

- View and edit profile (name, email, avatar, phone, timezone, locale)
- Email change triggers re-verification
- Password management (change, strength indicator, org policy display)
- MFA enrollment and management (TOTP, passkey/WebAuthn, SMS if enabled)
- Passkey management (register, name, view last-used, delete)
- Active sessions list (device, browser, IP, location, last active, sign-out per session, sign-out all)
- Login history (timestamp, IP, location, method, success/failure)
- Connected OAuth accounts (link, unlink, last used)
- Security notifications (new device login, password change, MFA change)
- Account deletion request (GDPR right-to-erasure with confirmation workflow)

## 4.1.2 My Access

Progressive. Adapts to the customer's authorization complexity.

### Tier 0–1

Single line: "You're an admin/editor/viewer of [org name]." No scope navigator. No detail.

### Tier 2

Namespace-level role display: "You're an editor in `Production` and a viewer in `Staging`." List of namespaces the user belongs to with role per namespace. No tuples, no policy visibility.

### Tier 3–4

Full effective permissions view:

- Scope navigator: org → namespaces → module_instances → resources
- Per-scope resolved permissions with source attribution ("via role `analyst` in namespace `samsung-traffic`" or "via group `data-team` → role `editor` on dataset `coverage-map`")
- Access request workflow: discover a scope the user lacks access to, submit request with justification, route to appropriate admin as a `control_workflow` approval, track status
- Denied action explanations: structured denial reasons showing which authorization layer denied and why ("You don't have `write` permission on `dataset:coverage-map`. Your current role `viewer` grants only `read`. Request access?")

## 4.1.3 My Quotas

Progressive. Appears when relevant.

### Tier 0–1

Invisible. Quotas exist but are not surfaced.

### Tier 2

Contextual: appears only when any quota type crosses 50% utilization. Shows namespace-level consumption: storage used/allocated, API calls consumed/limit.

### Tier 2+

Full quota dashboard per namespace and per module_instance. Per-module breakdown. Approaching-limit warnings. Projected exhaustion date.

## 4.1.4 My Principals

Progressive. Service accounts and API keys appear when the user creates them or when the org enables programmatic access.

### Tier 0–1

Not shown. No service accounts, no API keys.

### Tier 2+

- Personal API keys: create, list, revoke. Show prefix, creation date, last used, expiration. Copy-once-on-creation. Show what the key grants access to (which principal, which scopes, which permissions).
- OAuth grants: list of third-party apps authorized via OAuth consent. App name, scopes granted, when authorized, revoke.

### Tier 3+

- Service accounts created by this user: name, role bindings, API keys attached, last activity.
- Agent identity visibility (if agents operate in user's namespaces): agent name, type, capabilities, what they've done.

## 4.1.5 Organization Context

All tiers (except Tier 0 which has no org).

- Organization membership list: orgs the user belongs to, role in each, join date
- Org switcher (if user is in multiple orgs — common in multi-product model)
- Pending invitations: org name, inviter, role offered, expiration
- Leave organization (with confirmation, guard against last-owner-leaving)

## 4.1.6 Authentication Constraint Display

Tier 2+. When org admin or policy requires specific auth methods for the user's role.

- "Your role `namespace-admin` requires passkey authentication. Enroll a passkey to maintain access."
- "Your organization requires MFA for all members. Enable MFA by [date] to avoid access interruption."

---

# 4.2 Org Admin Console

Tenant administration. The primary surface for authorization topology management. Adapts from a simple member list (Tier 1) to full governance (Tier 4).

## 4.2.1 Dashboard

Adapts to tier.

### Tier 1

Member count, recent activity (who joined, who was invited). Single card layout.

### Tier 2

Member count, active sessions, namespace count, recent security events summary.

### Tier 3

Member count, MFA adoption rate, SSO status (configured/not), API key count, quota utilization widget, policy compliance score.

### Tier 4

Full security health scorecard: member count by auth method, MFA adoption, SSO coverage, classification coverage, policy compliance, quota utilization heat map, recent authorization denials.

## 4.2.2 Member Management

All tiers (Tier 1+). The core experience. Adapts in complexity.

### Tier 1

Flat member list. Columns: name, email, role (dropdown: admin/editor/viewer or module defaults), last active. Invite button (email, single or bulk). Remove button. No groups, no scopes, no advanced options.

### Tier 2

Member list gains a namespace context selector: "Showing members of: `Production`" with switcher. Or tabbed view with per-namespace tabs plus an "All Members" tab showing role-per-namespace matrix. Group affordance appears when member count exceeds ~15: "You have 28 members. Create groups to manage access in bulk?" First group creation adds "Groups" to the sidebar. Invite workflow gains namespace selection: "invite to which workspace?"

### Tier 3

Member detail view: individual roles, teams/groups, active sessions (admin can force-terminate), login history within org, API keys issued, MFA enrollment status. Admin actions: change role, suspend, remove, reset MFA. Impersonation (with audit trail, visual indicator, time limit). Teams/groups with role binding to groups at specific scopes. SCIM-synced group mapping.

### Tier 4

Full principal lifecycle:

- Users: invite, manage, suspend with scope-aware role binding on invite
- Service accounts: create org-scoped service accounts with name, description, owner, role bindings per scope, API keys, lifecycle controls (disable, rotate, expire)
- Agent identities: visibility into agents operating in org namespaces, permissions, execution history
- Groups: org-scoped and namespace-scoped, containing all principal types (users, service accounts, agent identities)
- Bulk operations: CSV import, bulk role changes, bulk group assignment

## 4.2.3 Scope Management

Tier 2+. Appears when the org has or creates multiple namespaces.

### Tier 2

Namespace list presented as "Workspaces." Create, rename, archive. Simple cards showing member count and module count per namespace.

### Tier 3

Scope tree: org → namespaces → module_instances. Clicking any node shows: who has access, what roles are bound, what policies apply, what quotas are allocated.

### Tier 4

Full scope hierarchy: org → namespaces → module_instances → datasets. Per-node: principal count, role binding count, active policies, quota allocation, classification summary. Primary navigation for all authorization management.

## 4.2.4 Role Management

Progressive. Default roles are always present. Custom roles require entitlement + admin activation.

### Tier 1

Role assignment only. Pick from module-provided defaults (admin, editor, viewer, or product-specific). No role creation or editing. Roles are a dropdown on the member row.

### Tier 2

Same as Tier 1 but with scope-aware assignment: "User X is `editor` in namespace `Production`."

### Tier 3

Custom role creation:

- Role builder: select resource types → select allowed actions per resource type → name and describe
- Permission schema browser: all resource types and actions available in this site, grouped by module. Resource types include: `namespace`, `module_instance`, `dataset`, `pipeline`, `workflow_run`, `audit_event`, `quota_bucket`, `service_account`, `api_key`, `policy`, `role_binding` — plus module-declared types. Actions per resource type: `read`, `write`, `delete`, `execute`, `admin`, `grant`.
- Platform role templates available as starting points ("Traffic Analyst," "Geo Admin")

### Tier 4

Full role management:

- Role inheritance (custom role inherits from another role)
- Role binding audit trail: who granted what to whom, at what scope, when
- Role usage analytics: which roles are actually used vs. defined

## 4.2.5 Relationship Tuple Management

Tier 4 only. Appears only when active modules declare `resource_level_access: true` AND entitlement includes fine-grained access.

- Resource-level access grants: "User X is `owner` of dataset `coverage-map-2025`"
- Tuple browser: filter by subject, relation, or resource. Shows who-can-do-what-to-what within a namespace
- Bulk tuple management: "grant `reader` on all datasets matching pattern `coverage-*` to group `analysts`"
- Tuple provenance: created manually, via SCIM, via entitlement activation, or via module self-registration
- Tuple expiration: set time-limited access at the resource level

## 4.2.6 Policy Management

Tier 3+. Appears only when entitlement includes governance features AND admin enables "Advanced Security."

### Tier 3

- MFA policy: require MFA for all members or per-role. Allowed MFA methods. Grace period.
- Password policy: minimum length, complexity, rotation period, breach detection (HIBP).
- Session policy: maximum session duration, idle timeout, concurrent session limit, re-authentication interval.
- IP allowlisting: restrict login to specific IP ranges.

### Tier 4

Full ABAC policy management:

- Policy registry: all active policies with name, scope, conditions, effect
- Policy builder: structured conditions referencing:
  - Principal attributes (role, group, auth method, MFA status)
  - Request context (IP, time of day, device, geolocation)
  - Resource attributes (data classification, namespace, module type)
  - Action (which operation is being attempted)
- Example policies:
  - "Require MFA for any `write` action on datasets classified as `confidential`"
  - "Deny access from IPs outside CIDR `10.0.0.0/8`"
  - "Allow `execute` on `pipeline` only during business hours"
  - "Require passkey authentication for principals with role `namespace-admin`"
  - "Deny `delete` on any `dataset` — only `archive` permitted"
- Policy simulation: select a principal, action, resource, context → run authorization evaluation → show which policies matched, which allowed, which denied, final decision
- Policy conflict detection: flag when a new policy contradicts an existing one

## 4.2.7 Data Classification

Tier 3+ (partial) / Tier 4 (full). Appears only when active modules declare `supports_classification: true` AND entitlement includes data governance.

### Tier 3

- Classification label assignment: apply labels to datasets and module_instances
- Predefined labels: `public`, `internal`, `confidential`, `restricted`, `pii`, `regulated`
- Simple UI: dropdown on dataset detail page to select classification

### Tier 4

Full classification management:

- Custom classification schema: define additional labels, combinability rules, mandatory policies per label
- Classification rules: automatic classification policies ("any dataset containing columns matching `*email*`, `*phone*` is classified as `pii`")
- Classification impact preview: "if I change this dataset's classification from `internal` to `confidential`, which policies newly apply? Which users lose access?"
- Classification compliance dashboard: percentage of datasets classified, unclassified datasets, datasets with `pii` classification but missing MFA enforcement

## 4.2.8 Quota Administration

Tier 2+ (visibility) / Tier 3+ (management).

### Tier 2

Read-only dashboard: quota utilization per namespace. Appears as a widget when any quota type crosses 50%.

### Tier 3

- Entitlement ceiling view (read-only): total seats, storage, compute, API calls, per-module quotas from Commerce
- Namespace quota partitioning: divide org quota ceiling across namespaces
- Alert configuration: warn at 80%, restrict at 95%, block at 100%

### Tier 4

- Module-instance sub-partitioning: divide namespace quota to module_instances
- Per-namespace and per-module_instance monitoring: current usage, rate of consumption, projected exhaustion, active reservations
- Quota override request workflow: namespace admin requests reallocation from org admin via `control_workflow`

## 4.2.9 Identity Provider Configuration

Tier 3+. Appears only when entitlement includes SSO/SCIM.

SSO:

- Setup wizard: step-by-step SAML or OIDC configuration
- SAML: upload IdP metadata or enter SSO URL + certificate, download SP metadata, test connection
- OIDC: enter discovery URL or manual endpoints, client ID/secret
- SSO enforcement: toggle to require SSO for all members, grace period, bypass list for break-glass accounts
- Domain verification: DNS TXT record or HTML file, required before SSO enforcement
- IdP-initiated login configuration

SCIM:

- Generate SCIM token, show base URL, test provisioning
- Sync status: last sync, users provisioned, errors
- Group-to-role mapping: map IdP groups to org roles/teams

## 4.2.10 Entitlement Visibility

All tiers. Read-only.

### Tier 1

Current plan name. Seat count used/total.

### Tier 2

Module enablement list. Quota ceilings.

### Tier 3+

- Module enablement matrix per namespace
- Feature flags per module
- Entitlement history: when entitlements changed, what changed
- Entitlement → authorization mapping: "Module `geoanalytics` entitlement created these default role bindings, these quota buckets"
- Billing redirect to Commerce portal

## 4.2.11 Audit

Tier 2+ (basic) / Tier 3+ (full).

### Tier 2

Recent activity feed: who logged in, who was invited, who changed roles. Simple chronological list.

### Tier 3

Searchable, filterable audit log. Filters: actor, action type, resource, time range, IP, outcome. Event types: login, logout, role change, member added/removed, SSO changes, MFA changes, API key lifecycle, policy changes. CSV/JSON export.

### Tier 4

Full audit with authorization-layer filtering:

- Filter by scope, principal type, authorization outcome, policy that matched, role that granted access, relationship tuple evaluated
- Access change audit: dedicated view for authorization topology changes (role binding CRUD, tuple changes, policy changes, quota reallocations, classification changes)
- Scheduled exports (weekly/monthly) via email or webhook
- SIEM integration (forward to Splunk, Datadog via webhook or syslog)
- Compliance report generation (PDF)

---

# 4.3 Platform Admin Console

Factory-scoped operations console. Always shows the full governance surface, but adapts detail views to each tenant's tier.

## 4.3.1 Fleet Dashboard

- Total sites, total namespaces, total active users, total active sessions
- Authentication success/failure rates (global)
- SSO health across all configured IdPs
- System-wide MFA adoption
- Real-time signals: auth error rate spikes, brute-force indicators, unusual login patterns, cert expiry warnings, SCIM sync failures
- Site health matrix: per-site auth service health (up/down, latency, error rates). Air-gapped sites show last-known health.

## 4.3.2 Tenant Management

- Tenant directory: searchable list across all sites. Columns: org name, site, product, plan, member count, SSO status, MFA adoption, tier indicator (Tier 1–4), created date, status
- Tenant detail view: adapts to tenant's tier. Tier 1 tenant shows minimal detail. Tier 4 tenant shows full governance view.
- Tenant lifecycle operations: suspend (with restricted-mode configuration), reactivate, migrate between sites, decommission (with data retention enforcement). Each operation has confirmation workflow with impact summary.
- Tenant creation: manual provisioning for enterprise deals. Select site, configure namespace, assign entitlement bundle, set up initial admin.

## 4.3.3 Cross-Tenant Identity Operations

- Global user search: by email, ID, or name across all tenants. View full identity graph: which orgs, which roles, which auth methods, active sessions, login history, API keys
- Account merge: select source and target accounts, preview merge (org memberships, sessions, audit history), execute with full audit trail
- User lifecycle actions: force password reset, force MFA re-enrollment, lock/unlock account
- Impersonation: requires admin MFA step-up, creates distinct audit trail, time-limited, impersonated user notified, visually distinct session (banner in UI)

## 4.3.4 Authorization Topology

- Cross-site scope browser: Factory → Site → Organization → Namespace → Module Instance → Dataset. At any level: principal count, role binding count, active policies, quota allocation.
- Permission schema management: define resource types and actions available site-wide. When a new module introduces a new resource type, register it here.
- Platform role templates: define standard roles available across all orgs. Orgs use as-is or derive custom roles.
- Default policy management: site-wide policies that apply unless overridden by namespace-level policies. Constraint: org admins can make policies more restrictive but not less restrictive than platform defaults.

## 4.3.5 Authorization Debugging

- "Why can't user X do Y?": input user, action, resource. Walks full authorization stack: principal resolved → scope identified → entitlement checked → role bindings evaluated → relationship tuples checked → policies evaluated → quota checked. Per-layer pass/fail with specific entities involved.
- "Who can access resource Z?": input resource. Returns all principals with access, through what path (role binding, group membership, tuple), under what conditions (policy constraints).
- Relationship tuple graph visualization: for a namespace or cross-namespace. Nodes are principals and resources. Edges are relations. Highlight anomalies: orphaned tuples, over-privileged service accounts, agents with broad access.

## 4.3.6 SSO & Federation Operations

- IdP status dashboard: all SSO providers across all tenants. Health: last successful auth, error count, cert expiry dates. Alert on approaching cert expiry.
- SCIM sync monitor: all active connections, last sync, error logs, provisioned user counts.
- Federation debugging: SAML assertion viewer, OIDC token inspector, SSO flow trace (step-by-step for failed SSO logins).

## 4.3.7 Classification Governance

- Classification schema management: define global taxonomy (`public`, `internal`, `confidential`, `restricted`, `pii`, `regulated`, plus industry-specific like `phi`, `cjis`). Which labels can combine. Which labels trigger mandatory policies.
- Classification compliance dashboard: across all sites/namespaces. Percentage of datasets classified. Unclassified datasets. Datasets classified as `pii` missing MFA enforcement.
- Classification propagation rules: "if a dataset is `restricted`, derived materializations inherit the classification."

## 4.3.8 Security Operations

- Threat dashboard: brute-force attempts per tenant/IP, credential stuffing indicators, suspicious login patterns (impossible travel, device anomalies), failed MFA attempts.
- IP blocklist management: global blocklist across all tenants. Automatic blocking rules.
- Rate limiting dashboard: per-tenant auth rate limits. Adjust for specific tenants.
- Incident response: emergency org lockout, emergency user lockout, credential rotation triggers, break-glass account management.

## 4.3.9 Policy Governance

- Platform policy hierarchy: platform defaults → org overrides → namespace overrides. For any scope, show effective policy set.
- Policy constraint rules: constrain what org admins can do with policies ("org admins cannot create policies allowing unclassified data access without MFA").
- Policy drift detection: compare policies across similar namespaces. Flag drift.

## 4.3.10 Quota Operations

- Fleet-wide quota dashboard: utilization heat map across all sites and namespaces.
- Quota type registry: define quota types available system-wide (storage, compute, API calls, assistant runs, tile generation, dataset count). Unit of measurement, enforcement behavior, reserve/commit support.
- Quota forensics: trace reservation failures (which namespace, which module_instance, balance, reservation amount, concurrent reservation conflicts).

## 4.3.11 Global Audit & Compliance

- Global audit log: all auth events across all tenants and sites. Additional filters: site, tenant, product. Cross-tenant event correlation.
- Compliance reporting: per-tenant compliance reports for customer requests. Platform-wide compliance posture (SSO adoption, MFA distribution, password policy compliance).
- Data governance: pending GDPR deletion requests, data retention enforcement status, data residency mapping.
- Entitlement override: emergency direct modification of site's local entitlement state. Heavily audited. Requires MFA step-up.

---

# 4.4 Developer Portal

API consumers and module developers. Adapts to what the developer's module uses.

## 4.4.1 Authentication Guide

- Decision tree: "User? Use OAuth. Service? Use client credentials. Script? Use API keys."
- Code samples in TypeScript, Python, Go.
- OAuth app registration: choose type (confidential, public, trusted), configure redirect URIs, scopes, receive client_id/secret.
- API key creation: personal or org-scoped with scope restrictions.

## 4.4.2 Authorization SDK Documentation

Progressive. Shows only what the developer's module declares it uses.

- Permission check API: `checkPermission(principal, action, resource)`. How to specify scope, pass ABAC context, handle denials.
- Relationship tuple API: how modules create and manage tuples. Example: when SmartMarket creates a dataset, module creates `owner` tuple for creator, `reader` tuples for namespace members.
- Resource type registration: how modules declare protectable resources in the authorization manifest.
- Data classification SDK: how modules tag resources with classification labels.
- Quota SDK: how modules participate in reserve/commit pattern. Reserve before heavy operations, commit on success, rollback on failure.

## 4.4.3 OAuth Scope Registry

- Scope definitions grounded in resource types: `trafficure:dataset:read`, `smartmarket:pipeline:execute`, `platform:namespace:admin`. Each scope maps to resource_type × action pairs.
- Scope hierarchy: implication graph. `namespace:admin` implies `dataset:read` + `dataset:write` + `module_instance:read`.
- Dynamic consent based on classification: when an OAuth app requests scopes touching `confidential`+ resources, consent screen shows additional warnings.

## 4.4.4 Application Management

- Registered OAuth applications: client_id, redirect URIs, authorized user count, request volume, error rate.
- Edit configuration, rotate client secret, delete app.
- Webhook management: register for auth events (user.created, user.deleted, org.member.added). Delivery logs with retry status. Test delivery.

## 4.4.5 Testing & Debugging

- OAuth playground: interactive walk-through of OAuth flows. Authorize URL construction, code exchange, token response. Token decode and inspection.
- Authorization playground: simulate authorization checks against real permission schema. Input: principal, action, resource type, scope, context. Output: full evaluation trace.
- Policy test harness: test module-declared policies for conflicts and correctness.

## 4.4.6 SDKs & Libraries

- Client libraries: TypeScript (primary), Python, Go.
- Service Plane SDK auth integration: how modules receive authenticated context, how tenant_id flows, how to check permissions, how to emit auth audit events from module code.

---

# 5. Progressive Disclosure Mechanics

## 5.1 UI Composition Model

The portal is not one codebase with feature flags hiding sections. It is a dynamically composed UI driven by three inputs queried at render time:

1. **Entitlement manifest** — what features are commercially available to this tenant
2. **Module authorization declarations** — what authorization capabilities active modules use (via `/namespace/{id}/authorization-capabilities`)
3. **Activation state** — what the admin has configured (namespaces created, custom roles defined, policies authored, SSO enabled)

Components exist in the shared component library across all tiers. The composition layer decides what to render.

## 5.2 Sidebar Progression

The org admin sidebar grows as capabilities activate:

| Tier | Sidebar Items |
|------|--------------|
| 1 | Members, Settings |
| 2 | Members, Workspaces, Groups (after first group), Settings |
| 3 | Members, Workspaces, Groups, Roles, Security Policies, SSO, Audit, Settings |
| 4 | Members, Workspaces, Groups, Roles, Access Grants, Policies, Classifications, Quotas, SSO, SCIM, Audit, Compliance, Settings |

Items appear when their triggering condition is met, not before.

## 5.3 Empty States

When a feature is available but unused, show a contextual empty state:

- "Your organization uses default roles. Need more control? Create a custom role." — single CTA button, not a full role editor with zero rows.
- "No custom policies. Platform defaults apply to all members." — informational, not an empty table.

## 5.4 Contextual Promotion

When a user hits a limitation of their current tier, show the upgrade path at that moment:

- "You've invited 30 members. Groups can simplify management — available on Business plan."
- Not a persistent banner on every page. Appears once, at the moment of relevance.

## 5.5 Progressive Form Complexity

Role binding creation at Tier 1: pick person, pick role. Done.

Role binding creation at Tier 4: pick principal (user, service_account, group, agent), pick role, pick scope (namespace, module_instance, resource), set conditions (if policies enabled), set expiration. Presented as a minimal form with "Advanced" accordion for scope/conditions/expiration. Most users never expand the accordion.

## 5.6 Module-Aware Adaptation

If a customer has Trafficure (medium complexity) and SmartMarket (high complexity) in different namespaces under the same org, the admin console adapts per namespace. The Trafficure namespace shows simpler controls. The SmartMarket namespace shows classification UI, resource-level access, quota partitioning. Same admin, same console, different surface area per scope.

---

# 6. Cross-Portal Journeys

## 6.1 Enterprise Onboarding

Commerce creates account → Platform Admin provisions tenant → Platform Admin sends org admin invitation → Org Admin logs in, configures SSO (Org Admin Console: SSO wizard) → Org Admin configures SCIM (Org Admin Console: SCIM setup) → Users auto-provisioned via SCIM → Users access product via SSO (User Portal: seamless login).

## 6.2 Self-Serve to Enterprise Conversion

User signs up (User Portal) → creates org → invites teammates (Org Admin Console: Tier 1 member list) → uses product on trial → sales engages → enterprise deal closed → Platform Admin upgrades entitlements (Platform Admin Console) → Org Admin configures SSO → existing password users transitioned to SSO with grace period → sidebar expands as governance features activate.

## 6.3 New Module Enablement via Entitlement

Commerce adds SmartMarket to Samsung's entitlement → Fleet delivers bundle → Control Plane creates `module_instance` in namespace → creates default `quota_bucket` entries → creates default relationship tuples → Org Admin sees new module in scope tree (Org Admin Console) → new authorization capabilities surface in portal (classification UI, resource-level access) → Org Admin creates custom roles for SmartMarket resource types → assigns roles to groups at namespace scope → users access SmartMarket.

## 6.4 Dataset-Level Access Grant (Tier 4)

Analyst uploads dataset in SmartMarket (Service Plane) → module creates `dataset` entity → module creates `owner` relationship tuple for uploading principal → module applies auto-classification → classification triggers policy: `pii` requires MFA → analyst shares dataset with team (User Portal: share action) → creates `reader` tuples for group → team members access dataset (authorization checks: entitlement ✓, role binding ✓, tuple ✓, policy checks MFA ✓).

## 6.5 Quota Exhaustion Handling

Module attempts `reserve(compute, 50h)` → quota_bucket: 45h remaining → reservation fails → user sees: "Compute quota exhausted (45h remaining, 50h requested)" (User Portal) → contacts namespace admin → namespace admin sees quota dashboard (Org Admin Console) → namespace exhausted but org has reserve → requests reallocation from org admin via `control_workflow` → org admin approves → quota_bucket updated → user retries → success.

## 6.6 Security Incident Response

Platform Admin detects anomaly on threat dashboard (Platform Admin Console) → investigates via global audit log → identifies compromised account → locks user → alerts org admin → org admin forces MFA re-enrollment for affected members (Org Admin Console) → platform admin monitors for continued activity.

## 6.7 Over-Privileged Service Account Remediation

Platform Admin runs "who can access resource Z?" on sensitive dataset (Platform Admin Console) → discovers service account with `writer` tuple created 6 months ago for one-time migration → checks tuple provenance: created manually by former employee, no expiration → alerts org admin → org admin revokes tuple (Org Admin Console) → platform admin adds policy: "service account tuples on `restricted` datasets must have expiration."

## 6.8 Air-Gapped Policy Update

Platform Admin authors new platform-wide policy (Platform Admin Console) → policy included in release bundle → bundle transferred to air-gapped site → site Control Plane applies policy → org admin sees compliance dashboard showing non-compliant datasets (Org Admin Console, local) → Data Plane executes remediation → compliance dashboard updates.

---

# 7. API Surface

Portals consume Control Plane APIs. No direct database access.

## 7.1 Portal Composition APIs

```
GET  /namespace/{id}/authorization-capabilities
GET  /org/{id}/tier-indicators
GET  /site/{id}/module-declarations
```

## 7.2 Identity & Principal APIs

```
GET    /principal/me
PATCH  /principal/me
GET    /principal/me/sessions
DELETE /principal/me/sessions/{session_id}
GET    /principal/me/login-history
GET    /principal/me/effective-permissions?scope={scope_id}
POST   /principal/me/access-request

GET    /org/{id}/members
POST   /org/{id}/members/invite
PATCH  /org/{id}/members/{principal_id}
DELETE /org/{id}/members/{principal_id}

CRUD   /org/{id}/service-accounts
CRUD   /org/{id}/groups
CRUD   /org/{id}/groups/{group_id}/members
```

## 7.3 Role & Permission APIs

```
GET    /site/{id}/permission-schema
GET    /scope/{scope_type}/{scope_id}/roles
CRUD   /org/{id}/custom-roles
CRUD   /scope/{scope_type}/{scope_id}/role-bindings
GET    /principal/{id}/effective-roles?scope={scope_id}
```

## 7.4 Relationship Tuple APIs

```
CRUD   /namespace/{id}/tuples
GET    /namespace/{id}/tuples?subject={principal_id}
GET    /namespace/{id}/tuples?resource={resource_type}:{resource_id}
POST   /namespace/{id}/tuples/bulk
GET    /resource/{type}/{id}/access-list
```

## 7.5 Policy APIs

```
CRUD   /scope/{scope_type}/{scope_id}/policies
POST   /scope/{scope_type}/{scope_id}/policies/simulate
POST   /scope/{scope_type}/{scope_id}/policies/conflict-check
GET    /scope/{scope_type}/{scope_id}/policies/effective
```

## 7.6 Classification APIs

```
GET    /site/{id}/classification-schema
CRUD   /org/{id}/classification-labels
PATCH  /resource/{type}/{id}/classification
POST   /resource/{type}/{id}/classification/impact-preview
GET    /namespace/{id}/classification-compliance
CRUD   /org/{id}/classification-rules
```

## 7.7 Quota APIs

```
GET    /namespace/{id}/quotas
GET    /namespace/{id}/quotas/{type}/usage
PATCH  /org/{id}/quota-partitions
POST   /namespace/{id}/quota-reallocation-request
GET    /org/{id}/quota-entitlement-ceiling
```

## 7.8 Audit APIs

```
GET    /scope/{scope_type}/{scope_id}/audit-events
GET    /scope/{scope_type}/{scope_id}/audit-events/access-changes
POST   /scope/{scope_type}/{scope_id}/audit-events/export
```

## 7.9 SSO & SCIM APIs

```
CRUD   /org/{id}/sso-providers
POST   /org/{id}/sso-providers/{provider_id}/test
GET    /org/{id}/sso-providers/{provider_id}/status
CRUD   /org/{id}/scim-connections
GET    /org/{id}/scim-connections/{connection_id}/sync-status
```

## 7.10 Platform Admin APIs

```
GET    /admin/tenants
GET    /admin/tenants/{id}/tier-summary
GET    /admin/users/search?email={email}
POST   /admin/users/{id}/lock
POST   /admin/users/{id}/impersonate
POST   /admin/authorization/explain?principal={id}&action={action}&resource={resource}
GET    /admin/authorization/reverse-lookup?resource={type}:{id}
GET    /admin/fleet/health
GET    /admin/threat-dashboard
GET    /admin/classification-compliance
```

---

# 8. Data Model Additions

The portal layer does not own new entities. It consumes Control Plane entities defined in the Control Plane PRD and entity-relationship document. However, it introduces the following concepts:

## 8.1 Authorization Capability Surface (Computed)

Not stored. Computed at query time from:

- Active `module_instance` records per namespace
- Module authorization declarations (from Service Plane SDK registry)
- Active `entitlement_bundle` feature gates
- Admin activation state (counts of namespaces, custom roles, policies, SSO providers, classifications)

## 8.2 Access Request

```
access_request
--------------
access_request_id (PK)
requesting_principal_id (FK → principal)
target_scope_type
target_scope_id
requested_role_id (FK → role, optional)
requested_relation (optional, for tuple requests)
target_resource_type (optional)
target_resource_id (optional)
justification (text)
status (pending / approved / denied / expired)
approver_principal_id (FK → principal, nullable)
resolved_at (timestamp, nullable)
created_at (timestamp)
control_workflow_id (FK → control_workflow)
```

Relationship: `access_request` is a specialized `control_workflow` type.

## 8.3 Classification Entities

```
classification_label
--------------------
classification_label_id (PK)
name
description
severity_order (integer)
mandatory_policies (JSONB, optional)
site_id (FK → site)
created_by_principal_id (FK → principal)
created_at

classification_assignment
-------------------------
classification_assignment_id (PK)
resource_type
resource_id
classification_label_id (FK → classification_label)
assigned_by (principal_id or 'auto')
assignment_rule_id (FK → classification_rule, nullable)
namespace_id (FK → namespace)
created_at

classification_rule
-------------------
classification_rule_id (PK)
name
conditions (JSONB)
target_classification_label_id (FK → classification_label)
namespace_id (FK → namespace, or site-wide)
created_by_principal_id (FK → principal)
created_at
```

## 8.4 Policy (Extended)

The `policy` entity from the Control Plane data model is extended with structured conditions:

```
policy (extended)
-----------------
policy_id (PK)
name
scope_type (site / org / namespace / module_instance)
scope_id
effect (allow / deny)
conditions (JSONB):
  principal_attributes:
    roles: [...]
    groups: [...]
    auth_method: [...]
    mfa_status: required/any
  request_context:
    ip_ranges: [...]
    time_windows: [...]
    device_types: [...]
    geolocations: [...]
  resource_attributes:
    classifications: [...]
    resource_types: [...]
    namespaces: [...]
  actions: [...]
priority (integer)
created_by_principal_id (FK → principal)
created_at
updated_at
```

## 8.5 Tier Indicators (Computed)

Not stored. Computed from:

```
tier = f(
  member_count,
  namespace_count,
  custom_roles_count,
  policies_count,
  sso_configured,
  scim_configured,
  classifications_in_use,
  tuples_managed_manually,
  entitlement_tier
)
```

Used by Platform Admin Console for tenant-at-a-glance context.

---

# 9. Non-Functional Requirements

## Performance

- Portal page load < 2 seconds at Tier 1
- Authorization capability surface computation < 500ms
- Effective permissions resolution < 1 second for Tier 4 users with complex role graphs
- Audit log search < 3 seconds for queries spanning 30 days

## Accessibility

- WCAG 2.1 AA compliance across all portals
- Keyboard navigable scope tree
- Screen reader compatible authorization explanations

## Responsiveness

- User Portal: fully responsive (mobile, tablet, desktop)
- Org Admin Console: desktop-first, tablet usable, mobile limited to critical actions (member invite, session revoke)
- Platform Admin Console: desktop only
- Developer Portal: desktop-first with responsive documentation

## Air-Gapped Operation

- All four portals must function without Factory connectivity
- Platform Admin Console operates in "local site admin" mode when disconnected
- No CDN dependencies for portal assets — all bundled in site deployment

## Localization

- User Portal: internationalized (i18n-ready from Phase 1)
- Org Admin Console: English first, i18n Phase 2
- Platform Admin Console: English only
- Developer Portal: English only

---

# 10. Success Criteria

- Tier 1 org admin completes member invite + role assignment in under 60 seconds with no documentation
- Tier 3 org admin configures SSO end-to-end (including IdP-side) in under 30 minutes
- "Why can't user X do Y?" debugger returns a complete, correct explanation in under 5 seconds
- Zero authorization features visible to a tenant that are not both entitled and module-declared
- User Portal shows denied-action explanation for every 403 with actionable next step
- Policy simulation produces correct results for all authorization layer combinations
- Air-gapped site portals are fully functional with zero Factory dependency
- Sidebar item count matches tenant tier (Tier 1: ≤3 items, Tier 4: ≤14 items)

---

# 11. Explicit Boundaries

The Portal & Dashboard Layer does not:

- Own authorization evaluation logic (Control Plane owns)
- Own identity storage or token issuance (Control Plane owns)
- Own entitlement lifecycle (Commerce Plane owns)
- Own site provisioning or deployment (Fleet Plane owns)
- Implement product business logic (Service Plane owns)
- Define the permission schema (modules declare via authorization manifest; platform admin registers)
- Make authorization decisions — it renders the results of decisions made by the Control Plane

The Portal & Dashboard Layer does:

- Compose UI surfaces from entitlement + module declaration + activation state
- Provide human-readable explanations of authorization decisions
- Provide management interfaces for all Control Plane authorization primitives
- Provide progressive disclosure mechanics that match UI complexity to customer sophistication
- Provide debugging and simulation tools for authorization topology

---

# 12. Phased Delivery

## Phase 1 — Foundation

**User Portal:**
- Profile, security, MFA, sessions, login history
- Tier 0–1 "My Access" (single role display)
- Organization membership and switching

**Org Admin Console:**
- Tier 1 member management (flat list, role dropdown, invite)
- Basic settings (org name, logo)
- MFA toggle (single switch)
- Tier 1 audit (recent activity feed)
- Entitlement visibility (plan name, seat count)

**Platform Admin Console:**
- Tenant directory with search
- Cross-tenant user search
- Basic tenant lifecycle (suspend, reactivate)
- Fleet health dashboard

**Developer Portal:**
- Authentication guide with code samples
- OAuth app registration
- API key creation
- OAuth playground

## Phase 2 — Team Scale

**User Portal:**
- Tier 2 "My Access" (namespace-level roles)
- Contextual quota visibility (>50% utilization)
- Personal API key management
- Access request workflow
- Authentication constraint display

**Org Admin Console:**
- Tier 2 namespace management (create, rename, archive workspaces)
- Namespace-scoped member views
- Group creation and group-based role assignment
- Tier 2 quota dashboard (read-only)
- Tier 2 audit (searchable, filterable)
- SSO configuration wizard
- SCIM setup

**Platform Admin Console:**
- Authorization debugging ("why can't user X do Y?")
- SSO/SCIM status monitoring across tenants
- Account merge workflow
- Impersonation

**Developer Portal:**
- Permission check API documentation
- Quota SDK documentation
- OAuth scope registry with resource type mapping

## Phase 3 — Enterprise Governance

**User Portal:**
- Tier 3–4 effective permissions view with scope navigator
- Denied-action explanations with authorization trace
- Full quota dashboard
- Service account management
- Agent identity visibility

**Org Admin Console:**
- Tier 3 custom role creation with permission schema browser
- Tier 3 security policies (MFA, password, session, IP allowlist)
- Tier 3 data classification (label assignment, predefined labels)
- Tier 3 quota administration (namespace partitioning, alerts)
- Full role binding management with scope-aware assignment
- Tier 3 audit with export and SIEM integration
- Service account and agent identity lifecycle

**Platform Admin Console:**
- Full authorization topology (cross-site scope browser)
- Permission schema management
- Platform role templates
- Default policy management with constraint rules
- Policy drift detection
- Classification governance (global taxonomy, compliance dashboard)
- Security operations (threat dashboard, IP blocklist, incident response)
- Fleet-wide quota dashboard with forensics

**Developer Portal:**
- Relationship tuple API documentation
- Resource type registration documentation
- Data classification SDK documentation
- Authorization playground with policy testing

## Phase 4 — Full Governance

**User Portal:**
- Complete (no additional features beyond Phase 3)

**Org Admin Console:**
- Tier 4 relationship tuple management (browser, bulk, provenance, expiration)
- Tier 4 ABAC policy builder with simulation and conflict detection
- Tier 4 classification (custom schema, auto-classification rules, impact preview, compliance dashboard)
- Tier 4 quota sub-partitioning to module_instance level
- Tier 4 compliance reporting (PDF generation)

**Platform Admin Console:**
- Tuple graph visualization
- "Who can access resource Z?" reverse lookup
- Classification propagation rules
- Entitlement override (emergency)
- Global compliance reporting
- Policy hierarchy visualization

**Developer Portal:**
- Policy test harness
- Dynamic consent based on classification
- Advanced authorization patterns guide

---

# 13. Open Questions

1. **Tier calculation algorithm.** The tier is described as computed from member count, namespace count, custom roles, policies, SSO, SCIM, classifications, and entitlement. What are the exact thresholds? Should tiers be hard boundaries or a continuous gradient?

2. **Module authorization declaration versioning.** When a module's authorization manifest changes (new resource types, new actions), how does the portal handle the transition? Do existing role bindings and tuples referencing old resource types get migrated?

3. **Policy evaluation order.** When multiple policies apply (platform default + org override + namespace override), what is the evaluation strategy? Most-specific-wins? Most-restrictive-wins? Explicit deny overrides allow?

4. **Classification inheritance across data lineage.** The PRD mentions propagation rules ("derived materializations inherit classification"). How deep does inheritance go? What happens when a pipeline combines `confidential` and `public` datasets?

5. **Org admin self-service scope.** Can org admins create namespaces freely, or does namespace creation require platform admin approval or entitlement? This affects whether namespace management is self-service or gated.

6. **Portal hosting model for air-gapped sites.** Portal assets must be bundled in the site deployment. Does each site serve its own portal, or is there a shared portal infrastructure? How are portal updates delivered to air-gapped sites?

7. **Relationship tuple scale.** At Tier 4, with SmartMarket managing thousands of datasets per namespace, the tuple count could be very large. What are the performance implications of tuple enumeration for the "Who can access resource Z?" reverse lookup?

8. **Multi-product admin experience.** When an org has Trafficure and SmartMarket in different namespaces, and the authorization capabilities differ per namespace, should the admin console show a unified "highest common denominator" sidebar or truly adapt per-namespace context?

---

# Appendix A: Glossary

| Term | Definition |
|------|-----------|
| Complexity Tier | A classification (0–4) of a customer's authorization sophistication, determining portal surface area |
| Module Authorization Declaration | A YAML manifest registered by each module declaring its resource types, default roles, quota types, and feature usage |
| Authorization Capability Surface | The computed union of module declarations + entitlement gates + activation state for a scope |
| Scope | A node in the authorization hierarchy: site, organization, namespace, module_instance, or resource |
| Role Binding | An assignment of a principal (or group) to a role at a specific scope |
| Relationship Tuple | A (subject, relation, resource) edge in the ReBAC graph for fine-grained resource-level access |
| ABAC Policy | A contextual constraint evaluating principal attributes, request context, and resource attributes |
| Data Classification | A label (e.g., `pii`, `confidential`) assigned to a resource, used by ABAC policies for access decisions |
| Quota Partition | An allocation of the org's quota ceiling to a specific namespace or module_instance |
| Progressive Disclosure | The UX principle of revealing UI complexity only as the customer's needs and sophistication grow |
| Access Request | A workflow where a user requests access to a scope or resource they currently lack |
| Tuple Provenance | The origin of a relationship tuple: manual, SCIM, entitlement activation, or module self-registration |

## Appendix B: Portal Service Registry

```
User Portal:
  site-service-user-portal

Org Admin Console:
  site-service-org-admin-console

Platform Admin Console:
  factory-service-platform-admin-console

Developer Portal:
  factory-service-developer-portal
  site-service-developer-portal (local instance for air-gapped)
```

All portals are Service Plane deployments consuming Control Plane APIs.
