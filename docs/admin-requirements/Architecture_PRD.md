# TraffiCure — User Management & Multi-Tenancy Architecture PRD

**Version:** 2.0
**Date:** April 14, 2026
**Author:** Umang / Lepton Engineering
**Status:** Draft (revised after DB schema review and Better Auth decision)

### Changelog from v1.0

- Replaced Auth0 recommendation with Better Auth (already in use, schema already mature)
- Added Section 2: Current State Assessment based on live database schema review
- Added Section 6: Database Isolation Strategy (schema-per-customer for traffic data, shared for platform services)
- Reworked Entity Model to map onto existing `enterprise` schema instead of starting greenfield
- Introduced new concept: `customer` (the contract/business entity) added above Better Auth's `organization` to resolve naming conflict and add the missing hierarchy level
- Documented the critical `organization_id` gap in analytics tables and how schema-per-customer resolves it
- Updated Build Phases to account for existing work — foundation is ~40% done, not 0%

### Changelog from v2.0 (April 16, 2026) — Scope reconciliation with step PRDs

After writing the 20 step PRDs in this folder, the MVP scope was explicitly trimmed (see `_decisions/TRIM_APPLIED.md`). This PRD remains the north-star architecture document, but for **what ships in Phase 1 MVP**, the step PRDs (`01_…md` through `22_…md`) and `00_Implementation_Index.md` are the source of truth. Key deferrals now reflected inline:

- Step 12 (Retention/Data Lifecycle), 14 (Billing/Metering), 15 Full (SSO + WebAuthn + MFA policy engine), 23 (Error Catalogue Runbook), 24 (Observability Contract) are **deferred** to Phase 2+
- Step 15 is replaced by `15_Auth_Impersonation_Minimal.md` — TOTP MFA for internal staff + impersonation sessions only
- Phase 1 MVP effort re-estimated at **~13 weeks** (was 8 weeks) after accounting for realistic parallelism; see §9

---

## 1. Context & Problem Statement

TraffiCure is currently single-tenant. Every deployment is isolated, data is sourced from a single BigQuery subscription, and user management is manual. This works for early POCs but creates three problems as the business scales:

**For Lepton (internally):** No unified view of customers, deployments, usage, or health. Engineers onboard new cities through manual configuration. The CEO and pre-sales team have no visibility into whether pilots are being used, whether data pipelines are healthy, or what the state of any given deployment is. There is no standardized way to configure a new client — every setup is bespoke.

**For customers (externally):** No self-service user management. Customers can't control who has access to what, can't see their own usage, and must contact Lepton for every user change. This is acceptable during POCs but is a dealbreaker for production contracts.

**For the product (architecturally):** Business logic, feature access, and configuration are hardcoded rather than driven by configuration. Adding a new city, changing a client's module access, or adjusting alert thresholds requires code changes or database scripts. This makes the platform fragile and unscalable.

### Design Principle: The Lepton Admin as an Architectural Forcing Function

The Lepton Admin console is not just an operational tool — it is a discipline mechanism. If every configurable aspect of a deployment (modules, entitlements, thresholds, data sources, user limits) must be manageable through the admin console, then by definition, nothing can be hardcoded. Building the admin console forces the engineering team to build a properly configurable, API-driven platform. Every feature shipped must ask: "How does this get configured in the Lepton Admin?"

---

## 2. Current State Assessment

Before designing new architecture, this section documents what exists today. The team has already invested significant effort — much of the foundation is further along than the original v1.0 PRD assumed.

### 2.1 Database Schemas (Existing)

TraffiCure runs on a single PostgreSQL instance with six schemas, well-organized by concern:

| Schema             | Purpose                              | Key Tables                                                                                                                                               | Size Observation |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `enterprise`       | Auth + identity (Better Auth tables) | user, organization, member, organization_role, member_organization_role, platform_role, team, session, jwks, two_factor, oauth_application, verification | Small            |
| `public`           | Traffic data engine                  | road_segment, traffic_observation (126 GB), traffic_metric (34 GB), analytics_hourly_road_metrics (3.3 GB), alert, baselines, citypulse config           | Bulk of storage  |
| `road_hierarchy`   | Geographic structure                 | corridor, zone, division, junction, locality, road*master, segment*\*\_map                                                                               | Medium           |
| `admin`            | Notification + alert preferences     | notification_log, notification_tokens, organization_alert_preferences                                                                                    | Small            |
| `raw`              | Raw ingestion data                   | junction_mapping, monarch_division                                                                                                                       | Small            |
| `route_monitoring` | Route monitoring feature             | monitored_route, monitored_route_segment                                                                                                                 | Small            |

**Total DB size: ~200 GB, dominated by traffic_observation and traffic_metric.**

### 2.2 Authentication & Identity (Existing — Better Auth)

The `enterprise` schema is a Better Auth implementation. The framework provides:

- `user` — identity records with email, phone, 2FA state, metadata
- `account` — OAuth provider linkages (a user may have multiple provider accounts; not to be confused with customer/contract accounts introduced in Section 3)
- `session` — active login sessions
- `organization` — workspace/tenant groupings (Better Auth's abstraction)
- `member` — user ↔ organization membership (join table)
- `organization_role` — role definitions per organization, with a `permissions` JSONB field
- `member_organization_role` — assignment of roles to members
- `platform_role` — system-level roles (for Lepton internal use)
- `team`, `team_member`, `team_role`, `member_team_role` — sub-grouping within organizations
- `asset`, `asset_role`, `asset_share`, `member_asset_role` — asset-level sharing (unused for traffic data currently but available)
- `oauth_application`, `oauth_access_token`, `oauth_consent`, `jwks` — OAuth provider capability (TraffiCure can act as an OAuth provider for partner integrations)
- `two_factor`, `verification`, `invitation` — security and onboarding flows

**Assessment:** This is a mature auth foundation. The permission model (via `organization_role.permissions` JSONB + `member_organization_role`) closely matches the RBAC model in Section 3 of this PRD. The `platform_role` table is well-positioned to serve Lepton internal users.

### 2.3 Business Data Model (Existing)

**Organizations — a mixed bag.** The `enterprise.organization` table currently holds 38 records. About 5-6 are real city deployments (Pune, Kolkata, Howrah, Barrackpore, Bidhan Nagar). The remaining ~32 are auto-created "Personal Organizations" for individual users — an artifact of Better Auth's default behavior. This conflation needs to be addressed (see Section 3).

**Road segments and traffic data isolation — partial.** The following tables correctly carry `organization_id`:

- `public.road_segment`, `public.cities`, `public.network_hourly_snapshot`, `public.report`, `public.alert_policy_config`
- `road_hierarchy.junction`, `road_hierarchy.segment_corridor_map`
- `route_monitoring.monitored_route`
- `admin.notification_log`, `admin.organization_alert_preferences`, `admin.report_notification_log`

**But — these tables do NOT carry `organization_id`:**

- `public.traffic_observation` (**126 GB** — the largest table)
- `public.traffic_metric` (**34 GB** — the second largest)
- `public.analytics_hourly_road_metrics` (3.3 GB)
- `public.analytics_hourly_corridor_metrics`
- `public.road_baseline`, `public.corridor_baseline`
- `public.alert`
- `public.area_hourly_metrics*` (all variants)
- `public.realtime_road_status`

These tables achieve isolation indirectly through `road_id`, which joins back to `road_segment.organization_id`. Functionally this works, but operationally it creates three problems:

1. **No efficient "delete all customer X data"** — you'd have to join against road_segment to find all road_ids, then cascade-delete by road_id across many tables.
2. **Cross-customer data leakage risk** — any query that forgets to join road_segment could return data across customers.
3. **Backup granularity is coarse** — you can't back up just one customer's analytics data.

**The `road_hierarchy` tables use a different key — `city_id`.** Corridor, zone, division, locality all reference `city_id` instead of `organization_id`. The `public.cities` table has both `city_id` and `organization_id`, so the mapping exists, but it means two isolation keys are in play across the codebase.

### 2.4 What's Already Working

- Better Auth handles login (phone OTP for Indian clients), sessions, 2FA, verification, invitations
- `member_organization_role` provides RBAC via `organization_role.permissions` (JSONB)
- `platform_role` enables Lepton internal role definitions
- `admin.notification_*` handles per-organization notification preferences
- Pilot deployments (Pune, Kolkata, Howrah, Barrackpore, Bidhan Nagar) all run on the same shared DB with `organization_id` scoping
- OAuth provider tables exist, ready for partner integrations

### 2.5 Gaps vs. Target Architecture

| Gap                                                         | Impact                                      | Where Addressed                               |
| ----------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| No Account/Customer layer above Organization                | Multi-city customers can't be unified       | Section 3 (new `customer` table)              |
| No entitlement system                                       | Nothing to enforce plan limits against      | Section 4                                     |
| No usage tracking/metering                                  | No visibility or enforcement on consumption | Section 4                                     |
| No audit log table                                          | Compliance blocker for government clients   | Section 4                                     |
| `organization_id` missing on largest analytics tables       | Isolation, backup, and deletion are messy   | Section 6 (schema-per-customer solves this)   |
| Personal organizations mixed with real tenant organizations | UI and admin confusion                      | Section 3 (add `org_type` flag)               |
| No configurable entitlement-to-UI binding                   | Frontend can't render based on plan         | Section 8                                     |
| No data source config table                                 | BigQuery/PubSub configs likely in env vars  | Section 3 (`organization.data_source_config`) |
| No Lepton Admin console                                     | Leadership/eng have no visibility           | Section 7                                     |
| No onboarding workflow                                      | New city setup is manual and inconsistent   | Section 7                                     |
| Partner demo lifecycle not modeled                          | Demos don't auto-expire                     | Section 7                                     |
| No canonical error catalogue / runbook                      | Post-launch RCA is slow without one         | Step 23 (**deferred** — Phase 2+)             |
| No observability contract (metric naming, tracing)          | Metrics drift without a convention          | Step 24 (**deferred** — Phase 2+)             |
| No automated billing/metering from usage_log                | Manual invoicing acceptable pre-revenue     | Step 14 (**deferred** — Phase 2+)             |
| No automated data retention/pruning                         | Manual retention acceptable pre-compliance  | Step 12 (**deferred** — Phase 2+)             |

**Summary:** The auth and basic RBAC foundation is ~40% built. What's missing is the layer above (customer/account + entitlements + usage + audit), the isolation hardening (schema-per-customer), and the Lepton Admin console that makes all of it configurable.

---

## 3. Entity Model

The system has four hierarchical levels, plus RBAC and entitlement entities that cut across them.

**Important naming note:** Better Auth (already in use) has a table called `account` that represents OAuth provider linkages — NOT a customer/contract. To avoid confusion, this PRD uses the term **Customer** (not Account) for the contract/billing entity. Better Auth's `account` table remains unchanged in its original role.

### 3.1 The Hierarchy: Tenant → Customer → Organization → User

```
┌─────────────────────────────────────────────────────────────────────┐
│  TENANT (Infrastructure Boundary)                                    │
│  "Where does it run?"                                                │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  CUSTOMER (Contract/Billing Boundary) — NEW                    │  │
│  │  "Who is paying? What are they entitled to?"                   │  │
│  │                                                                │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │  │
│  │  │  ORGANIZATION   │  │  ORGANIZATION   │  │ ORGANIZATION │  │  │
│  │  │  (City A)       │  │  (City B)       │  │ (City C)     │  │  │
│  │  │  ← enterprise.  │  │  ← enterprise.  │  │ ← enterprise.│  │  │
│  │  │   organization  │  │   organization  │  │  organization│  │  │
│  │  │                 │  │                 │  │              │  │  │
│  │  │  Users ──┐      │  │  Users ──┐      │  │  Users ──┐   │  │  │
│  │  │  Segments│      │  │  Segments│      │  │  Segments│   │  │  │
│  │  │  Data Src│      │  │  Data Src│      │  │  Data Src│   │  │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘  │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  CUSTOMER 2 (Different Customer, Same Tenant)                  │  │
│  │  ...                                                           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Why four levels, not two:**

Without the Customer layer, a national transport authority buying 3 cities would need 3 separate contracts, 3 separate admin panels, and 3 separate license pools. Their national director would need 3 logins. The Customer layer groups organizations under a single contract, with shared entitlements, unified billing, and cross-org visibility for authorized users.

Without the Tenant layer, there's no clean way to represent the infrastructure reality that some customers share a server (Lepton-hosted) while others have dedicated infrastructure (client-hosted). The Tenant layer separates infrastructure concerns from business concerns.

### 3.2 Mapping to Existing Schema

| PRD Entity          | Existing Table                                              | Status                                                                                              |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tenant              | —                                                           | **NEW** — add `platform.tenant`                                                                     |
| Customer            | —                                                           | **NEW** — add `platform.customer`                                                                   |
| Organization        | `enterprise.organization`                                   | **EXISTS** — extend with new columns (customer_id, org_type, data_source_config, city_config, etc.) |
| User                | `enterprise.user`                                           | **EXISTS** — already mature with 2FA, phone, metadata                                               |
| Role                | `enterprise.organization_role` + `enterprise.platform_role` | **EXISTS** — permissions JSONB already in use                                                       |
| RoleAssignment      | `enterprise.member_organization_role`                       | **EXISTS** — works for org-scoped roles; extend for customer/zone scope                             |
| Permission Catalog  | —                                                           | **NEW** — formalize as seeded table; currently encoded in JSONB                                     |
| Entitlement         | —                                                           | **NEW** — add `platform.entitlement`                                                                |
| UsageLog            | —                                                           | **NEW** — add `platform.usage_log`                                                                  |
| AuditLog            | —                                                           | **NEW** — add `platform.audit_log`                                                                  |
| PartnerDemo         | —                                                           | **NEW** — add `platform.partner_demo`                                                               |
| OnboardingChecklist | —                                                           | **NEW** — add `platform.onboarding_checklist`                                                       |
| FeatureFlag         | —                                                           | **NEW** — add `platform.feature_flag` + `platform.customer_feature_flag`                            |
| PlanTemplate        | —                                                           | **NEW** — add `platform.plan_template`                                                              |

**Design intent:** A new `platform` schema holds all cross-cutting platform concerns (customer, entitlements, usage, audit, config). The existing `enterprise` schema continues to own identity and RBAC. This preserves Better Auth's ownership of its tables and cleanly separates concerns.

### 3.3 Entity Definitions

#### TENANT (New)

The physical/infrastructure deployment boundary.

| Field                    | Type      | Description                                           |
| ------------------------ | --------- | ----------------------------------------------------- |
| tenant_id                | UUID (PK) | Unique identifier                                     |
| name                     | string    | Human-readable name (e.g., "Lepton India Production") |
| deployment_type          | enum      | `lepton_hosted` · `client_hosted` · `partner_demo`    |
| server_region            | string    | GCP region (e.g., "asia-south1", "me-west1")          |
| database_host            | string    | PostgreSQL connection endpoint                        |
| bigquery_default_project | string    | Default GCP project for BigQuery                      |
| status                   | enum      | `active` · `maintenance` · `decommissioned`           |
| created_at               | timestamp |                                                       |
| notes                    | text      | Operational notes                                     |

**When a new Tenant is created:** A new server/cluster is provisioned, database schemas are set up, and the deployment pipeline is configured. This is rare — maybe once per region or major client.

#### CUSTOMER (New)

The contract/billing boundary. This is where entitlements and commercial terms live. Renamed from "Account" in v1.0 to avoid naming conflict with Better Auth's `enterprise.account` table.

| Field                 | Type                | Description                                                          |
| --------------------- | ------------------- | -------------------------------------------------------------------- |
| customer_id           | UUID (PK)           | Unique identifier                                                    |
| tenant_id             | UUID (FK)           | Which tenant hosts this customer                                     |
| name                  | string              | Customer name (e.g., "Pune Municipal Corporation")                   |
| customer_type         | enum                | `production` · `pilot` · `partner_demo` · `internal`                 |
| contract_start_date   | date                | When the contract begins                                             |
| contract_end_date     | date                | When the contract expires (null = ongoing)                           |
| status                | enum                | `active` · `suspended` · `expired` · `churned` · `onboarding`        |
| billing_contact_name  | string              |                                                                      |
| billing_contact_email | string              |                                                                      |
| primary_contact_name  | string              | Main point of contact                                                |
| primary_contact_email | string              |                                                                      |
| primary_contact_phone | string              |                                                                      |
| partner_id            | UUID (FK, nullable) | If brought in by a channel partner                                   |
| branding_config       | JSON                | `{ logo_url, primary_color, secondary_color, company_name_display }` |
| onboarded_by          | UUID (FK)           | Lepton user who set this customer up                                 |
| created_at            | timestamp           |                                                                      |
| updated_at            | timestamp           |                                                                      |

**Customer types explained:**

- `production` — Paying customer with full SLA
- `pilot` — Active POC, may have limited entitlements, has expiry
- `partner_demo` — Demo environment for a channel partner's prospect. Auto-suspends on expiry.
- `internal` — Lepton's own test/demo environments

#### ORGANIZATION (Extends existing `enterprise.organization`)

Maps to your existing `enterprise.organization` table. We add new columns; we do NOT replace the table. An Organization typically represents a city deployment (Pune, Kolkata, etc.) but the existing table also contains auto-generated "Personal Organizations" from Better Auth — the new `org_type` column disambiguates these.

**Existing columns (already in `enterprise.organization`):**

| Field      | Type            | Notes                                      |
| ---------- | --------------- | ------------------------------------------ |
| id         | text (PK)       | Better Auth's organization ID (keep as-is) |
| name       | text            | Org name                                   |
| slug       | text            | URL-safe identifier                        |
| logo       | text (nullable) | Logo URL                                   |
| metadata   | text            | Better Auth metadata JSON                  |
| created_at | timestamp       |                                            |

**New columns to ADD via migration:**

| Field                 | Type                | Description                                                                                                                                                                    |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| customer_id           | UUID (FK, nullable) | Links to `platform.customer`. Nullable because Better Auth's personal orgs don't have a customer.                                                                              |
| org_type              | enum                | `city_deployment` · `personal` · `lepton_internal` · `partner_demo`. Defaults to `personal` for existing rows; migration script will flip real city orgs to `city_deployment`. |
| country               | string              |                                                                                                                                                                                |
| timezone              | string              | IANA timezone (e.g., "Asia/Kolkata")                                                                                                                                           |
| data_source_type      | enum                | `bigquery` · `pubsub` · `both`                                                                                                                                                 |
| data_source_config    | JSONB               | `{ project_id, dataset, pubsub_subscription, credentials_secret_ref, schema_name }` — includes the per-customer schema name (see Section 6)                                    |
| segment_count         | integer             | Cached count of road segments loaded                                                                                                                                           |
| city_config           | JSONB               | Alert thresholds, free-flow method, congestion bands, speed unit, map defaults, working hours, holiday calendar                                                                |
| status                | enum                | `active` · `data_loading` · `suspended` · `archived`                                                                                                                           |
| data_pipeline_status  | enum                | `healthy` · `delayed` · `stale` · `error` — updated by pipeline health monitor                                                                                                 |
| last_data_received_at | timestamp           | When the last data point arrived                                                                                                                                               |

**Critical: `city_config` is the configurability forcing function.** Everything that is currently hardcoded per city (alert thresholds, congestion level boundaries, free-flow baseline method, default time ranges, map center coordinates, default zoom level) moves into this JSON. The Lepton Admin edits this config; the product reads it at runtime.

**Handling existing Personal Organizations:** The migration sets `org_type = 'personal'` for all 32 personal orgs and `org_type = 'city_deployment'` for the 5-6 real city orgs (Pune, Kolkata, Howrah, Barrackpore, Bidhan Nagar). Product queries that enumerate deployments will filter by `org_type = 'city_deployment'`. Personal orgs remain functional for Better Auth's internal workings but are invisible in the Lepton Admin and the main product UI.

#### USER (Extends existing `enterprise.user`)

The existing `enterprise.user` table is already mature. No column changes strictly required, but two additions harden the model:

| Field                                                                                                                    | Type                | Description                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| (existing) id, name, email, phone_number, two_factor_enabled, last_sign_in_at, banned, user_metadata, app_metadata, etc. | —                   | Keep as-is                                                                                                                                      |
| customer_id                                                                                                              | UUID (FK, nullable) | **NEW** — which customer this user primarily belongs to. Lepton internal users have `customer_id = null` and instead have platform-level roles. |
| user_type                                                                                                                | enum                | **NEW** — `lepton_internal` · `client_admin` · `client_user` · `partner_user`. Helps Lepton Admin filtering and scopes default permission sets. |

User ↔ Organization membership continues to be handled by the existing `enterprise.member` table (no change). This already supports a user belonging to multiple orgs, which matches the "one user accessing multiple cities under the same customer" requirement.

### 3.4 RBAC Entities

#### PERMISSION

Atomic, code-defined actions. Seeded from the codebase, not user-configurable.

| Field         | Type            | Description                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------------ |
| permission_id | UUID (PK)       |                                                                                |
| code          | string (unique) | e.g., `dashboard.view`, `ask_ai.query`, `users.manage`                         |
| module        | string          | Which product module this belongs to (e.g., `citypulse`, `analytics`, `admin`) |
| description   | string          | Human-readable explanation                                                     |
| category      | string          | Grouping for UI display (e.g., `viewing`, `configuration`, `management`)       |

**Initial permission catalog (non-exhaustive):**

| Module    | Permission Code        | Description                          |
| --------- | ---------------------- | ------------------------------------ |
| dashboard | `dashboard.view`       | View main dashboard                  |
| dashboard | `dashboard.filter`     | Apply filters (date range, segments) |
| analytics | `analytics.view`       | View analytics module                |
| analytics | `analytics.corridor`   | Access corridor analytics            |
| analytics | `analytics.junction`   | Access junction analytics            |
| analytics | `analytics.area`       | Access area analysis                 |
| analytics | `analytics.export`     | Export analytics data                |
| citypulse | `citypulse.view`       | View CityPulse module                |
| citypulse | `citypulse.compare`    | Use comparison features              |
| ask_ai    | `ask_ai.query`         | Submit Ask AI queries                |
| alerts    | `alerts.view`          | View alerts                          |
| alerts    | `alerts.acknowledge`   | Acknowledge/dismiss alerts           |
| alerts    | `alerts.configure`     | Configure alert thresholds           |
| reports   | `reports.view`         | View reports                         |
| reports   | `reports.generate`     | Generate new reports                 |
| reports   | `reports.schedule`     | Schedule recurring reports           |
| incidents | `incidents.view`       | View incidents                       |
| incidents | `incidents.manage`     | Create/update/close incidents        |
| admin     | `users.view`           | View user list                       |
| admin     | `users.manage`         | Create/edit/deactivate users         |
| admin     | `roles.manage`         | Create/edit roles                    |
| admin     | `usage.view`           | View usage dashboards                |
| admin     | `audit.view`           | View audit logs                      |
| admin     | `branding.manage`      | Configure branding                   |
| mobile    | `mobile.access`        | Access mobile application            |
| mobile    | `mobile.notifications` | Receive push notifications           |
| api       | `api.access`           | Use API keys                         |

#### ROLE (Maps to existing `enterprise.organization_role` and `enterprise.platform_role`)

Bundles of permissions. Better Auth's existing tables cover this cleanly:

- `enterprise.organization_role` — roles scoped to a specific organization (city). Has `permissions` JSONB column that can store the permission list directly, or we can normalize to a join table (see ROLE_PERMISSION below).
- `enterprise.platform_role` — roles for Lepton internal users that apply across all customers.

**No new role tables are needed.** We add or formalize the permission catalog separately (see below).

**Existing schema (`enterprise.organization_role`):**

| Field                  | Type      | Notes                                  |
| ---------------------- | --------- | -------------------------------------- |
| id                     | text (PK) |                                        |
| organization_id        | text (FK) | Which org owns this role               |
| type                   | text      | Role type (e.g., "built_in", "custom") |
| name                   | text      | Role display name                      |
| description            | text      |                                        |
| is_built_in            | boolean   | System default vs custom               |
| permissions            | JSONB     | Array of permission codes              |
| created_at, updated_at | timestamp |                                        |

**Two approaches for permissions on roles:**

**Option A (current):** Keep permissions in the `organization_role.permissions` JSONB. Simple, works with Better Auth out of the box. Permission catalog is validated at application layer.

**Option B (recommended for scale):** Normalize to a `platform.role_permission` join table. Cleaner for querying "which roles have permission X?" and easier to enforce referential integrity on the permission catalog.

**Recommendation:** Start with Option A. Migrate to Option B only if permission-based queries become a bottleneck.

**PERMISSION_CATALOG** (new, seeded from code)

Formalize the permission catalog as a table for referential integrity and Lepton Admin visibility. Seeded at deploy time from a canonical list in the codebase.

| Field         | Type                                         |
| ------------- | -------------------------------------------- |
| permission_id | UUID (PK)                                    |
| code          | string (unique) — e.g., `analytics.corridor` |
| module        | string                                       |
| description   | text                                         |
| category      | string                                       |
| deprecated    | boolean (default false)                      |

**System default role templates:**

| Role           | Level | Key Permissions                                                                                                                                                    | Intended For                                 |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Viewer         | 1     | `dashboard.view`, `alerts.view`, `reports.view`                                                                                                                    | Senior officials who just need to see status |
| Analyst        | 2     | Viewer + `analytics.view`, `analytics.corridor`, `analytics.junction`, `analytics.area`, `analytics.export`, `citypulse.view`, `citypulse.compare`, `ask_ai.query` | Traffic analysts who study patterns          |
| Operator       | 3     | Viewer + `alerts.acknowledge`, `incidents.manage`, `mobile.*`                                                                                                      | Field officers / traffic control room staff  |
| City Admin     | 4     | All module permissions + `users.manage`, `roles.manage`, `usage.view`, `audit.view`                                                                                | Client's admin for a specific city           |
| Customer Admin | 5     | City Admin + cross-org access + `branding.manage`                                                                                                                  | Client's top-level admin across all cities   |

#### ROLE_ASSIGNMENT (Extends existing `enterprise.member_organization_role`)

The existing `enterprise.member_organization_role` table already handles user-role assignment at the organization level. It needs extension to support customer-level and zone-level scopes.

**Existing table (`enterprise.member_organization_role`):**

| Field           | Type      | Notes                            |
| --------------- | --------- | -------------------------------- |
| id              | text (PK) |                                  |
| member_id       | text (FK) | Links to `enterprise.member`     |
| organization_id | text (FK) | Which org this assignment is for |
| role            | text      | Role identifier                  |
| created_at      | timestamp |                                  |

**Option: add a more flexible `platform.role_assignment` table** for non-org scopes, leaving the existing member_organization_role as-is for the org-scope case:

| Field                  | Type                           | Description                                        |
| ---------------------- | ------------------------------ | -------------------------------------------------- |
| assignment_id          | UUID (PK)                      |                                                    |
| user_id                | text (FK → enterprise.user.id) |                                                    |
| role_id                | text                           | Either an organization_role.id or platform_role.id |
| role_source            | enum                           | `organization_role` · `platform_role`              |
| scope_type             | enum                           | `customer` · `organization` · `zone`               |
| scope_id               | text                           | ID of the customer, org, or zone                   |
| created_at, created_by | —                              |                                                    |

**How scoping works in practice:**

A national director gets: `role=<Customer Admin>, scope_type=customer, scope_id=<their_customer_id>` — they see everything across all cities in the customer's portfolio.

A Pune traffic analyst gets: `role=<Analyst>, scope_type=organization, scope_id=<pune_org_id>` — they see only Pune. This uses the existing `member_organization_role` table directly.

A South Zone operator gets: `role=<Operator>, scope_type=zone, scope_id=<south_zone_id>` — scoped to a zone within a city.

A user can have multiple role assignments. Someone might be an Analyst for Pune and a Viewer for Mumbai — two separate assignment rows.

**Note on Zones:** Zones are defined in `road_hierarchy.zone` (keyed to `city_id`). The `scope_type=zone` in role assignments references these existing zone records.

### 3.5 Entitlement Entities

#### ENTITLEMENT (New — `platform.entitlement`)

What a Customer is contractually allowed to use. Configured by Lepton Admin.

| Field            | Type              | Description                                                      |
| ---------------- | ----------------- | ---------------------------------------------------------------- |
| entitlement_id   | UUID (PK)         |                                                                  |
| customer_id      | UUID (FK)         |                                                                  |
| entitlement_type | enum              | See below                                                        |
| module           | string (nullable) | For module-specific entitlements                                 |
| limit_value      | integer           | The cap (-1 = unlimited)                                         |
| period           | enum              | `monthly` · `annual` · `unlimited`                               |
| enforcement      | enum              | `hard` (block at limit) · `soft` (warn but allow) · `track_only` |
| created_at       | timestamp         |                                                                  |
| updated_at       | timestamp         |                                                                  |
| updated_by       | UUID (FK)         |                                                                  |

**Entitlement types:**

| Type                    | Description                                        | Example                 |
| ----------------------- | -------------------------------------------------- | ----------------------- |
| `seat_limit`            | Total licensed users                               | 15 seats                |
| `seat_limit_by_type`    | Seats by access level (module = user_type)         | 5 full + 10 viewer-only |
| `module_access`         | Whether a module is enabled (limit_value = 1 or 0) | CityPulse = enabled     |
| `segment_limit`         | Total road segments across all orgs                | 500 segments            |
| `query_quota`           | Queries per period per module                      | Ask AI: 200/month       |
| `export_quota`          | Data exports per period                            | 50 exports/month        |
| `api_access`            | API enabled (1/0)                                  | Enabled                 |
| `api_rate_limit`        | API calls per period                               | 10,000/month            |
| `genai_quota`           | GenAI token usage (pass-through cost)              | 500,000 tokens/month    |
| `data_retention_days`   | How long historical data is kept                   | 365 days                |
| `org_limit`             | Maximum number of organizations (cities)           | 3 cities                |
| `report_schedule_limit` | Number of scheduled reports                        | 10 scheduled reports    |

**Example: A $100K production customer with 15 licenses for one city, CityPulse + Analytics + Alerts + Reports, 200 Ask AI queries/month:**

```
customer_id: <cust>, entitlement_type: seat_limit,         limit_value: 15,   period: unlimited
customer_id: <cust>, entitlement_type: module_access,      module: citypulse, limit_value: 1
customer_id: <cust>, entitlement_type: module_access,      module: analytics, limit_value: 1
customer_id: <cust>, entitlement_type: module_access,      module: alerts,    limit_value: 1
customer_id: <cust>, entitlement_type: module_access,      module: reports,   limit_value: 1
customer_id: <cust>, entitlement_type: module_access,      module: ask_ai,    limit_value: 1
customer_id: <cust>, entitlement_type: query_quota,        module: ask_ai,    limit_value: 200, period: monthly
customer_id: <cust>, entitlement_type: segment_limit,      limit_value: 300
customer_id: <cust>, entitlement_type: org_limit,          limit_value: 1
customer_id: <cust>, entitlement_type: data_retention_days, limit_value: 365
```

#### USAGE_LOG

Tracks consumption against entitlements.

| Field       | Type                | Description                                                    |
| ----------- | ------------------- | -------------------------------------------------------------- |
| usage_id    | UUID (PK)           |                                                                |
| customer_id | UUID (FK)           |                                                                |
| org_id      | UUID (FK, nullable) | Which org the usage occurred in                                |
| user_id     | UUID (FK)           | Who triggered it                                               |
| usage_type  | string              | Matches entitlement_type (e.g., `query_quota`, `export_quota`) |
| module      | string              | Which module                                                   |
| quantity    | integer             | Amount consumed (usually 1 per event)                          |
| metadata    | JSON                | Additional context (query text, export type, etc.)             |
| timestamp   | timestamp           |                                                                |

**Aggregation:** Real-time counters in Redis for fast enforcement (increment on every request). Background job flushes detailed logs to PostgreSQL every minute for reporting and historical analysis.

#### AUDIT_LOG

Immutable record of all significant actions. Append-only, never deleted.

| Field       | Type                | Description                                                                      |
| ----------- | ------------------- | -------------------------------------------------------------------------------- |
| audit_id    | UUID (PK)           |                                                                                  |
| customer_id | UUID (FK)           |                                                                                  |
| org_id      | UUID (FK, nullable) |                                                                                  |
| actor_id    | UUID (FK)           | Who performed the action (user_id)                                               |
| actor_type  | enum                | `client_user` · `lepton_admin` · `system`                                        |
| action      | string              | e.g., `user.created`, `role.assigned`, `entitlement.updated`, `alert.configured` |
| target_type | string              | What was acted upon (e.g., `user`, `role`, `org`, `entitlement`)                 |
| target_id   | UUID                |                                                                                  |
| details     | JSON                | Before/after values, parameters, context                                         |
| ip_address  | string              |                                                                                  |
| user_agent  | string              |                                                                                  |
| timestamp   | timestamp           |                                                                                  |

### 3.6 Supporting Entities

#### PARTNER_DEMO

Extends Customer with demo-specific lifecycle fields. One-to-one with a Customer where `customer_type = 'partner_demo'`.

| Field                  | Type              | Description                         |
| ---------------------- | ----------------- | ----------------------------------- |
| demo_id                | UUID (PK)         |                                     |
| customer_id            | UUID (FK, unique) | Links to the demo Customer          |
| partner_company        | string            | Partner company name                |
| partner_contact_name   | string            |                                     |
| partner_contact_email  | string            |                                     |
| expiry_date            | date              | When demo access ends               |
| max_segments           | integer           | Segment cap for this demo           |
| demo_purpose           | text              | Why this demo was created           |
| auto_suspend_on_expiry | boolean           | Default true — system auto-suspends |
| created_by             | UUID (FK)         | Lepton user who created it          |

#### ONBOARDING_CHECKLIST

Auto-generated checklist items when a new Customer is created. Tracks setup completion.

| Field        | Type      | Description                                   |
| ------------ | --------- | --------------------------------------------- |
| checklist_id | UUID (PK) |                                               |
| customer_id  | UUID (FK) |                                               |
| item_key     | string    | Machine key (e.g., `data_source_configured`)  |
| item_label   | text      | Human-readable description                    |
| is_required  | boolean   | Must be completed before customer goes active |
| is_completed | boolean   |                                               |
| completed_at | timestamp |                                               |
| completed_by | UUID (FK) |                                               |
| notes        | text      | Optional notes                                |
| sort_order   | integer   | Display ordering                              |

#### FEATURE_FLAG / ACCOUNT_FEATURE_FLAG

Global or per-customer feature toggles for beta rollout, kill switches, and gradual feature release.

| Field (feature_flags) | Type            | Description                       |
| --------------------- | --------------- | --------------------------------- |
| flag_id               | UUID (PK)       |                                   |
| flag_key              | string (unique) | e.g., `corridor_diagnostics_v2`   |
| description           | text            |                                   |
| is_global             | boolean         | If true, applies to all customers |
| global_enabled        | boolean         | Only used when is_global = true   |

| Field (customer_feature_flag) | Type          | Description |
| ----------------------------- | ------------- | ----------- |
| customer_id                   | UUID (FK, PK) |             |
| flag_id                       | UUID (FK, PK) |             |
| enabled                       | boolean       |             |

#### PLAN_TEMPLATE

Predefined entitlement bundles for quick-apply during customer setup.

| Field        | Type      | Description                           |
| ------------ | --------- | ------------------------------------- |
| template_id  | UUID (PK) |                                       |
| name         | string    | e.g., "Pilot Plan", "Standard Plan"   |
| description  | text      |                                       |
| entitlements | JSON      | Array of entitlement objects to apply |
| is_active    | boolean   |                                       |

---

## 4. The Entitlement Enforcement Engine

This is the middleware that governs every request in the platform.

### 4.1 Request Flow

```
    Incoming Request
         │
         ▼
┌─────────────────────┐
│  1. AUTHENTICATION   │   Better Auth validates the session token
│                      │   (cookie or Bearer). Extracts user identity.
│  "Who are you?"      │   If invalid → 401 Unauthorized
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  2. IDENTITY         │   Loads from cache (Redis, 5-min TTL):
│     RESOLUTION       │   - User record
│                      │   - Customer record + status
│  "What's your        │   - All role assignments
│   context?"          │   - Customer entitlements
│                      │   If customer suspended → 403 Customer Suspended
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  3. AUTHORIZATION    │   Checks: does this user have the required
│                      │   permission for this endpoint, given their
│  "Are you allowed    │   role assignments and scopes?
│   to do this?"       │
│                      │   Example: User requests GET /api/analytics/pune
│                      │   → Needs `analytics.view` permission
│                      │   → User has Analyst role scoped to Pune org
│                      │   → Permission check: Analyst has analytics.view ✓
│                      │   → Scope check: Pune org matches ✓
│                      │   If no matching role+scope → 403 Forbidden
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  4. ENTITLEMENT      │   Checks: is this action within the customer's
│     CHECK            │   plan limits?
│                      │
│  "Is your plan       │   → Is the analytics module enabled for this customer?
│   quota OK?"         │   → If this is an Ask AI query, is the monthly
│                      │     quota exceeded?
│                      │   Enforcement depends on entitlement config:
│                      │   - hard: block with 429 Quota Exceeded
│                      │   - soft: allow but flag, log warning
│                      │   - track_only: allow silently, log for reporting
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  5. USAGE LOGGING    │   Increment Redis counter for this usage type.
│                      │   Background job persists to usage_log table.
│  "Record what        │
│   happened"          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  6. REQUEST HANDLER  │   The actual business logic executes.
│                      │   Data is filtered by org_id(s) from the
│  "Do the work"       │   user's scope.
└─────────────────────┘
```

### 4.2 Caching Strategy

| Data               | Cache TTL         | Invalidation Trigger           |
| ------------------ | ----------------- | ------------------------------ |
| Entitlements       | 1 hour            | Plan change via Lepton Admin   |
| Role assignments   | 5 minutes         | Role/assignment change         |
| User profile       | 5 minutes         | Profile update                 |
| Usage counters     | Real-time (Redis) | Auto-increment on each request |
| Permission catalog | 24 hours          | Code deployment                |

**Why different TTLs:** Entitlements change maybe once per quarter (plan upgrade). Role assignments change occasionally (new user, role change). Usage counters must be near-real-time for enforcement to work. The permission catalog only changes when Lepton ships new features.

### 4.3 Scope-Filtered Data Access

Every database query in the product must be scoped. The middleware injects the user's allowed scope into the query context:

```
-- Before (current, unsafe):
SELECT * FROM analytics_rollup WHERE org_id = 'pune-001'

-- After (scope-enforced):
SELECT * FROM analytics_rollup
WHERE org_id IN (<user's allowed org_ids from role assignments>)
  AND zone_id IN (<user's allowed zone_ids, or all if scope_type = 'organization'>)
```

This is enforced at the middleware/ORM level so individual API handlers cannot accidentally bypass scoping. No handler should ever construct an unscoped query.

---

## 5. Authentication Architecture

### 5.1 Auth Provider: Better Auth (Already in Use)

**Decision: Stay with Better Auth.** The current platform has already implemented Better Auth with a mature schema (user, account, organization, member, role, permissions, teams, two_factor, verification, OAuth app tables). Ripping this out for Auth0 would cost 4–6 weeks of rework with zero strategic gain.

**Division of responsibility:**

| Concern                                     | Handled By                               |
| ------------------------------------------- | ---------------------------------------- |
| Login (OTP, Email/Password, OAuth)          | Better Auth                              |
| MFA (TOTP, 2FA)                             | Better Auth (via `two_factor` plugin)    |
| Session tokens (opaque cookie or Bearer)    | Better Auth (sessions in DB)             |
| OAuth provider linkages (Google, Microsoft) | Better Auth (`account` table)            |
| Password/credential storage                 | Better Auth (hashed in DB)               |
| "Who is this user?"                         | Better Auth session                      |
| "What can this user do?"                    | TraffiCure RBAC engine (this PRD)        |
| "Is the customer entitled to this?"         | TraffiCure entitlement engine (this PRD) |
| Enterprise SSO (SAML, complex OIDC)         | **WorkOS (complement)** — see 5.5        |

**Why Better Auth over Auth0 / WorkOS-only:**

- **Data sovereignty:** All identity data stays in our PostgreSQL. Critical for Indian government + Middle East clients who have residency requirements.
- **Cost:** Auth0 scales to $1,500–3,000/month at 10–50 customers. Better Auth is free (self-hosted).
- **Schema ownership:** We can extend `user`, `organization`, `member` tables with TraffiCure-specific fields directly, rather than syncing from an external IDP.
- **Already implemented:** ~40% of the identity layer is in place.

**Tradeoffs we accept:**

- Smaller community than Auth0/Clerk; fewer drop-in UI kits.
- Enterprise SSO (SAML) support is newer; mature integrations are better in WorkOS/Auth0.
- We own the operational burden: rate limiting, brute-force protection, credential rotation, audit logs.

### 5.2 Auth Methods by Client Type

**Phase 1 MVP scope (see `15_Auth_Impersonation_Minimal.md`):** existing Better Auth login methods remain as-is (phone OTP, email/password, Google OAuth, magic link). The only new auth work in MVP is (a) TOTP MFA enforced for Lepton internal staff and (b) impersonation sessions. Everything else in this table — WebAuthn/passkeys, enterprise SSO, MFA policy engine — is Phase 2+.

| Client Type                     | Auth Method                          | Phase       | Better Auth Implementation                                           |
| ------------------------------- | ------------------------------------ | ----------- | -------------------------------------------------------------------- |
| Indian government (current)     | Phone OTP                            | Phase 1 MVP | Better Auth `phoneNumber` plugin + SMS provider (MSG91/Twilio)       |
| International enterprise        | Email + Password                     | Phase 1 MVP | Built-in email/password                                              |
| Lepton internal team            | Google OAuth + **TOTP MFA required** | Phase 1 MVP | `socialProviders: { google }` + TOTP MFA per Step 15 Minimal         |
| Partner demo users              | Email magic link                     | Phase 1 MVP | `magicLink` plugin (simplest, no password)                           |
| International enterprise (MFA)  | Email + Password + TOTP              | Phase 2+    | `two_factor` plugin with MFA policy engine (Step 15 Full — deferred) |
| Any user (passkeys)             | WebAuthn                             | Phase 2+    | Step 15 Full — deferred                                              |
| Enterprise with SSO requirement | SAML / OIDC                          | Phase 2+    | **WorkOS** → Better Auth bridge (see 5.5)                            |

### 5.3 Session Model

Better Auth uses **opaque session tokens** (stored in `enterprise.session`), not JWTs. This is a deliberate choice:

- Sessions can be revoked instantly (flip `session.revoked = true`) — no JWT revocation list gymnastics.
- Sessions carry minimal payload; identity context is looked up server-side per request.
- Short-lived (configurable, default 7 days) with rolling refresh.

**Per-request identity resolution:**

1. Middleware reads `better-auth.session_token` cookie (or `Authorization: Bearer <token>`)
2. Validates session via Better Auth → returns `user_id`
3. Loads from Redis cache (5-min TTL) the user's: `customer_id`, `customer_status`, active `role_assignments`, `org_ids`, `entitlements`
4. Attaches this to the request context for downstream middleware (RBAC + entitlements)

**Why no JWTs with claims inside:** JWT bloat becomes a real problem at our scale. A user in 3 cities with 5 roles each produces a 4–8 KB token. Cookies are capped at ~4 KB and get sent on every request. Opaque session + server-side cache is cleaner, revocable, and keeps cache-miss cost at one Redis lookup.

### 5.4 Operational Hardening

Better Auth does not ship these out of the box. The trim decision (`_decisions/TRIM_APPLIED.md`) splits these into two buckets:

**Phase 1 MVP (in scope — Step 15 Minimal):**

| Concern                                  | Implementation                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TOTP MFA for Lepton internal staff       | `enterprise.user_mfa_totp` table + `/admin/mfa/totp/enroll` and `/verify` endpoints. Enforced for any user with `platform_role != 'user'`. |
| Impersonation session tracking           | `platform.impersonation_session` table, 30-min time-box, endpoint restrictions, audit trail                                                |
| Audit log of auth + impersonation events | Logged to `platform.audit_log` via Step 05                                                                                                 |

**Phase 2+ (deferred — Step 15 Full in `_deferred/15_Auth_Hardening.md`):**

| Concern                                    | Planned Implementation                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| OTP rate limiting (prevent SMS bombing)    | Upstash/Redis — max 3 OTPs/phone/hour, 10/day                               |
| Brute-force on email/password              | Lockout after 5 failed attempts in 15 min; exponential backoff              |
| Session hijack detection                   | IP change + User-Agent change → force re-auth for sensitive operations      |
| Credential rotation                        | Force password reset every 180 days for admin users; never for clients (UX) |
| Suspicious login alerts                    | Email notification on login from new country/device                         |
| WebAuthn / passkeys                        | Better Auth WebAuthn plugin                                                 |
| MFA policy engine (per-role, per-customer) | Policy table + enforcement middleware                                       |

Rationale for splitting: the Phase 1 hardening we skip is low-frequency, low-blast-radius risk pre-revenue. The Phase 1 hardening we keep (TOTP for internal staff + impersonation audit) prevents the two highest-blast-radius insider risks — stolen Lepton credentials and untracked customer data access.

### 5.5 Enterprise SSO — WorkOS as a Complement (Phase 2+)

Better Auth's SAML/OIDC support is maturing but not yet enterprise-grade. For customers who require SSO (Okta, Azure AD, Ping), the plan:

- **Phase 1 MVP (now through first 1–2 paying contracts):** Better Auth only. Phone OTP, email/password, Google OAuth + TOTP for internal staff. No enterprise SSO.
- **Phase 2+ (when first customer demands SSO):** Add **WorkOS** as a per-customer SSO gateway.
  - WorkOS handles SAML/OIDC dance with the customer's IDP.
  - On successful SSO, WorkOS redirects to our Better Auth `/api/auth/sso-callback` with a verified email.
  - Better Auth creates/updates the user and issues its own session.
  - Net effect: one user, one session model, but the enterprise front door is WorkOS.
- WorkOS pricing: ~$125/connection/month. Only paid when customer actually demands SSO, so cost follows revenue.

### 5.6 Better Auth Configuration Blueprint

```typescript
// auth.ts — authoritative Better Auth setup
export const auth = betterAuth({
  database: pgAdapter({ schema: "enterprise" }),

  // Primary methods
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  socialProviders: {
    google: { clientId, clientSecret }, // Lepton internal
  },

  plugins: [
    phoneNumber({
      // Indian gov OTP
      sendOTP: ({ phoneNumber, code }) => msg91.send(phoneNumber, code),
      otpOptions: { expiresIn: 300, allowedAttempts: 3 },
    }),
    twoFactor(), // Required for Lepton + admin users
    organization({
      // Already wired to enterprise.organization
      allowUserToCreateOrganization: false, // Orgs created only via Lepton Admin
    }),
    magicLink({
      // Partner demo users
      sendMagicLink: ({ email, url }) =>
        resend.send(email, magicLinkTemplate(url)),
    }),
    admin({ defaultRole: "client_user" }), // Wires to enterprise.platform_role
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh if used within 24h
    cookieCache: { enabled: true, maxAge: 300 }, // 5-min edge cache
  },

  rateLimit: { window: 60, max: 30 }, // Baseline; OTP has its own stricter limit

  trustedOrigins: [
    "https://app.trafficure.com",
    "https://admin.lepton.internal",
  ],
})
```

---

## 6. Database Isolation Strategy

This section addresses a question that came up during the current-state review: should each customer get a separate database, or do we stay with a single database and isolate logically?

### 6.1 Current State (Observed in Dev DB)

The existing database is **single-database, partially-isolated**:

| Schema                    | Contents                                                                                                                                                                                | Isolation Today                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise`              | Better Auth identity: user, account, organization, member, roles, sessions                                                                                                              | Row-level via `organization_id` on most tables                                                                                                          |
| `public`                  | Traffic data: `traffic_observation` (126 GB), `traffic_metric` (34 GB), `analytics_hourly_road_metrics` (3.3 GB), `road_segment`, `cities`, `alert`, `alert_policy_config`, `baselines` | **Partial** — `road_segment` has `organization_id`, but `traffic_observation`, `traffic_metric`, and `analytics_*` tables do NOT have `organization_id` |
| `road_hierarchy`          | corridor, zone, division, junction, locality                                                                                                                                            | Scoped by `city_id` (not `organization_id`)                                                                                                             |
| `raw`, `route_monitoring` | Ingestion staging                                                                                                                                                                       | No tenant column                                                                                                                                        |

**The critical gap:** The largest, most commercially sensitive tables (`traffic_observation`, `traffic_metric`, `analytics_hourly_road_metrics`) have **no organization/customer column**. Today, data from all pilot cities sits in the same tables, separated implicitly by `road_segment_id` (which IS scoped to an organization). This works because Pune's segments don't overlap with Dehradun's, but it is a time bomb:

- One buggy `WHERE` clause in a new analytics endpoint can leak data across customers
- Government clients asking "prove my data is segregated" cannot be satisfied with "trust our app code"
- Per-customer deletion (contract exit, GDPR) becomes painful — you're deleting rows by joining through `road_segment`
- Per-customer backup/restore is impossible — backups are always all-or-nothing

### 6.2 Recommended Architecture: Hybrid — Shared Platform, Schema-Per-Customer for Traffic Data

The right answer isn't "one DB per customer" (operational nightmare at 50 customers) nor "keep everything shared" (data sovereignty risk). It's **hybrid**:

| Layer                                                            | Strategy                                                                                                                   | Rationale                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Identity & control plane** (`enterprise`, `platform`)          | **Shared schema, row-level isolation** by `customer_id` / `organization_id`                                                | Better Auth is designed this way. Cross-customer queries (Lepton Admin dashboards) are fast and natural.           |
| **Traffic observation & analytics data** (currently in `public`) | **Schema-per-customer** — one PostgreSQL schema per customer, e.g. `customer_pune`, `customer_dehradun`, `customer_riyadh` | Physical isolation, easy per-customer backup/delete, satisfies sovereignty audits, no risk of cross-contamination. |
| **Road hierarchy / reference data** (`road_hierarchy`)           | **Per-customer schema** (moves with traffic data)                                                                          | Hierarchy is specific to a city's geography; belongs with that customer's traffic data.                            |
| **Raw ingestion** (`raw`, `route_monitoring`)                    | **Shared staging, routed-on-write** to customer schemas by pipeline                                                        | Ingestion pipeline is cheaper to run as single process with routing logic than N parallel pipelines.               |

**Why schema-per-customer and not database-per-customer:**

- Same PostgreSQL instance, same connection pool — no N× infrastructure cost
- Schema-level RBAC: `GRANT USAGE ON SCHEMA customer_pune TO pune_service_role` — app connects with a customer-scoped role, can't see other schemas even with SQL injection
- `pg_dump --schema=customer_pune` for per-customer backup
- `DROP SCHEMA customer_pune CASCADE` for clean contract exit
- Cross-customer queries (Lepton admin analytics) still possible with `postgres_fdw` or a read-only superuser role

### 6.3 What Lives Where (Target State)

```
PostgreSQL instance (primary)
│
├── enterprise/          (shared, Better Auth — identity, sessions, orgs, roles, members)
├── platform/            (shared, NEW — customer, entitlement, usage_log, audit_log,
│                         permission_catalog, plan_template, partner_demo, onboarding_checklist,
│                         feature_flag, customer_feature_flag)
├── raw/                 (shared, ingestion staging — routed by pipeline)
├── route_monitoring/    (shared, ingestion staging)
│
├── customer_pune/       (Pune Smart City customer schema)
│   ├── road_segment
│   ├── traffic_observation
│   ├── traffic_metric
│   ├── analytics_hourly_road_metrics
│   ├── alert
│   ├── alert_policy_config
│   ├── baselines
│   ├── cities
│   └── (road_hierarchy tables: corridor, zone, division, junction, locality)
│
├── customer_dehradun/   (same table structure, Dehradun data)
├── customer_riyadh/     (same structure, Riyadh data — potentially different PG instance for data residency)
└── customer_<next>/     (created by Lepton Admin onboarding)
```

### 6.4 Migration Path From Current State

Because today all traffic data is mixed in `public`, migration is non-trivial but one-time:

1. **Freeze ingestion** (off-hours window, ~30 minutes) OR run dual-write during migration
2. **For each existing pilot city**, create `customer_<slug>` schema with empty target tables (same structure as `public.*`)
3. **Copy data by org_id**, joining through `road_segment` to find which rows belong to which city:
   ```sql
   INSERT INTO customer_pune.traffic_observation
   SELECT t.* FROM public.traffic_observation t
   JOIN public.road_segment r ON t.road_segment_id = r.road_segment_id
   WHERE r.organization_id = '<pune-org-id>';
   ```
4. **Update road_hierarchy** — move city_id-scoped rows into the customer schema
5. **Cut over ingestion pipeline** to write directly to customer schemas (route by organization_id lookup)
6. **Verify** row counts and spot-check dashboards
7. **Drop old `public.*` tables** once verification passes

Expected duration: 1 week elapsed for migration code + 1 day per existing customer to run. For 3 pilot customers (Pune, Dehradun, + 1 more), this is a ~10-day project.

### 6.5 Data Residency / Regional Isolation (Phase 3)

For government customers requiring in-country data storage (Saudi Arabia, UAE, EU):

- Their `customer_<name>` schema lives on a **separate PostgreSQL instance** in the required region
- App layer is aware via `customer.db_connection_string` (stored encrypted in `platform.customer`)
- Query router picks the correct connection based on `customer_id` resolved at request time
- Better Auth's `enterprise` schema can remain centralized (identity is low-volume, and the identity of a government user traveling abroad still needs to authenticate)
- If the customer demands identity residency too, run a regional Better Auth instance and federate via WorkOS

This is deferred to Phase 3 — only implemented when a signed contract requires it. Don't build multi-region now.

### 6.6 Trade-offs Accepted

| Concern                                                                      | How We Address It                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-customer aggregate queries (Lepton admin "total DAU across customers") | `postgres_fdw` to query all customer schemas, or maintain denormalized rollups in `platform.usage_log`                                                                           |
| Schema drift between customers                                               | All DDL changes go through a migration tool (e.g., Sqitch or custom) that applies to every `customer_*` schema; Lepton Admin's onboarding creates schemas from a single template |
| Connection pooling across N schemas                                          | PgBouncer with session pooling; app uses `SET search_path TO customer_xxx` per request rather than separate connections                                                          |
| Slightly more complex queries in app code                                    | Query builder wraps `search_path` logic — developers write `db.forCustomer(customerId).query(...)` rather than bare SQL                                                          |

### 6.7 What We're NOT Doing (And Why)

- **Database-per-customer:** Too expensive (connection pool × N), too much operational overhead, no meaningful security gain over schema-per-customer with proper role isolation.
- **Row-level security (RLS) policies on shared tables:** PostgreSQL RLS works but is fragile at scale — policy mistakes are silent; performance with complex policies degrades; debugging is painful. Schema isolation is simpler and harder to get wrong.
- **Keeping everything in `public`:** Not acceptable past Phase 1. The risk of cross-customer data leak via a buggy query grows with every feature shipped.

---

## 7. Lepton Admin Console — Full Specification

The Lepton Admin is the internal control plane for Lepton's team: engineering, pre-sales, customer success, and leadership. It is a separate application with its own frontend, API, and auth context.

### 7.1 Access Control for the Lepton Admin Itself

The Lepton Admin has its own RBAC using the same primitives:

| Lepton Role        | Access Level                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Lepton Super Admin | Full access to everything. Reserved for CTO/founders.                                                  |
| Lepton Ops Admin   | Customer/org CRUD, entitlement management, data source config, user management. Day-to-day operations. |
| Lepton Engineer    | Read access to all configs + data pipeline management. Can't modify entitlements or user data.         |
| Lepton Pre-Sales   | Read-only access to customers, usage dashboards. Can create partner demo customers.                    |
| Lepton Viewer      | Read-only access to dashboards and customer summaries. For CEO/leadership.                             |

### 7.2 Module: Global Dashboard

**Purpose:** At-a-glance health and status of the entire platform. The first thing anyone at Lepton sees when they open the admin console.

**Sections:**

**Platform Summary Cards:**

- Total active customers (broken down: production / pilot / partner demo / internal)
- Total active users across all customers
- Total road segments under management
- Total organizations (cities) deployed

**Customer Health Grid:**
A table/card view of all customers, each showing:

- Customer name, type, status
- Number of orgs, number of active users / seat limit
- Data pipeline health indicator (green/yellow/red per org based on `last_data_received_at`)
- User engagement indicator (based on login recency: green = active in last 24h, yellow = last 7d, red = no logins in 7+ days)
- Contract expiry countdown (flag customers expiring in < 90 days)

**Alerts/Attention Required Panel:**

- Customers with stale data pipelines (no data received in > 1 hour)
- Customers approaching entitlement limits (> 80% of any quota)
- Partner demos expiring in next 30 days
- Customers with zero logins in last 7 days (POC going cold?)
- Customers in `onboarding` status for > 14 days (stuck onboarding?)

**Usage Trends:**

- Platform-wide DAU/WAU/MAU trend
- Ask AI query volume trend (cost tracking — this is pass-through)
- Module adoption heatmap (which modules are used most across customers)

### 7.3 Module: Customer Management

**Customer List View:**
Filterable/searchable table with columns: name, type, status, org count, user count / seat limit, contract dates, partner (if any), health status. Sortable by any column. Quick filters: by customer type, by status, by health.

**Customer Detail View (click into a customer):**

**Overview Tab:**

- Customer metadata (name, type, contract dates, contacts)
- Edit inline for Lepton admins
- Status management: activate, suspend, expire, mark as churned (with confirmation + audit log)

**Organizations Tab:**

- List of all orgs under this customer
- Per-org: name, city, segment count, data pipeline status, last data received
- Actions: add org, edit org config, view city_config, suspend org
- Data source configuration: BigQuery project/dataset, PubSub subscription, credentials reference
- City config editor: JSON editor with schema validation for alert thresholds, congestion levels, etc.

**Users Tab:**

- List all users in this customer
- Per-user: name, email/phone, role assignments, status, last login, login count
- Actions: create user (checks seat limit), edit, suspend, deactivate, reset auth, resend invite
- Quick role assignment: select user → assign role + scope

**Entitlements Tab:**

- Visual display of all entitlements for this customer
- Usage vs. limit bars (e.g., "12 / 15 seats used", "167 / 200 Ask AI queries this month")
- Edit entitlements inline (with audit trail)
- Plan templates: quick-apply from predefined plan templates (Basic, Standard, Enterprise)
- History: changelog of all entitlement modifications

**Usage & Engagement Tab:**

- DAU/WAU/MAU chart for this customer
- Per-module usage breakdown
- Per-user activity (who's using what, how often)
- Usage vs. entitlement trend (are they growing toward their limits?)
- Export usage report (for QBRs and billing)

**Audit Log Tab:**

- Filterable log of all actions taken on/within this customer
- Filter by: actor (Lepton or client), action type, date range, target entity
- Includes both Lepton admin actions (entitlement changes, user creation by Lepton) and client actions (user management, config changes)

### 7.4 Module: Organization Management

Accessible both from within a Customer and as a standalone cross-customer view.

**Cross-Customer Org View:**
Table of all organizations across all customers. Useful for engineering to see all cities, their pipeline status, and config. Sort by data freshness to quickly spot pipeline issues.

**Org Detail View:**

**Data Source Configuration:**

- BigQuery project, dataset, table references
- PubSub subscription(s)
- Credentials: reference to secret manager (never display raw credentials)
- "Test Connection" button: verifies BigQuery/PubSub connectivity and returns sample data count
- Pipeline health: last data received, data gap detection (missing intervals), daily data volume trend

**Segment Management:**

- Total segments loaded
- Segment list (if feasible) or summary by zone/area
- Segment limit vs. actual (from customer entitlements)

**City Configuration:**

- Structured editor for `city_config` JSON
- Key config fields with descriptions and validation:
  - Alert thresholds (speed drop %, congestion duration, etc.)
  - Free-flow baseline method and parameters
  - Congestion level definitions (ranges for free-flow, slow, heavy, gridlock)
  - Map center coordinates and default zoom
  - Speed unit (kmph / mph)
  - Working hours definition (for time-based analytics defaults)
  - Special day calendars (public holidays, events — affects baselines)
- "Compare with default" view: shows what's customized vs. platform defaults
- History: changelog of all config modifications

### 7.5 Module: Partner Demo Management

**Demo List View:**
Table of all partner demo customers. Columns: partner company, demo purpose, org/city, expiry date, status, days remaining.

**Create Demo Flow (wizard):**

1. Partner company name + contact
2. City/data source (select from available or configure new)
3. Segment selection (which segments to include in demo — subset of a city)
4. Module access (default: all modules enabled for demo)
5. Expiry date (default: 30 days)
6. Create admin user for the partner demo
7. Review & create

**Auto-Suspension:**
A scheduled job runs daily. Any partner demo customer past its expiry date is automatically set to `suspended` status. Suspended customers return a "Demo expired" message on login. Lepton admin can extend, reactivate, or convert to pilot/production.

### 7.6 Module: User Lookup (Cross-Customer)

**Purpose:** When a client calls and says "my user can't see X" or "someone needs access to Y," Lepton support needs to instantly find the user and understand their permissions.

**Search:** By name, email, phone, or user_id across all customers.

**User Detail View:**

- Customer and org context
- All role assignments with effective permissions (flattened list of what this user can actually do)
- Login history (last 30 days)
- Scope visualization: which orgs and zones this user can access
- Quick actions: suspend, reset auth, modify role assignments

### 7.7 Module: System Configuration

**Permission Catalog:**
View all registered permissions. Add new permissions (when shipping new features). Mark permissions as deprecated.

**Role Templates:**
Manage system-default role templates. Edit which permissions are in each template. Changes propagate to all customers using system defaults (with notification).

**Plan Templates:**
Predefined entitlement bundles that can be quick-applied to customers:

- **Pilot Plan:** 5 seats, all modules, 100 Ask AI queries/month, 90-day retention, 1 org
- **Standard Plan:** 15 seats, all modules, 500 Ask AI queries/month, 365-day retention, 1 org
- **Enterprise Plan:** 50 seats, all modules, 2000 Ask AI queries/month, 730-day retention, 5 orgs
- Custom plans can be saved as templates

**Feature Flags:**
Toggle features globally or per-customer. Used for: beta features (enable for specific customers), kill switches (disable a broken feature platform-wide), gradual rollout (enable for pilot customers first).

| Flag Name                 | Scope        | Description                      |
| ------------------------- | ------------ | -------------------------------- |
| `corridor_diagnostics_v2` | per-customer | New corridor UI (beta)           |
| `ask_ai_enabled`          | global       | Master switch for GenAI features |
| `export_to_pdf`           | per-customer | PDF export feature               |
| `mobile_app_access`       | per-customer | Mobile app availability          |

### 7.8 Module: Onboarding Checklist

**Purpose:** Standardize new city/customer setup so engineers follow a consistent process.

When a new customer is created, an onboarding checklist is auto-generated:

- [ ] Customer record created with correct type and contract dates
- [ ] Organization(s) created with city details
- [ ] Data source configured (BigQuery/PubSub project, credentials)
- [ ] Data pipeline tested — sample data received
- [ ] Road segments loaded and verified (count matches expectation)
- [ ] City config set (alert thresholds, congestion levels, map defaults)
- [ ] Entitlements configured (seats, modules, quotas)
- [ ] Admin user created and invite sent
- [ ] Admin user has logged in and verified access
- [ ] Branding configured (logo, colors) if applicable
- [ ] Smoke test: dashboard loads with real data

Each item is checkable, with a timestamp and who completed it. Customer status moves from `onboarding` to `active` when all critical items are checked.

---

## 8. Integration with Existing Product

### 8.1 What Changes in the Existing TraffiCure Product

**Frontend changes:**

- Navigation/sidebar is dynamically rendered based on the user's effective permissions and the customer's module entitlements. If the customer doesn't have CityPulse, the sidebar doesn't show CityPulse. If the user's role doesn't include `analytics.export`, the export button is hidden.
- User profile dropdown shows customer name and org context.
- Customer Admin users see an "Admin" section in the sidebar (the client admin module — Phase 2).

**Backend changes:**

- Every API endpoint gets the enforcement middleware (auth → identity → authorization → entitlement).
- Every database query is scoped through the middleware-injected org/zone filter.
- The JWT structure is updated to include `customer_id` and role assignments.
- A `/me` endpoint returns the user's full context: profile, role assignments, effective permissions, customer entitlements (which modules are enabled), org list. The frontend uses this on load to configure the UI.

**Data pipeline changes:**

- Data source configuration moves from environment variables / hardcoded config to the Organization's `data_source_config` in the database.
- The pipeline reads `data_source_config` from the Organization entity at startup or config refresh.
- Pipeline health updates `data_pipeline_status` and `last_data_received_at` on the Organization record.

### 8.2 What Does NOT Change

- The analytics engine, BigQuery queries, and aggregation logic remain the same — they already filter by `org_id`.
- The alert engine stays the same — it already keys off `org_id`.
- Road segment data structure stays the same.
- The existing `org_id` column on all tables remains the primary data isolation key.

The change is additive: adding Customer above Org, adding RBAC + entitlements alongside the existing basic role system, and making configuration database-driven instead of hardcoded.

---

## 9. Build Phases

> **Reconciled with step PRDs (April 16, 2026):** The phase descriptions below remain accurate for _scope_, but the authoritative sequencing, dependency graph, and effort estimate now live in `00_Implementation_Index.md`. The Index expands Phase 1 into 20 numbered steps (01–22, minus 12/14 which are deferred) totalling **~13 weeks** of work with 2 BE + 2 FE in parallel. The "~8 weeks" estimate in the original §9 below was optimistic and did not account for realistic parallelism, review cycles, or Phase 1C migration risk.

**Starting point (April 2026):** Foundation is ~40% built. Better Auth is deployed with `enterprise` schema (user, account, organization, member, roles, sessions, 2FA, OAuth apps). Existing pilot cities (Pune, Dehradun, +) have data in shared `public` schema. No customer layer, no entitlements, no usage metering, no Lepton Admin. Product enforcement is hardcoded / minimal. This plan assumes AI-assisted engineering for execution speed.

### Phase 0 — Prerequisites (Week 0)

_Already done, verify state and checkpoint before starting Phase 1._

- Verify Better Auth `enterprise` schema is intact and production-ready
- Snapshot current dev DB; document existing `public.*` schema for migration reference
- Audit existing organizations: mark `org_type` column (`real_city` vs `personal`) on `enterprise.organization`
- Confirm Redis instance available (or provision Upstash/Memorystore)

### Phase 1A — Platform Schema & Customer Layer (Weeks 1–2)

_Build the layer above Better Auth without breaking what exists._

- Create `platform` schema with new tables: `customer`, `entitlement`, `usage_log`, `audit_log`, `permission_catalog`, `plan_template`, `partner_demo`, `onboarding_checklist`, `feature_flag`, `customer_feature_flag`
- Extend `enterprise.organization` with: `customer_id` FK, `data_source_config` JSONB, `city_config` JSONB, `org_type`, `data_pipeline_status`, `last_data_received_at`
- Extend `enterprise.user` with TraffiCure-specific fields (user_type, phone_verified, last_login_at, etc.) — use `additionalFields` in Better Auth user plugin
- Backfill: create `platform.customer` rows for existing pilot orgs (one customer per pilot city initially), link via `customer_id`
- Seed `permission_catalog` (starts with ~40 permissions from existing features) and default `role` templates (System Admin, Customer Admin, City Admin, Analyst, Viewer)

### Phase 1B — RBAC + Entitlement Engine (Weeks 2–3, parallel)

- Build permission-checking middleware (reads `member_organization_role` + `role_permissions`)
- Build entitlement-checking middleware (reads `platform.entitlement`, increments Redis counter, flushes to `platform.usage_log`)
- Scope-enforcement layer: wrap the ORM / query layer so every query auto-injects `WHERE organization_id IN (...)` from the user's role assignments
- Request-identity Redis cache with invalidation hooks on role/entitlement changes
- Hard-test with existing pilot data before touching product endpoints

### Phase 1C — Database Isolation Migration (Weeks 3–4)

_Move traffic data from shared `public` to schema-per-customer. See Section 6.4._

- Migration runner that creates `customer_<slug>` schemas from a template
- Dual-write or brief ingestion freeze while copying existing `public.*` data per organization
- Update ingestion pipeline to route by `organization_id` → customer schema
- App layer: `db.forCustomer(customerId).query(...)` abstraction with `search_path` setting
- Verify dashboards against migrated data; drop old `public.*` tables only after sign-off

### Phase 1D — Lepton Admin Console (Weeks 3–7, parallel with 1C)

- New Next.js app at `admin.lepton.internal` with its own Better Auth instance (or same instance, separate role set)
- Global dashboard (health, customer grid, alerts, usage trends)
- Customer CRUD + detail view (Overview, Organizations, Users, Entitlements, Usage, Audit)
- Organization management (cross-customer view + data source config + city config editor)
- User lookup (cross-customer search, permission visualization)
- Entitlement management (visual editor, plan templates, usage vs. limit bars)
- Onboarding checklist (auto-generated per new customer)
- Partner demo lifecycle (create wizard, auto-suspension daily job)
- Permission catalog, role templates, feature flags UI
- Audit logging wired from every admin action

### Phase 1E — Product Integration (Weeks 7–8)

- Wire enforcement middleware into all existing TraffiCure API endpoints
- Update frontend to dynamically render nav and UI based on permissions + entitlements
- Move data source config from env vars to `enterprise.organization.data_source_config`
- Build `/me` endpoint returning full user context (profile, roles, effective permissions, customer entitlements, org list)
- Smoke test with all pilot customers before any cutover

### Phase 2 — Hardening + Client Admin Module (Deferred — when first 1–2 contracts are signed)

- **Auth hardening (Step 15 Full):** WebAuthn/passkeys, MFA policy engine, OTP rate limiting, brute-force lockout, session hijack detection, credential rotation, suspicious login alerts
- **Data retention (Step 12):** automated pruning per policy, right-to-delete workflows
- **Billing/metering (Step 14):** automated invoice generation from `usage_log`
- **Observability contract (Step 24):** formal metric/trace/log naming + SLOs
- **Error catalogue & runbook (Step 23):** canonical error codes + RCA playbooks
- User management UI inside TraffiCure (for Customer Admins)
- Role assignment UI (pick role + scope)
- Self-service usage dashboard
- Customer-scoped audit log viewer
- Branding configuration (logo, colors)

### Phase 3 — Scale Features (Deferred — when 5–10 customers active)

- WorkOS integration for enterprise SSO (per-customer)
- API key management and developer portal
- Advanced usage analytics, quota-approach alerts
- Feature flag management UI (rollout controls, per-customer toggles)
- Multi-region database isolation for data-residency customers
- White-label / co-branding configuration
- Partner self-service portal

### Effort estimate

**Authoritative estimate lives in `00_Implementation_Index.md`: ~13 weeks to Phase 1 MVP complete** with 2 backend + 2 frontend engineers. The original "~8 weeks" figure in v2.0 of this PRD did not account for the Step 15 trim replacement, realistic parallelism across 20 steps, or review cycles. Phase 1C (schema migration, Step 08) remains the highest-risk work; a buffer week per production customer with live data is still advised.

---

## 10. Database Schema Reference (PostgreSQL DDL)

This DDL is written against the current database state: `enterprise.*` already exists from Better Auth, so all new tables go into a new `platform` schema. Existing `enterprise.organization` and `enterprise.user` are extended with ALTER TABLE, not recreated.

```sql
-- =============================================================
-- PREREQUISITE: create new schema for TraffiCure platform layer
-- (enterprise schema already exists, owned by Better Auth)
-- =============================================================
CREATE SCHEMA IF NOT EXISTS platform;

-- =============================================================
-- platform.customer  (the contract/billing entity)
-- =============================================================
CREATE TABLE platform.customer (
    customer_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    customer_type           VARCHAR(50) NOT NULL CHECK (customer_type IN ('production', 'pilot', 'partner_demo', 'internal')),
    contract_start_date     DATE,
    contract_end_date       DATE,
    status                  VARCHAR(50) NOT NULL DEFAULT 'onboarding' CHECK (status IN ('active', 'suspended', 'expired', 'churned', 'onboarding')),
    billing_contact_name    VARCHAR(255),
    billing_contact_email   VARCHAR(255),
    primary_contact_name    VARCHAR(255),
    primary_contact_email   VARCHAR(255),
    primary_contact_phone   VARCHAR(50),
    partner_id              UUID,                     -- FK to partners table if/when created
    branding_config         JSONB DEFAULT '{}',
    db_schema_name          VARCHAR(100) NOT NULL,    -- e.g., 'customer_pune' — where this customer's traffic data lives
    db_connection_string    TEXT,                     -- NULL = same instance; set for regional isolation
    onboarded_by            UUID,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_customer_status ON platform.customer(status);
CREATE UNIQUE INDEX idx_customer_db_schema ON platform.customer(db_schema_name);

-- =============================================================
-- EXTEND enterprise.organization (existing Better Auth org table)
-- =============================================================
ALTER TABLE enterprise.organization
    ADD COLUMN customer_id          UUID REFERENCES platform.customer(customer_id),
    ADD COLUMN org_type              VARCHAR(50) DEFAULT 'real_city'
        CHECK (org_type IN ('real_city', 'personal', 'partner_demo', 'internal')),
    ADD COLUMN city                  VARCHAR(255),
    ADD COLUMN country               VARCHAR(10),
    ADD COLUMN timezone              VARCHAR(100) DEFAULT 'Asia/Kolkata',
    ADD COLUMN data_source_type      VARCHAR(50) CHECK (data_source_type IN ('bigquery', 'pubsub', 'both')),
    ADD COLUMN data_source_config    JSONB DEFAULT '{}',
    ADD COLUMN city_config           JSONB DEFAULT '{}',
    ADD COLUMN segment_count         INTEGER DEFAULT 0,
    ADD COLUMN org_status            VARCHAR(50) DEFAULT 'data_loading'
        CHECK (org_status IN ('active', 'data_loading', 'suspended', 'archived')),
    ADD COLUMN data_pipeline_status  VARCHAR(50) DEFAULT 'healthy'
        CHECK (data_pipeline_status IN ('healthy', 'delayed', 'stale', 'error')),
    ADD COLUMN last_data_received_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX idx_org_customer ON enterprise.organization(customer_id);
CREATE INDEX idx_org_type ON enterprise.organization(org_type);

-- =============================================================
-- EXTEND enterprise.user (existing Better Auth user table)
-- Add via Better Auth's additionalFields config to keep ORM in sync
-- =============================================================
ALTER TABLE enterprise.user
    ADD COLUMN user_type          VARCHAR(50) DEFAULT 'client_user'
        CHECK (user_type IN ('lepton_internal', 'customer_admin', 'client_user', 'partner_user')),
    ADD COLUMN phone               VARCHAR(50),
    ADD COLUMN phone_verified      BOOLEAN DEFAULT FALSE,
    ADD COLUMN full_name           VARCHAR(255),
    ADD COLUMN last_login_at       TIMESTAMP WITH TIME ZONE,
    ADD COLUMN login_count         INTEGER DEFAULT 0,
    ADD COLUMN user_status         VARCHAR(50) DEFAULT 'invited'
        CHECK (user_status IN ('active', 'invited', 'suspended', 'deactivated')),
    ADD COLUMN created_by          UUID,
    ADD COLUMN deactivated_at      TIMESTAMP WITH TIME ZONE,
    ADD COLUMN deactivated_by      UUID;

CREATE INDEX idx_user_phone ON enterprise.user(phone) WHERE phone IS NOT NULL;

-- =============================================================
-- platform.permission_catalog  (the registry of all permissions)
-- Better Auth's organization_role.permissions is a JSONB bundle;
-- this is the authoritative enum of valid permission codes.
-- =============================================================
CREATE TABLE platform.permission_catalog (
    permission_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(100) NOT NULL UNIQUE,    -- e.g. 'analytics.view'
    module          VARCHAR(100) NOT NULL,           -- e.g. 'analytics'
    description     TEXT,
    category        VARCHAR(100),                    -- e.g. 'read', 'write', 'admin'
    deprecated      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: ROLES live in enterprise.organization_role (customer-scoped)
-- and enterprise.platform_role (system-wide). We do NOT create a new roles table.
-- Role-to-permission mapping lives in the 'permissions' JSONB column of those tables;
-- permission_catalog gives us the UI lookup and validation set.

-- =============================================================
-- ROLE ASSIGNMENTS — use existing enterprise.member_organization_role
-- Add scope_type / scope_id to support org + zone scoping
-- =============================================================
ALTER TABLE enterprise.member_organization_role
    ADD COLUMN scope_type   VARCHAR(50) DEFAULT 'organization'
        CHECK (scope_type IN ('customer', 'organization', 'zone')),
    ADD COLUMN scope_id     UUID;
    -- When scope_type='organization', scope_id = organization.id
    -- When scope_type='customer', scope_id = customer_id (all orgs under customer)
    -- When scope_type='zone', scope_id = road_hierarchy.zone.zone_id

CREATE INDEX idx_member_role_scope ON enterprise.member_organization_role(scope_type, scope_id);

-- =============================================================
-- platform.entitlement
-- =============================================================
CREATE TABLE platform.entitlement (
    entitlement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES platform.customer(customer_id) ON DELETE CASCADE,
    entitlement_type    VARCHAR(100) NOT NULL,    -- e.g. 'seat_limit', 'ask_ai_queries', 'module_access'
    module              VARCHAR(100),              -- e.g. 'citypulse', 'analytics' (NULL = global)
    limit_value         BIGINT,                    -- NULL for pure module_access boolean entitlements
    period              VARCHAR(50) DEFAULT 'unlimited' CHECK (period IN ('monthly', 'annual', 'unlimited')),
    enforcement         VARCHAR(50) DEFAULT 'hard' CHECK (enforcement IN ('hard', 'soft', 'track_only')),
    enabled             BOOLEAN DEFAULT TRUE,      -- used for module_access entitlements
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by          UUID,
    UNIQUE(customer_id, entitlement_type, module)
);

CREATE INDEX idx_entitlement_customer ON platform.entitlement(customer_id);

-- =============================================================
-- platform.usage_log  (partitioned by month)
-- =============================================================
CREATE TABLE platform.usage_log (
    usage_id        UUID DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL,
    organization_id UUID,
    user_id         UUID NOT NULL,
    usage_type      VARCHAR(100) NOT NULL,
    module          VARCHAR(100),
    quantity        INTEGER DEFAULT 1,
    metadata        JSONB DEFAULT '{}',
    timestamp       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (usage_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_usage_customer_type ON platform.usage_log(customer_id, usage_type, timestamp);
CREATE INDEX idx_usage_user ON platform.usage_log(user_id, timestamp);
-- Partition management: pg_partman or cron creates monthly partitions

-- =============================================================
-- platform.audit_log  (partitioned by month)
-- =============================================================
CREATE TABLE platform.audit_log (
    audit_id        UUID DEFAULT gen_random_uuid(),
    customer_id     UUID,
    organization_id UUID,
    actor_id        UUID NOT NULL,
    actor_type      VARCHAR(50) NOT NULL CHECK (actor_type IN ('client_user', 'lepton_admin', 'system')),
    action          VARCHAR(255) NOT NULL,
    target_type     VARCHAR(100),
    target_id       UUID,
    details         JSONB DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    timestamp       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (audit_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_audit_customer ON platform.audit_log(customer_id, timestamp);
CREATE INDEX idx_audit_actor ON platform.audit_log(actor_id, timestamp);
CREATE INDEX idx_audit_action ON platform.audit_log(action, timestamp);

-- =============================================================
-- platform.partner_demo
-- =============================================================
CREATE TABLE platform.partner_demo (
    demo_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             UUID NOT NULL REFERENCES platform.customer(customer_id) ON DELETE CASCADE,
    partner_company         VARCHAR(255) NOT NULL,
    partner_contact_name    VARCHAR(255),
    partner_contact_email   VARCHAR(255),
    expiry_date             DATE NOT NULL,
    max_segments            INTEGER,
    demo_purpose            TEXT,
    auto_suspend_on_expiry  BOOLEAN DEFAULT TRUE,
    created_by              UUID,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (customer_id)
);

CREATE INDEX idx_partner_demo_expiry ON platform.partner_demo(expiry_date)
    WHERE auto_suspend_on_expiry = TRUE;

-- =============================================================
-- platform.onboarding_checklist
-- =============================================================
CREATE TABLE platform.onboarding_checklist (
    checklist_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES platform.customer(customer_id) ON DELETE CASCADE,
    item_key        VARCHAR(100) NOT NULL,
    item_label      TEXT NOT NULL,
    is_required     BOOLEAN DEFAULT TRUE,
    is_completed    BOOLEAN DEFAULT FALSE,
    completed_at    TIMESTAMP WITH TIME ZONE,
    completed_by    UUID,
    notes           TEXT,
    sort_order      INTEGER DEFAULT 0,
    UNIQUE(customer_id, item_key)
);

CREATE INDEX idx_onboarding_customer ON platform.onboarding_checklist(customer_id);

-- =============================================================
-- platform.feature_flag + customer_feature_flag
-- =============================================================
CREATE TABLE platform.feature_flag (
    flag_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key        VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    is_global       BOOLEAN DEFAULT FALSE,
    global_enabled  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE platform.customer_feature_flag (
    customer_id UUID NOT NULL REFERENCES platform.customer(customer_id) ON DELETE CASCADE,
    flag_id     UUID NOT NULL REFERENCES platform.feature_flag(flag_id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (customer_id, flag_id)
);

-- =============================================================
-- platform.plan_template  (quick-apply entitlement bundles)
-- =============================================================
CREATE TABLE platform.plan_template (
    template_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,        -- "Pilot", "Standard", "Enterprise"
    description     TEXT,
    entitlements    JSONB NOT NULL,                -- array of entitlement objects to apply on selection
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================
-- CUSTOMER DATA SCHEMAS  (one per customer, created by Lepton Admin onboarding)
-- Template for what gets created per-customer:
-- =============================================================
-- CREATE SCHEMA customer_pune;
-- CREATE TABLE customer_pune.road_segment (...);
-- CREATE TABLE customer_pune.traffic_observation (...) PARTITION BY RANGE (timestamp);
-- CREATE TABLE customer_pune.traffic_metric (...);
-- CREATE TABLE customer_pune.analytics_hourly_road_metrics (...);
-- CREATE TABLE customer_pune.alert (...);
-- CREATE TABLE customer_pune.alert_policy_config (...);
-- CREATE TABLE customer_pune.baselines (...);
-- CREATE TABLE customer_pune.cities (...);
-- CREATE TABLE customer_pune.corridor (...);          -- from road_hierarchy
-- CREATE TABLE customer_pune.zone (...);
-- CREATE TABLE customer_pune.division (...);
-- CREATE TABLE customer_pune.junction (...);
-- CREATE TABLE customer_pune.locality (...);
--
-- GRANT USAGE ON SCHEMA customer_pune TO pune_service_role;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customer_pune TO pune_service_role;
```

### Tables NOT created (already exist in Better Auth `enterprise` schema)

These remain as-is and the platform layer extends/references them:

| Table                                                                 | Purpose                            | Notes                                                                |
| --------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `enterprise.user`                                                     | User identity                      | Extended with user_type, phone, full_name, status                    |
| `enterprise.account`                                                  | OAuth provider linkages            | Not modified                                                         |
| `enterprise.session`                                                  | Session tokens                     | Not modified                                                         |
| `enterprise.organization`                                             | City / org                         | Extended with customer_id, org_type, data_source_config, city_config |
| `enterprise.member`                                                   | User-to-org membership             | Not modified                                                         |
| `enterprise.organization_role`                                        | Per-org roles + permissions JSONB  | Drives RBAC                                                          |
| `enterprise.platform_role`                                            | System-wide roles (Lepton admin)   | Drives internal RBAC                                                 |
| `enterprise.member_organization_role`                                 | Role assignments                   | Extended with scope_type, scope_id                                   |
| `enterprise.two_factor`, `verification`, `jwks`, `invitation`         | Auth primitives                    | Not modified                                                         |
| `enterprise.oauth_application`, `oauth_access_token`, `oauth_consent` | If TraffiCure is an OAuth provider | Not modified                                                         |

---

## 11. Key Architectural Decisions & Rationale

### 11.1 Why Customer ≠ Organization

A single customer (contract holder) may operate in multiple cities. The Customer is the billing/entitlement boundary; the Organization is the data/operational boundary. Conflating them forces per-city contracts and fractures the admin experience for multi-city customers.

### 11.2 Why entitlements are data, not code

Entitlement limits stored in the database (not config files, not environment variables, not code) means plan changes never require a deployment. Lepton admin changes an entitlement row; the next request picks it up (after cache TTL). This is critical for sales flexibility — adjusting a plan mid-contract should be a 30-second admin action, not an engineering ticket.

### 11.3 Why RBAC with scope, not hardcoded user types

Hardcoded user types (admin, viewer, operator) seem simpler but create two problems: clients can't customize roles to match their org structure, and adding new permission dimensions requires code changes. The role + permission + scope model is slightly more complex to build but infinitely more flexible to operate.

### 11.4 Why Better Auth over Auth0 or building custom

Better Auth gives us the security guarantees of a mature library (proper password hashing, session management, OAuth flows, 2FA, CSRF protection) while keeping all identity data in our own PostgreSQL. This is worth a lot to government customers with residency requirements. Auth0 would add $1.5–3K/month at our scale and force all user data through a third-party. Building custom auth is existential risk territory — 3–6 months of engineering plus ongoing security maintenance. Better Auth is the pragmatic middle path.

### 11.5 Why schema-per-customer for traffic data

Traffic observation tables grow at 100+ GB per city. As customers multiply, we need four properties that shared-table isolation can't give us cleanly: (a) proof of segregation for sovereignty audits, (b) per-customer backup and restore, (c) clean contract-exit deletion, (d) crash protection — no query can accidentally leak cross-customer data. Schema-per-customer on a shared PostgreSQL instance gets all four without the operational cost of database-per-customer.

### 11.6 Why the Lepton Admin is a separate application

The Lepton Admin has fundamentally different security requirements (internal only, VPN/IP restriction, stricter MFA), different users (Lepton employees, not clients), and different scaling characteristics (low traffic, high privilege). Embedding it in the TraffiCure product creates a security surface area risk and makes it harder to iterate on independently. It also serves as a forcing function: if a behavior must be configurable in the admin, engineers can't hardcode it.

### 11.7 Why usage logging uses Redis + PostgreSQL

Real-time enforcement needs sub-millisecond counter checks (Redis). Historical reporting and billing needs durable, queryable records (PostgreSQL). The background flush (Redis → PostgreSQL every minute) bridges both needs without making either system do what it's bad at.

---

## 12. Open Questions

1. **Billing integration:** Is billing handled manually (invoices) or through a billing system (Stripe, Chargebee)? This determines whether entitlements are manually configured or auto-provisioned from a billing event. Relevant once first 2–3 paid contracts sign.

2. **Mobile app auth:** The existing Admin Architecture doc references mobile app access. Does the mobile app use Better Auth sessions via a native SDK, or do we issue long-lived refresh tokens? Also: biometric re-auth after initial login?

3. **Data source credentials:** The `data_source_config` JSON references BigQuery/PubSub credentials. These should be in GCP Secret Manager, not in the database. Need to define the credential management strategy and how Lepton Admin UI references them without ever displaying raw values.

4. **Notification system:** Entitlement limit warnings, pipeline health alerts, and customer expiry notifications need a channel. Email (Resend? SES?), Slack, in-app? Likely all three with routing rules.

5. **Rate limiting scope:** API-gateway rate limiting is separate from entitlement query quotas. Need to define: per-user rate limits (requests/second), per-customer rate limits, and how they interact with entitlement quotas. Likely use Better Auth's built-in rate limit for auth endpoints and add a separate layer (Upstash Redis) for product endpoints.

6. **Schema migration tooling:** With schema-per-customer, every DDL change must apply to N schemas. Options: Sqitch, Flyway with customer-schema plugin, or a custom migration runner. Decision needed before first schema split.

7. **Cross-customer analytics for Lepton Admin:** Some admin dashboards need cross-customer aggregates (e.g., "total DAU across all customers"). Options: denormalized rollup table in `platform` schema, or `postgres_fdw` with a read-only superuser role. Denormalized is simpler and faster; fdw is more flexible. Lean toward denormalized for v1.

8. **WorkOS integration trigger:** At what customer count / contract value does SSO become worth the $125/connection/month? Likely the first customer that makes it a contractual requirement, regardless of count.
