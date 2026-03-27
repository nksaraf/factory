# Product Requirements Document

# **Fleet Plane (Factory-Level Deployment & Lifecycle Governance)**

**Document Owner:** Nikhil
**Version:** 0.1 (Draft)
**Last Updated:** March 2026
**Status:** RFC — Request for Comments

---

## 1. Purpose

The Fleet Plane is the deployment and lifecycle governance layer within the Factory. It is the **only product-aware Factory plane** — every other Factory plane is product-agnostic. Fleet treats product as a dimension of its data model, not a separate workflow.

It is responsible for:

- Site lifecycle management (create, upgrade, rollback, suspend, decommission)
- Product-to-site mapping
- Release management and module version pinning
- Tenant assignment for shared sites
- Deployment orchestration (rolling, canary, blue-green)
- Entitlement and configuration distribution to sites
- Fleet-wide health monitoring and alerting
- Partner-operated site governance

It does **not**:

- Define what gets built (Product Plane)
- Build artifacts or manage CI/CD (Build Plane)
- Manage billing, pricing, or commercial relationships (Commerce Plane)
- Provision infrastructure primitives (Infrastructure Plane)
- Enforce runtime identity or access control (Control Plane)
- Execute business logic (Service Plane)

---

## 2. Design Principles

1. **Product is a data dimension, not a workflow fork.** Fleet manages Trafficure, NetworkAccess, SmartMarket, and future products with the same tooling. The product identifier is a column, not a separate deployment pipeline.

2. **Site autonomy is sacred.** Fleet has authority over site lifecycle (create, upgrade, rollback, decommission). The site has authority over its own runtime. Fleet never reaches into a running site to modify identity, policies, or data directly.

3. **Entitlement drives topology.** Commerce Plane decides what a customer gets. Fleet Plane decides where it runs. The entitlement determines whether a customer gets a shared tenant slot or a dedicated site — Fleet executes that decision, it does not make commercial judgments.

4. **Sites pull desired state; Fleet never pushes.** Fleet computes and publishes the site manifest — the authoritative desired state for each site. Sites pull their manifest on a regular interval and converge toward it. Fleet may send a lightweight hint ("your manifest changed") to trigger an immediate pull, but the hint is an optimization, not a requirement. If the hint is lost, the next poll catches it. This model is consistent across all deployment types — SaaS, self-hosted, and air-gapped sites all pull. Air-gapped sites pull from an offline bundle instead of an API.

5. **Shared sites are pre-provisioned.** Tenant assignment is a database insert, not infrastructure provisioning. Signup-to-running must be near-instant for shared sites.

6. **Upgrades are reversible.** Every deployment must support rollback. No upgrade strategy may leave a site in an unrecoverable state.

7. **Partner delegation is explicit and scoped.** Partners may operate sites on behalf of customers. Their authority is granted, bounded, and auditable — never implicit.

8. **Air-gapped is not an afterthought.** Every Fleet operation must have an offline equivalent. If a workflow requires real-time Factory connectivity, it is a bug.

---

## 3. Core Concepts

### 3.1 Site

A running instance of a product in a specific customer environment. Self-governing at runtime. Contains its own Control Plane, Service Plane, Data Plane, and local Infrastructure Plane.

Attributes:

- `site_id`
- `product_id`
- `deployment_type` (shared_saas, dedicated_saas, self_hosted_connected, self_hosted_airgapped)
- `operator` (company, partner, customer)
- `provider` (cloud provider or "on_prem")
- `region`
- `environment` (dev, staging, prod)
- `channel` (stable, beta)
- `lifecycle_state` (provisioning, active, suspended, decommissioning, decommissioned)
- `current_release_id`

---

### 3.2 Tenant

A customer's isolated partition within a shared site. In shared sites, many tenants coexist. In dedicated sites, there is exactly one tenant.

Attributes:

- `tenant_id`
- `site_id`
- `namespace_id` (maps to Control Plane namespace)
- `customer_account_id` (from Commerce Plane)
- `entitlement_bundle_id`
- `tenant_state` (active, restricted, suspended, terminated)

---

### 3.3 Release

A deployable bundle — a specific collection of module versions that have been tested together and are approved for deployment.

Attributes:

- `release_id`
- `product_id`
- `version` (semver)
- `channel` (stable, beta)
- `release_state` (draft, testing, approved, deprecated)
- `created_at`

A release is not a product plan or a roadmap item. It is the output of Build Plane, consumed by Fleet Plane.

---

### 3.4 Release Module Pin

The binding between a release and the specific module versions it includes.

```
release 1 — N release_module_pin
release_module_pin N — 1 module_version
```

Example:

```
Release: trafficure-2.4.0
├── geoanalytics    2.3.0
├── auth-service    1.4.1
├── workflow-engine 3.1.0
└── dashboard       2.0.0
```

---

### 3.5 Rollout

An execution plan for deploying a release to one or more sites.

Attributes:

- `rollout_id`
- `release_id`
- `strategy` (rolling, canary, blue_green, immediate)
- `rollout_state` (planned, in_progress, paused, completed, failed, rolled_back)
- `created_by` (principal or automation)

---

### 3.6 Rollout Step

A single step within a rollout — typically one site or one batch of sites.

Attributes:

- `rollout_step_id`
- `rollout_id`
- `site_id`
- `step_state` (pending, in_progress, succeeded, failed, rolled_back)
- `started_at`
- `completed_at`
- `health_check_result`

---

### 3.7 Site Manifest

The desired state of a site — which release, which modules, which entitlements should be active. Fleet computes the manifest; the site pulls it and converges toward it. The manifest is the **single source of truth** for what a site should look like.

Attributes:

- `manifest_id`
- `site_id`
- `manifest_version` (monotonically increasing, used for change detection)
- `manifest_hash` (content hash for integrity verification)
- `computed_at` (when Fleet last recomputed this manifest)

Contents:

```
site_manifest
├── manifest_version
├── manifest_hash
├── target_release
│   ├── release_id
│   ├── release_version
│   └── module_pins[]
├── tenant_states[]
│   ├── tenant_id
│   ├── entitlement_bundle (signed)
│   └── tenant_state (active, restricted, suspended, terminated)
├── configuration
│   ├── platform_config
│   ├── feature_flags
│   └── module_config_defaults
└── infrastructure_requirements
```

The site stores the last-applied manifest version. On each pull, it compares versions. If the manifest version has changed, the site diffs and converges. If unchanged, no action.

For air-gapped sites, the manifest is embedded in the offline bundle.

---

### 3.8 Site Health Snapshot

A periodic capture of site health — used for fleet-wide monitoring, upgrade decisions, and capacity planning.

Attributes:

- `snapshot_id`
- `site_id`
- `timestamp`
- `fleet_plane_status`
- `service_plane_status`
- `data_plane_status`
- `infra_status`
- `tenant_count`
- `resource_utilization`
- `error_rates`

---

## 4. Functional Requirements

---

### 4.1 Site Lifecycle

Fleet must manage the full lifecycle of every site.

#### 4.1.1 Site Creation

Fleet must support creating sites for all deployment types:

```
Commerce Plane                    Fleet Plane
│                                 │
│ Entitlement created ─────────►  │ Evaluate deployment type
│                                 │
│                                 ├─► Shared SaaS:
│                                 │   assign tenant to existing site
│                                 │
│                                 ├─► Dedicated SaaS:
│                                 │   provision new site
│                                 │   (triggers Infrastructure Plane)
│                                 │
│                                 ├─► Self-hosted (connected):
│                                 │   register site
│                                 │   generate bootstrap config
│                                 │
│                                 └─► Self-hosted (air-gapped):
│                                     register site
│                                     generate offline bundle
```

For shared SaaS, site creation is **not** triggered — the site already exists. Fleet assigns a tenant slot. This must complete in under 2 seconds.

For dedicated and self-hosted sites, Fleet generates:

- `site_bootstrap_config` (identity, initial policies, secrets)
- `site_identity` (mTLS certificate or bootstrap token)
- `deployment_manifest` (Helm chart values, module pins)

---

#### 4.1.2 Tenant Assignment

When Commerce Plane creates an entitlement for a customer that maps to a shared site:

1. Fleet selects the target shared site (based on product, region, capacity).
2. Fleet creates a tenant record linking customer to site.
3. Fleet pushes entitlement bundle to the site.
4. Site's Control Plane provisions a namespace.
5. Site's Service Plane enables modules per entitlement.
6. Site's Data Plane initializes tenant-scoped storage.

Selection criteria for shared site:

- Product match (tenant must go to a site running the right product)
- Region match (data residency, latency)
- Capacity (tenant count, resource headroom)
- Channel match (beta tenants go to beta sites)

---

#### 4.1.3 Site Suspension

Triggered by Commerce Plane when entitlement state transitions to `suspended`.

```
Commerce Plane                    Fleet Plane                Site
│                                 │                          │
│ Entitlement: suspended ──────►  │ Push suspend command ──► │
│                                 │                          │ Control Plane:
│                                 │                          │   disable auth
│                                 │                          │   block API access
│                                 │                          │ Data Plane:
│                                 │                          │   preserve data
│                                 │                          │   stop writes
```

For shared sites, only the affected tenant is suspended. Other tenants continue normally.

For dedicated sites, the entire site is suspended.

Data must be preserved during suspension. Suspension is reversible.

---

#### 4.1.4 Site Decommissioning

Triggered by Commerce Plane when entitlement state transitions to `terminated` and the data retention period expires.

Decommissioning must:

- Export audit logs (if required by policy)
- Delete tenant data per retention policy
- Remove tenant record (shared sites)
- Destroy site infrastructure (dedicated sites)
- Update fleet registry
- Be irreversible after data deletion

Decommissioning must not:

- Affect other tenants on the same shared site
- Leave orphaned resources
- Proceed without confirming retention policy completion

---

### 4.2 Release Management

#### 4.2.1 Release Composition

Fleet must accept releases from Build Plane and validate them before deployment.

A release consists of:

- A set of `release_module_pin` entries (module_version bindings)
- Compatibility metadata (minimum platform version, dependency graph)
- Migration scripts (schema changes, data transformations)
- Release notes and changelog

Validation checks:

- All module versions exist in artifact registry
- Dependency graph is satisfiable (no conflicts)
- Compatibility range covers target sites
- Migration scripts are present for schema changes
- Artifacts are signed and SBOM is attached

---

#### 4.2.2 Release Channels

Sites subscribe to a release channel:

- **stable** — production-ready, fully tested
- **beta** — feature-complete, undergoing broader validation

Fleet must:

- Track which sites are on which channel
- Prevent stable sites from receiving beta releases
- Allow sites to change channels (with operator approval)
- Support per-site channel overrides for testing

---

#### 4.2.3 Release Promotion

```
Build Plane                      Fleet Plane

artifacts produced
        │
        ▼
release created (draft)
        │
        ▼
testing (internal sites)
        │
        ▼
approved (beta channel)
        │
        ▼
promoted (stable channel)
        │
        ▼
deprecated (when superseded)
```

Promotion from beta to stable requires:

- Minimum soak time on beta sites
- No critical health regressions
- Operator approval (or automated gate)

---

### 4.3 Deployment Orchestration

#### 4.3.1 Rollout Strategies

Fleet must support the following deployment strategies:

**Rolling update** — deploy to sites sequentially, with health checks between each.

```
Site 1 ──► upgrade ──► health check ──► pass
Site 2 ──► upgrade ──► health check ──► pass
Site 3 ──► upgrade ──► health check ──► pass
```

**Canary** — deploy to a small percentage of sites, monitor, then expand.

```
Canary site (5%) ──► monitor ──► expand to 25% ──► monitor ──► 100%
```

**Blue-green** — deploy to a parallel slot within the site, shift traffic.

```
Site (blue: v2.3) ────── serving traffic
Site (green: v2.4) ───── deployed, idle
                         ▼
                  traffic shift ──► green serving
                         ▼
                  blue becomes rollback target
```

**Immediate** — deploy to all targeted sites at once. Used only for critical hotfixes with operator approval.

---

#### 4.3.2 Rollout Execution

A rollout must follow this lifecycle:

1. **Plan** — select target sites, determine order, compute batches
2. **Validate** — pre-flight checks (site health, disk space, compatibility)
3. **Execute** — deploy per strategy, with health gates between steps
4. **Monitor** — observe error rates, latency, resource utilization post-deploy
5. **Complete or rollback** — mark success or revert

Rollout rules:

- A site with failing health checks must not be upgraded
- A failed step must pause the rollout (not auto-continue)
- Operator can resume, skip, or rollback a paused rollout
- Rollout state must be durable (survives Fleet Plane restart)
- Concurrent rollouts to the same site are forbidden

---

#### 4.3.3 Rollback

Fleet must support rollback at two levels:

**Site-level rollback** — revert a single site to its previous release.

**Fleet-level rollback** — halt an in-progress rollout and revert all affected sites.

Rollback must:

- Restore the previous release's module versions
- Run reverse migration scripts (if applicable)
- Restore previous site manifest
- Emit rollback events for audit

Rollback must not:

- Require Factory connectivity for execution (site must be able to rollback locally)
- Lose data created during the failed release window (schema migrations must be expand/contract)

---

### 4.4 Entitlement Distribution

Fleet is the bridge between Commerce Plane and running sites. When Commerce updates an entitlement, Fleet must propagate the change.

#### 4.4.1 Entitlement Flow (Pull + Hint)

When Commerce updates an entitlement, Fleet recomputes the affected site's manifest and increments its manifest version. The site discovers the change through its normal convergence loop.

```
Commerce Plane                    Fleet Plane                     Site
│                                 │                                │
│ Entitlement updated ─────────►  │ Recompute site manifest        │
│ (modules changed,               │ Increment manifest_version     │
│  quotas changed,                │ Sign entitlement bundle        │
│  state changed)                 │                                │
│                                 │ ── hint ("manifest changed") ─►│ (optional, best-effort)
│                                 │                                │
│                                 │ ◄── pull manifest ─────────────│ (on hint or next poll)
│                                 │                                │
│                                 │ ── return manifest ───────────►│ Validate signature
│                                 │                                │ Diff against current
│                                 │                                │ Converge:
│                                 │                                │   enable/disable modules
│                                 │                                │   update quotas
│                                 │                                │   change tenant state
│                                 │                                │
│                                 │ ◄── heartbeat (applied v42) ───│ Confirm convergence
```

Fleet must:

- Recompute the site manifest whenever any input changes (entitlement, release, configuration)
- Sign entitlement bundles with a key the site can verify offline
- Send a best-effort hint to connected sites when their manifest changes (hint loss is acceptable — the poll catches it)
- Serve manifests on demand when sites pull (GET /manifest)
- Track the last-applied manifest version per site (reported via heartbeat)
- Detect drift (site's applied version is behind computed version beyond a threshold)
- Support batch entitlement updates (e.g., plan-wide quota change recomputes all affected manifests)

---

#### 4.4.2 Entitlement State Machine

Fleet recomputes the site manifest in response to entitlement state transitions from Commerce Plane. The site discovers the new state on its next pull.

| Entitlement State | Fleet Manifest Update | Site Convergence Action |
|---|---|---|
| `trial` | Add tenant with trial modules and quotas | Provision namespace, enable trial modules |
| `active` | Set full entitlement, remove restrictions | Apply full module set and quotas |
| `upgraded` | Update module set and quota limits | Enable new modules, raise limits |
| `downgraded` | Reduce module set and quota limits | Disable modules gracefully, lower limits |
| `grace_period` | No manifest change | Site runs normally |
| `restricted` | Set tenant_state to restricted | Enforce read-only mode |
| `suspended` | Set tenant_state to suspended | Disable tenant access, preserve data |
| `terminated` | Set tenant_state to terminated | Begin decommissioning workflow |

For urgent states (restricted, suspended, terminated), Fleet sends a hint immediately after manifest recomputation to minimize the window between Commerce's decision and site enforcement. Even without the hint, the site enforces the change on the next poll (default 60 seconds).

---

### 4.5 Configuration Distribution

Beyond entitlements, Fleet embeds other configuration into the site manifest. All configuration reaches the site through the same pull-based convergence loop.

Configuration categories (all embedded in the manifest):

- **Entitlements** (Tier 1 — from Commerce, via Fleet manifest)
- **Platform configuration** (certificate rotations, security patches)
- **Feature flags** (platform-level, not product-level)
- **Module configuration defaults** (overridable at site level)

All configuration must:

- Be versioned (manifest_version increments on any change)
- Be auditable (who changed what, when — tracked in Fleet audit log)
- Be deliverable offline (embedded in air-gapped bundle's manifest)
- Not require site restart for most changes (site convergence loop handles hot-reload)

---

### 4.6 Fleet Health Monitoring

Fleet must maintain a live picture of the entire fleet's health.

#### 4.6.1 Health Collection (Site-Initiated)

Health collection follows the same site-initiated pattern as manifest pulls. The site pushes its health report to Fleet as part of a combined check-in cycle:

```
Site ──► Fleet Plane (POST /checkin)

Request payload:
  site_id
  site_identity_token
  current_manifest_version (last applied)
  health_snapshot:
    timestamp
    fleet_plane_status
    service_plane_status
    data_plane_status
    infra_status
    tenant_count
    resource_utilization
    current_release_version
    error_rates (last 5min, 1hr, 24hr)

Response payload:
  manifest_changed: true/false
  latest_manifest_version
  (optionally: the full manifest, to save a round trip)
```

This combines heartbeat and manifest polling into a single round trip. The site checks in, reports health, and learns whether its manifest is current — all in one call. If the manifest has changed, the site can either use the manifest returned in the response or fetch it separately via GET /manifest.

Check-in interval: configurable per site, default 60 seconds. Self-hosted sites may use longer intervals (5-15 minutes) to reduce bandwidth.

Missing heartbeats must trigger escalating alerts:

- 3 missed → warning
- 10 missed → critical
- 30 missed → site_unreachable state

---

#### 4.6.2 Fleet Dashboard

Fleet must provide a fleet-wide operational view:

- All sites with current status, release version, tenant count
- Sites needing upgrade (behind current stable release)
- Sites with health warnings or failures
- Rollout progress (in-flight rollouts)
- Capacity utilization across shared sites
- Release adoption curve (% of fleet on each version)

---

#### 4.6.3 Capacity Planning

For shared sites, Fleet must track:

- Current tenant count vs. maximum capacity
- Resource utilization trends
- Tenant growth rate

Fleet must alert when:

- A shared site exceeds 80% tenant capacity
- Resource utilization trends suggest capacity exhaustion within 30 days
- A region has no headroom for new tenant assignment

---

### 4.7 Self-Hosted and Air-Gapped Support

#### 4.7.1 Connected Self-Hosted

For self-hosted sites with Factory connectivity:

- Fleet registers the site and issues bootstrap credentials
- Site checks in with Fleet on a configurable interval (default 5-15 minutes for self-hosted)
- Site pulls manifest updates as part of check-in
- Site pulls release artifacts from artifact registry when manifest indicates an upgrade
- Fleet monitors health from check-in reports

Fleet must not:

- Require the site to be always connected (check-in is best-effort; the site runs fine without it)
- Fail if connectivity is intermittent (the site applies the latest manifest it has)
- Auto-deploy upgrades without site operator approval (manifest includes upgrade availability; the site operator decides when to apply)

---

#### 4.7.2 Air-Gapped

For sites with no Factory connectivity:

Fleet must produce an **offline release bundle** containing:

```
platform-release-{version}.tar
├── container_images/
├── helm_charts/
├── migration_scripts/
├── module_packages/
├── entitlement_bundle (signed)
├── license_bundle (signed)
├── sbom/
├── documentation/
└── manifest.json (checksums, versions)
```

Fleet must:

- Generate bundle on demand or on release promotion
- Include only the modules relevant to the target site's entitlement
- Sign the bundle for integrity verification
- Track which bundle version was last delivered to each air-gapped site (manually recorded)
- Support delta bundles (only changed artifacts since last delivery) for bandwidth-constrained transfers

Air-gapped upgrade flow:

```
Fleet Plane                    Transfer              Site
│                              │                     │
│ Generate bundle ──────────►  │ Secure transfer ──► │ Verify signature
│ Record delivery              │ (physical media,    │ Load images to
│                              │  secure file xfer)  │   local registry
│                              │                     │ Run installer
│                              │                     │ Verify health
```

---

#### 4.7.3 License Validation

For connected sites, license validation happens via Fleet heartbeat response.

For air-gapped sites:

- License is embedded in the entitlement bundle
- Site's Control Plane validates signature and expiry locally
- License renewal requires a new signed bundle delivered offline
- Fleet must support configurable grace periods for expired licenses

---

### 4.8 Partner-Operated Site Management

Partners (MSPs, resellers, system integrators) may operate sites on behalf of their customers. Fleet must model and govern this relationship.

#### 4.8.1 Partner Authority Models

Fleet should support tiered partner authority. The right model depends on the partner's capabilities, contractual relationship, and the customer's regulatory requirements.

**Option A — Managed Partner (Portal Access)**

Partner gets a scoped view into Fleet for their sites only. Fleet Plane retains full authority. Partner can view status, request upgrades, and manage tenants — but Fleet executes all operations.

```
Fleet Plane (full authority)
│
├── Partner Portal (scoped view)
│   ├── View site health
│   ├── Request upgrade (Fleet approves/schedules)
│   ├── Add/remove tenants
│   └── View audit logs
│
└── Execution (Fleet-operated)
    ├── Rollouts
    ├── Rollbacks
    └── Infrastructure changes
```

Best for: partners with limited technical depth, early-stage channel relationships.

**Option B — Delegated Partner (Fleet-within-Fleet)**

Partner gets a delegated Fleet scope — their own rollout authority, upgrade scheduling, and tenant management for sites assigned to them. Factory sets guardrails (allowed release channels, mandatory upgrade windows, security baselines). Partner operates within those guardrails.

```
Fleet Plane (global authority + guardrails)
│
└── Partner Fleet Scope
    ├── Own rollout scheduling
    ├── Own upgrade sequencing
    ├── Own tenant management
    ├── Own health monitoring
    └── Constrained by:
        ├── Allowed release channels
        ├── Maximum version lag (e.g., N-2)
        ├── Mandatory security patches
        └── Audit reporting requirements
```

Best for: technically capable MSPs managing many customers, sovereign deployment partners.

**Option C — Independent Partner (Sync-Back)**

Partner operates sites independently — fully disconnected from Fleet at runtime. Periodically syncs state back to Factory for licensing, usage reporting, and release coordination.

```
Factory Fleet Plane              Partner Environment
│                                │
│ Produce release bundles ────►  │ Partner deploys independently
│ Issue licenses ─────────────►  │ Partner manages lifecycle
│                                │
│ ◄──── Usage reports            │
│ ◄──── Health snapshots         │
│ ◄──── License renewal requests │
```

Best for: air-gapped environments, sovereign deployments where the customer mandates local operational control.

---

#### 4.8.2 Partner Entity Model

```
partner
├── partner_id
├── name
├── partner_tier (managed, delegated, independent)
├── authority_scope
├── allowed_products[]
├── allowed_regions[]
└── created_at

partner_site_assignment
├── partner_id
├── site_id
├── authority_level (view, operate, full)
├── constraints (JSON: max_version_lag, mandatory_patches, audit_frequency)
└── assigned_at
```

Relationships:

```
partner 1 — N partner_site_assignment
partner_site_assignment N — 1 site
partner N — M customer_account (from Commerce Plane)
```

---

#### 4.8.3 Upgrade Lifecycle by Partner Tier

| Partner Tier | Who Initiates Upgrade | Who Executes | Guardrails |
|---|---|---|---|
| Managed | Fleet (auto or operator) | Fleet | Full Fleet control |
| Delegated | Partner (within window) | Partner (via Fleet API) | Max version lag, mandatory patches, soak time |
| Independent | Partner (autonomous) | Partner (local tooling) | License-enforced version range, audit required |

For delegated partners, Fleet must enforce:

- **Maximum version lag** — partner cannot run more than N releases behind stable. If exceeded, Fleet escalates and may force-push critical updates.
- **Mandatory security patches** — certain releases are flagged as mandatory. Partner must apply within a defined window.
- **Soak time** — partner cannot skip canary/rolling process for their fleet. Immediate deployment requires explicit override.

---

#### 4.8.4 Partner Audit

All partner operations must be auditable:

- Who (partner principal) performed what action on which site
- Whether the action was within granted authority
- Whether any guardrail was overridden (and by whom)

Audit logs for partner-operated sites must be accessible to both the partner and the Factory operator.

---

### 4.9 Product-to-Site Mapping

Fleet maintains the authoritative mapping of which product runs on which site and which customers are tenants of which sites.

```
Fleet Plane
│
├── Trafficure
│   ├── saas-us-east-1 (shared)
│   │   ├── Tenant: Acme Corp
│   │   ├── Tenant: Globex
│   │   └── Tenant: Initech
│   ├── saas-eu-west-1 (shared)
│   │   └── Tenant: Siemens
│   ├── samsung-prod (dedicated)
│   └── abudhabi-dot (dedicated, air-gapped)
│
├── NetworkAccess
│   ├── saas-us-east-1 (shared)
│   └── indus-towers-prod (dedicated)
│
└── SmartMarket
    └── saas-us-east-1 (shared)
```

Fleet must support:

- Querying all sites for a product
- Querying all tenants on a site
- Querying which site a customer is assigned to
- Querying fleet composition by product, region, deployment type, release version

---

### 4.10 Tenant Migration

In rare cases, a tenant must move from a shared site to a dedicated site (or between shared sites).

Triggers:

- Customer upgrades to an enterprise plan requiring isolation
- Regulatory requirement for data residency change
- Performance isolation (noisy neighbor)

Migration flow:

```
Fleet Plane                    Source Site              Target Site
│                              │                        │
│ Create target site ──────────────────────────────────► │ Provision
│ Initiate migration ────────► │ Enter read-only ──────► │
│                              │ Export data ───────────► │ Import data
│                              │                        │ Verify integrity
│ Switch DNS / routing ────────────────────────────────► │ Accept traffic
│ Decommission source tenant ► │ Cleanup                │
```

Migration must:

- Be planned and scheduled (not automatic)
- Minimize downtime (target: < 15 minutes read-only window)
- Preserve all tenant data, configuration, and audit history
- Be reversible before the cutover point
- Emit events for Commerce Plane (billing address changes) and audit

---

### 4.11 Site Convergence Loop

The pull+hint model defines a consistent pattern for how every site — regardless of deployment type — stays in sync with Fleet's desired state.

#### 4.11.1 The Convergence Loop

Every site runs a continuous reconciliation loop:

```
┌─────────────────────────────────────────────────────────┐
│                  Site Convergence Loop                    │
│                                                          │
│  1. Check in with Fleet (POST /checkin)                  │
│     ├── Report health snapshot                           │
│     ├── Report current manifest_version                  │
│     └── Receive: manifest_changed? + latest manifest     │
│                                                          │
│  2. If manifest changed:                                 │
│     ├── Diff new manifest against current state          │
│     ├── Compute convergence actions                      │
│     │   ├── Entitlement changes → Control Plane          │
│     │   ├── Module changes → Service Plane               │
│     │   ├── Config changes → apply locally               │
│     │   └── Upgrade available → queue for operator       │
│     ├── Execute convergence actions                      │
│     └── Update local manifest_version                    │
│                                                          │
│  3. If manifest unchanged:                               │
│     └── No action (loop sleeps until next interval)      │
│                                                          │
│  4. Sleep until next interval (or hint received)         │
└─────────────────────────────────────────────────────────┘
```

#### 4.11.2 The Hint Channel

For connected sites, an optional hint channel accelerates convergence. The site opens an outbound SSE or WebSocket connection to Fleet. Fleet sends a lightweight signal when the site's manifest changes. The site immediately triggers a pull.

```
Site ──── outbound SSE connection ────► Fleet

Fleet detects manifest change for site_id=X
Fleet sends: { "type": "manifest_changed", "version": 43 }

Site receives hint
Site immediately runs convergence loop (step 1 above)
```

Properties of the hint channel:

- **Site-initiated outbound** — no inbound ports required on the site. Works through firewalls and NAT.
- **Best-effort** — if the connection drops, the site falls back to polling. No delivery guarantees needed.
- **Stateless on Fleet side** — Fleet maintains a set of active SSE connections. If a site disconnects, Fleet does nothing. The site reconnects when it can.
- **Not required** — air-gapped sites, firewalled sites, and intermittently connected sites operate without a hint channel. The poll interval is the only delivery mechanism.

#### 4.11.3 Consistency Across Deployment Types

| Deployment Type | Check-in Interval | Hint Channel | Manifest Source |
|---|---|---|---|
| SaaS shared | 30-60 seconds | Yes (SSE) | Fleet API |
| SaaS dedicated | 60 seconds | Yes (SSE) | Fleet API |
| Self-hosted connected | 5-15 minutes | Optional | Fleet API |
| Self-hosted intermittent | On-connect (e.g., daily sync window) | No | Fleet API (when connected) |
| Air-gapped | Manual (on bundle delivery) | No | Offline bundle manifest |

The convergence loop is identical in all cases. Only the trigger frequency and manifest source change.

#### 4.11.4 Drift Detection

Fleet tracks the last-applied manifest version per site (reported in each check-in). If a site's applied version falls behind the current computed version beyond a configurable threshold, Fleet marks the site as `drifted`.

Drift states:

- **current** — site has applied the latest manifest
- **pending** — manifest changed recently, site hasn't checked in yet (within normal interval)
- **drifted** — site has missed multiple check-in intervals without applying the latest manifest
- **unreachable** — site has not checked in at all beyond the escalation threshold

Drift alerts enable Fleet operators to identify sites that may have connectivity issues or convergence failures.

---

### 4.12 Enterprise, Government, and Defense Deployments

Platform Fabric targets regulated industries — telecom, transportation, government, and defense. These customers have IT environments, compliance requirements, and operational constraints that are fundamentally different from typical SaaS customers. Fleet must be designed from the ground up to operate in these environments, not adapted after the fact.

#### 4.12.1 Deployment Environment Characteristics

Enterprise government and defense IT environments share several patterns that directly affect Fleet's design:

**Network restrictions.** Sites may operate behind multiple layers of firewalls, in DMZs, on classified networks, or fully air-gapped. Outbound connectivity may be restricted to specific ports and protocols, routed through proxies, or completely absent. The pull model is essential here — the site initiates all connections outward (or operates with no connection at all).

**Change control processes.** These organizations do not accept automated deployments. Every upgrade must go through a formal change advisory board (CAB) process — documented, reviewed, approved, and scheduled within a maintenance window. Fleet must support upgrade proposals that can be reviewed externally, not just "here's a new version, apply it."

**Multi-authority environments.** The customer's IT team, a system integrator, a security team, and the vendor (us) may all have different responsibilities for the same site. Fleet must support multiple principals with clearly scoped authority over the same deployment.

**Compliance and certification.** Deployments may require specific compliance certifications (FedRAMP, ISO 27001, SOC 2, IRAP, Common Criteria). The release itself may need to be a certified version — customers cannot accept arbitrary updates, only versions that have passed their compliance review.

**Long-lived versions.** Government and defense customers may run the same version for years. Fleet must support sites that are deliberately many versions behind stable, without treating them as failures or forcing upgrades.

**Physical infrastructure.** Sites may run on bare metal in customer-owned data centers, not cloud infrastructure. There is no API to provision clusters or scale node pools — infrastructure changes require physical access and coordination with the customer's operations team.

#### 4.12.2 Fleet Capabilities for Regulated Deployments

**Upgrade Proposal Package**

For environments with formal change control, Fleet must produce an upgrade proposal package — a document-ready artifact that the customer's CAB can review.

```
upgrade_proposal
├── current_version
├── target_version
├── changelog (human-readable)
├── security_advisories_addressed[]
├── breaking_changes[]
├── migration_impact_assessment
│   ├── estimated_downtime
│   ├── rollback_plan
│   ├── data_migration_scope
│   └── resource_requirements_delta
├── test_report (from Build Plane)
├── vulnerability_report
├── sbom_diff (what dependencies changed)
└── compliance_attestation (if applicable)
```

Fleet generates this package on demand. The customer's team reviews it through their internal process. When approved, the customer's operator schedules and applies the upgrade using the offline bundle or through a connected pull.

**Version Pinning and Long-Term Support**

Fleet must support version pinning policies per site:

- **Pin to specific version** — site stays on version X until explicitly released
- **Pin to major version** — site accepts patches within a major version, but not major upgrades
- **Follow channel with delay** — site follows stable channel but with an N-week delay (e.g., only apply releases that have been stable for 90 days)
- **Manual only** — site never auto-upgrades. All upgrades are operator-initiated.

For defense and government, "manual only" with upgrade proposal review is the expected model.

**Compliance-Gated Releases**

Fleet must support tagging releases with compliance status:

```
release
├── compliance_status
│   ├── fedramp: pending
│   ├── iso27001: certified
│   └── soc2: certified
└── compliance_gate: only deploy to sites requiring these certs if certified
```

Sites can declare their compliance requirements. Fleet must prevent deployment of a release that hasn't achieved the required certifications for that site's compliance profile.

**Offline Operations Toolkit**

For fully air-gapped environments, Fleet must produce a comprehensive offline operations toolkit alongside the release bundle:

```
offline_operations_toolkit
├── release_bundle (container images, charts, manifests)
├── upgrade_proposal_package
├── runbook (step-by-step upgrade instructions)
├── rollback_runbook
├── health_check_scripts
├── diagnostic_toolkit
│   ├── log_collection_scripts
│   ├── health_verification_scripts
│   └── performance_benchmark_suite
├── license_bundle (signed, with configurable expiry)
└── support_contact_package
    ├── encrypted_log_export_tool
    └── secure_file_transfer_instructions
```

The customer's operations team must be able to upgrade, verify, diagnose, and roll back without any connectivity to the Factory or vendor support.

**Split-Authority Site Management**

For environments with multiple responsible parties, Fleet must support split authority:

```
Site: defense-client-prod
│
├── Vendor authority (us):
│   ├── Produce releases and bundles
│   ├── Provide upgrade proposals
│   ├── Provide diagnostic support
│   └── Cannot: access site, deploy, modify config
│
├── System integrator authority:
│   ├── Schedule and execute upgrades
│   ├── Manage tenant configuration
│   ├── Monitor site health
│   └── Cannot: modify releases, change entitlements
│
├── Customer IT authority:
│   ├── Approve upgrades (CAB)
│   ├── Manage infrastructure
│   ├── Control network access
│   └── Cannot: modify application logic, access vendor systems
│
└── Customer security authority:
    ├── Audit all operations
    ├── Review compliance artifacts
    ├── Approve security patches
    └── Cannot: deploy software, modify config
```

This maps to the partner model (Section 4.8) but extends it to support multiple non-overlapping authority scopes on a single site, not just a single partner.

**Usage Reporting for Disconnected Sites**

Air-gapped and disconnected sites cannot stream telemetry to Fleet. Fleet must support a manual usage reporting workflow:

1. Site's Control Plane accumulates usage data locally (audit logs, metering, health snapshots)
2. A site operator exports a signed usage report bundle
3. The bundle is transferred out of the secure environment through the customer's data export process
4. Fleet ingests the bundle, updates its records, and provides billing/licensing data to Commerce Plane

The usage report must be signed by the site's identity key so Fleet can verify its authenticity. The format must be stable across versions (a site running version N-5 must produce reports that current Fleet can ingest).

**Data Sovereignty and Residency**

Fleet must enforce data residency constraints:

- A site tagged with `data_residency: IN` (India) must only be assignable to infrastructure in India
- Tenant assignment must respect residency — a customer with an India residency requirement cannot be placed on a US shared site
- Air-gapped bundles for sovereign deployments must not contain telemetry collection that would exfiltrate data to the Factory (the site operator controls what leaves the site)

These constraints are declared in the site record and enforced by Fleet during tenant assignment, rollout planning, and bundle generation.

#### 4.12.3 Deployment Model Matrix

| Capability | SaaS Shared | SaaS Dedicated | Connected Self-Hosted | Air-Gapped | Sovereign/Defense |
|---|---|---|---|---|---|
| Check-in model | Poll + hint | Poll + hint | Poll (longer interval) | Manual bundle | Manual bundle |
| Upgrade authority | Fleet (auto) | Fleet (scheduled) | Customer operator | Customer CAB | Customer CAB + security review |
| Upgrade speed | Minutes | Hours (scheduled) | Days (approved) | Weeks (process) | Months (certified) |
| Compliance gating | No | Optional | Optional | Yes | Yes (mandatory) |
| Version lag tolerance | 0 (current) | N-1 | N-3 | N-5+ | N-10+ (years) |
| Authority model | Fleet only | Fleet + customer admin | Customer operator | Split (SI + customer) | Split (vendor + SI + IT + security) |
| Telemetry | Real-time | Real-time | Periodic | Manual export | Manual export (customer controlled) |
| Upgrade proposal | Not needed | Optional | Recommended | Required | Required (with compliance artifacts) |

### 5.1 Commerce → Fleet

Commerce Plane is Fleet's primary trigger for manifest recomputation.

| Commerce Event | Fleet Action |
|---|---|
| New customer (shared) | Assign tenant, recompute site manifest, send hint |
| New customer (dedicated) | Provision dedicated site, compute initial manifest |
| Entitlement updated | Recompute site manifest, send hint |
| Payment failure → grace | No manifest change |
| Payment failure → restricted | Set tenant_state in manifest, send hint |
| Payment failure → suspended | Set tenant_state in manifest, send hint |
| Payment failure → terminated | Set tenant_state in manifest, begin decommission workflow |
| Customer adds product | Assign tenant to product's shared site, compute manifest |

---

### 5.2 Build → Fleet

Build Plane produces artifacts. Fleet Plane consumes them as releases.

| Build Event | Fleet Action |
|---|---|
| Module version published | Available for inclusion in release |
| Release composed | Validate and register in Fleet |
| Release tested (internal) | Promote to beta channel |
| Release promoted | Make available to stable sites |

---

### 5.3 Fleet → Infrastructure

Fleet instructs Infrastructure Plane to provision or modify substrate.

| Fleet Action | Infrastructure Execution |
|---|---|
| Provision dedicated site | Create cluster, networking, storage |
| Scale shared site | Add node pool capacity |
| Decommission site | Destroy cluster and storage |
| Push certificate rotation | Infrastructure distributes new certs |

---

### 5.4 Fleet ↔ Site (Pull-Based Convergence)

Fleet publishes desired state. Sites pull and converge. The interaction is always site-initiated.

| Fleet Manifest Content | Site Convergence Action |
|---|---|
| target_release with module pins | Pull artifacts, upgrade modules |
| tenant_states with entitlements | Provision/update/suspend namespaces |
| configuration updates | Apply platform config, feature flags |
| infrastructure_requirements | Adjust resource allocation |

The hint channel (WebSocket/SSE, site-initiated outbound connection) accelerates convergence but is never required. Sites that cannot maintain a hint channel (firewalled, intermittent) simply rely on polling.

```
Fleet Plane                              Site

Manifest API (always available):
  GET /manifest?site_id=X ◄──────────── Poll (every 60s or on hint)
  POST /checkin ◄────────────────────── Health + manifest version check

Hint Channel (optional, best-effort):
  ──── "manifest_changed" ──────────►   Triggers immediate pull
  (WebSocket/SSE, site-initiated)       Falls back to poll if lost
```

---

## 6. Data Model (Conceptual)

### 6.1 Core Entities

```
site
site_configuration
site_manifest
site_health_snapshot
site_secret_bundle

tenant
tenant_configuration

release
release_module_pin

rollout
rollout_step

site_upgrade
upgrade_bundle (for air-gapped)

partner
partner_site_assignment

fleet_event (outbox)
fleet_audit_log
```

### 6.2 Key Relationships

```
site 1 — N tenant
site 1 — N rollout
site 1 — N site_upgrade
site 1 — N site_health_snapshot
site 1 — 1 site_manifest (current desired state)
site 1 — 1 site_configuration

tenant N — 1 customer_account (Commerce)
tenant N — 1 entitlement_bundle (Commerce)

release 1 — N release_module_pin
release_module_pin N — 1 module_version (Build)

rollout N — 1 release
rollout 1 — N rollout_step
rollout_step N — 1 site

site_upgrade N — 1 release
site_upgrade N — 1 site

partner 1 — N partner_site_assignment
partner_site_assignment N — 1 site

license 1 — N site (Commerce bridge)
```

---

## 7. API Surface (High-Level)

### 7.1 External APIs (Factory-facing)

```
POST   /sites                           Create site
GET    /sites                           List sites (filterable)
GET    /sites/{id}                      Get site details
PATCH  /sites/{id}                      Update site configuration
POST   /sites/{id}/suspend              Suspend site
POST   /sites/{id}/decommission         Begin decommission

POST   /sites/{id}/tenants              Assign tenant
GET    /sites/{id}/tenants              List tenants
PATCH  /sites/{id}/tenants/{id}         Update tenant
POST   /sites/{id}/tenants/{id}/migrate Initiate migration

POST   /releases                        Register release
GET    /releases                        List releases
GET    /releases/{id}                   Get release details
POST   /releases/{id}/promote           Promote release to channel

POST   /rollouts                        Create rollout
GET    /rollouts                        List rollouts
GET    /rollouts/{id}                   Get rollout status
POST   /rollouts/{id}/pause             Pause rollout
POST   /rollouts/{id}/resume            Resume rollout
POST   /rollouts/{id}/rollback          Rollback rollout

GET    /fleet/health                    Fleet-wide health summary
GET    /fleet/capacity                  Capacity across shared sites

POST   /entitlements/distribute         Push entitlement to site(s)

GET    /partners/{id}/sites             Partner's site view
POST   /partners/{id}/sites/{id}/upgrade  Partner-initiated upgrade
```

### 7.2 Site-Facing APIs (Site → Fleet)

```
POST   /checkin                         Combined health report + manifest version check
GET    /manifest                        Pull current desired state (full manifest)
GET    /manifest/diff?since={version}   Pull manifest changes since a version (optimization)
GET    /artifacts/{digest}              Pull specific artifact (container image, bundle)
POST   /upgrades/{id}/ack              Report upgrade completion
GET    /hint/stream                     SSE/WebSocket hint channel (site-initiated, optional)
```

The `/checkin` endpoint is the primary interaction point. Sites POST their health snapshot and current manifest version; Fleet responds with whether the manifest has changed and optionally includes the full manifest to save a round trip.

### 7.3 Internal Services

```
factory-fleet-api          — API gateway, CRUD operations, manifest serving, checkin endpoint
factory-fleet-scheduler    — rollout planning, sequencing, retry logic
factory-fleet-deployer     — site provisioning, manifest computation, hint dispatch
factory-fleet-monitor      — checkin ingestion, health aggregation, alerting, drift detection
factory-fleet-bundler      — air-gapped bundle generation, signing, delta computation
```

---

## 8. Non-Functional Requirements

### Scalability

- 500+ sites per product
- 10,000+ tenants across all shared sites
- 50+ concurrent rollouts (across different sites)
- 1,000+ heartbeats per minute at fleet scale

### Performance

- Tenant assignment (shared site): < 2 seconds
- Manifest convergence (with hint): < 5 seconds end-to-end (Commerce change → site enforces)
- Manifest convergence (poll only): < 60 seconds (bounded by poll interval)
- Rollout step execution: < 5 minutes per site
- Health dashboard refresh: < 10 seconds
- Air-gapped bundle generation: < 15 minutes
- Checkin round-trip: < 500ms (manifest included in response)

### Availability

- Fleet API: 99.9% uptime
- Fleet must not be a runtime dependency for sites — if Fleet goes down, all sites continue operating normally
- Rollout state must survive Fleet Plane restarts

### Consistency

- Rollout state machine must be strictly ordered (no concurrent mutations)
- Tenant assignment must be atomic (no double-assignment)
- Release promotion must be idempotent

### Observability

- Structured logs for all Fleet operations
- Metrics: sites by state, rollouts by state, checkin latency, manifest drift (sites behind latest version), convergence time
- Alerts: site unreachable (missed checkins), rollout failure, capacity threshold, version lag, manifest drift

---

## 9. Success Criteria

- Tenant assignment in shared site completes in < 2 seconds
- Self-serve signup to running product: < 30 seconds end-to-end
- Manifest convergence with hint: < 5 seconds (Commerce change → site enforces)
- Manifest convergence without hint: < 60 seconds (bounded by poll interval)
- Zero-downtime upgrades for all rollout strategies
- Rollback restores previous release within 5 minutes
- Air-gapped bundle generation and delivery fully functional without any live connectivity
- No Fleet dependency during site runtime — Fleet outage does not affect any running site
- Full audit trail of every site lifecycle event, rollout, and entitlement change
- Partner-operated sites governed by explicit authority model with no implicit permissions
- Fleet-wide release adoption visible within 60 seconds of any change
- Tenant migration with < 15 minutes read-only window
- Upgrade proposal package generated on demand for CAB-gated deployments
- Sites running N-5+ versions behind stable continue to operate with full functionality
- Compliance-gated releases enforced — no uncertified release can reach a site requiring certification
- All deployment types (SaaS through air-gapped sovereign) use the same convergence loop

---

## 10. Phased Implementation

### Phase 1 — Foundation

- Site registry (CRUD)
- Basic tenant assignment (shared sites)
- Release registration and module pinning
- Rolling update strategy (sequential, health-gated)
- Site manifest computation and serving (GET /manifest)
- Site check-in endpoint (POST /checkin) with health collection
- Basic convergence loop in site agent
- Product-to-site mapping

**Outcome:** First shared SaaS site running with tenant lifecycle. Sites pull manifests and converge. Self-serve signup triggers tenant assignment. Rolling upgrades operational.

### Phase 2 — Scale

- Hint channel (SSE) for connected sites
- Canary and blue-green deployment strategies
- Automated rollback on health regression
- Tenant migration (shared → dedicated)
- Air-gapped bundle generation with embedded manifest
- Version pinning policies (pin-to-version, pin-to-major)
- Partner model: managed tier (portal access)
- Fleet capacity planning and alerts
- Drift detection and alerting
- Self-hosted site bootstrap flow
- Upgrade proposal package generation

**Outcome:** Multiple products, multiple regions. Dedicated sites for enterprise customers. Air-gapped deployments functional with offline toolkit. First partner onboarded. Government customers can receive upgrade proposals for CAB review.

### Phase 3 — Enterprise

- Partner model: delegated tier (fleet-within-fleet)
- Partner model: independent tier (sync-back)
- Split-authority site management (multiple principals per site)
- Compliance-gated releases
- Long-term support (LTS) release branches
- Delta bundles for air-gapped sites
- Offline usage report ingestion
- Data residency enforcement in tenant assignment
- Fleet-wide analytics and reporting
- Infrastructure-as-code for customer-operated sites
- Cross-site tenant federation (query across sites)
- Advanced rollout policies (maintenance windows, compliance-gated, approval chains)

**Outcome:** Full partner channel operational. Complete deployment spectrum supported — including sovereign, air-gapped, and defense environments. Enterprise-grade fleet governance with formal change control, compliance gating, and split authority.

---

## 11. Explicit Boundaries

Fleet Plane does not:

- Build artifacts or run CI/CD (Build Plane)
- Define pricing, billing, or commercial terms (Commerce Plane)
- Provision clusters, networks, or storage directly (Infrastructure Plane)
- Manage identity, RBAC, or audit within sites (Control Plane)
- Execute business logic or run product modules (Service Plane)
- Store or query customer data (Data Plane)
- Define product roadmap or manage work items (Product Plane)

Fleet Plane is the **logistics layer** of the platform. It decides what runs where, ensures it gets there safely, and monitors that it stays healthy. It does not build the cargo, price the cargo, or drive the trucks — it dispatches them.

---

## 12. Open Questions

1. **Tenant migration SLA.** What is the acceptable downtime window for tenant migration? Should we support zero-downtime migration with dual-write during cutover?

2. **Release compatibility enforcement.** Should Fleet block deployment of a release to a site whose current schema is incompatible, or warn and let the operator decide?

3. **Partner billing for Fleet operations.** Should partners pay for Fleet API usage, or is it bundled into their partnership agreement?

4. **Multi-product sites.** Can a single site run multiple products (e.g., Trafficure and NetworkAccess on the same cluster)? This would reduce infrastructure cost but complicate isolation.

5. **Rollout approval workflows.** Should Fleet support approval gates (e.g., "release approved by QA lead before rollout to production sites")? Or is this a Product Plane concern that gates release promotion?

6. **Intermittent connectivity protocol.** For sites that are mostly air-gapped but occasionally connect (e.g., daily sync window), should the check-in protocol batch multiple manifest versions and usage reports, or just sync to latest?

7. **Partner authority transitions.** When a partner is promoted from managed to delegated tier, what is the migration path for existing site assignments?

8. **Hint channel technology.** SSE vs. WebSocket vs. HTTP long-poll for the hint channel? SSE is simplest but uni-directional. WebSocket enables bidirectional but adds complexity. Long-poll works through the most restrictive proxies but is less efficient.

9. **Long-term support (LTS) releases.** Should Fleet formally support LTS release branches for government/defense customers, with backported security patches? What is the backport policy — security only, or critical bugs too?

10. **Compliance certification workflow.** Who owns the compliance certification process for releases? Is it a Build Plane concern (certification happens during build) or a Fleet concern (certification is a gate on deployment)?

11. **Split-authority conflict resolution.** When multiple authority holders on a sovereign deployment disagree (e.g., SI wants to upgrade, security team hasn't approved), what is the precedence model? Should Fleet enforce a dependency chain (security must approve before SI can deploy)?

12. **Usage report format versioning.** Air-gapped sites may run versions years apart. How do we ensure usage reports from old versions remain ingestible by current Fleet? Schema evolution strategy for the report format.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| Site | A running instance of a product in a specific customer environment |
| Tenant | A customer's isolated partition within a shared site |
| Release | A deployable bundle of module versions tested and approved together |
| Release Module Pin | The binding between a release and a specific module version |
| Rollout | An execution plan for deploying a release to one or more sites |
| Rollout Step | A single site deployment within a rollout |
| Site Manifest | The desired state of a site (target release, modules, entitlements). Computed by Fleet, pulled by sites. |
| Convergence Loop | The site-side reconciliation process that pulls the manifest and converges toward desired state |
| Hint | A lightweight, best-effort signal from Fleet to a site that its manifest has changed. Triggers an immediate pull. Not required for correctness. |
| Check-in | A site-initiated API call that reports health and checks for manifest changes in a single round trip |
| Drift | The state where a site's applied manifest version is behind Fleet's computed version beyond a threshold |
| Partner Tier | The level of Fleet authority granted to a partner (managed, delegated, independent) |
| Channel | A release track (stable, beta) that sites subscribe to |
| Offline Bundle | A self-contained release package for air-gapped deployment, including the site manifest |
| Upgrade Proposal | A document-ready artifact describing a release upgrade for formal change advisory board review |
| Version Pin | A policy that constrains a site to a specific version or version range |
| Compliance Gate | A release tag that prevents deployment to sites requiring specific certifications unless the release is certified |
| Split Authority | A model where multiple principals (vendor, SI, customer IT, security) have non-overlapping responsibilities for a single site |
| Data Residency | A constraint that limits where a site and its data can be hosted, enforced during tenant assignment and site provisioning |

## Appendix B: Entity Relationship Summary

```
FLEET PLANE — CORE GRAPH

[release]──(1:N)──[release_module_pin]──(N:1)──[module_version]
    │
  (1:N)
    │
[rollout]──(1:N)──[rollout_step]──(N:1)──[site]
                                          │
                                        (1:N)
                                          │
                                       [tenant]──(N:1)──[customer_account]
                                          │
                                          │──(N:1)──[entitlement_bundle]
                                          │
                                       [site_health_snapshot]

[partner]──(1:N)──[partner_site_assignment]──(N:1)──[site]
```

## Appendix C: Service Registry

```
factory-fleet-api          — API gateway, CRUD operations, manifest serving, checkin endpoint
factory-fleet-scheduler    — rollout planning, sequencing, retry logic
factory-fleet-deployer     — site provisioning, manifest computation, hint dispatch
factory-fleet-monitor      — checkin ingestion, health aggregation, alerting, drift detection
factory-fleet-bundler      — air-gapped bundle generation, offline toolkit, signing, delta computation
```
