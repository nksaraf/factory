# Deployment Topology Model — Design Spec

> Date: 2026-04-02
> Status: Draft
> Scope: Ops + Infra schema changes to support multi-tenant HA, blue-green, canary, and cross-site failover

---

## Context

The current ops model conflates infrastructure location, tenancy, and deployment into a few entities (Site, SystemDeployment). This makes it impossible to express:

- **Multi-tenant isolation** — a customer's footprint on a shared site
- **Blue-green / canary deployments** — parallel versioned groups within a single system deployment
- **Cross-site HA** — the same customer deployed across multiple sites with traffic splitting and failover
- **Mixed deployment strategies** — stateless components (blue-green) coexisting with stateful components (always-on) in the same system

This spec introduces **Tenant** and **DeploymentSet** as new entities, enhances SystemDeployment with tenant scoping, and enriches Route with multi-target traffic routing.

---

## Entity Model

### New hierarchy:

```
Site (infra installation)
  └─ Tenant (customer isolation per-site)
       └─ SystemDeployment (one per System per Tenant)
            ├─ DeploymentSet (optional: blue/green/canary/primary/replica)
            │    └─ ComponentDeployment (per component in this set)
            └─ ComponentDeployment (shared components, no set)

Route (cross-site traffic routing with weights, geo, health)
```

### Industry alignment:

| Factory | k8s | Netflix/Spinnaker | Azure | GCP Cloud Run | AWS ECS |
|---------|-----|-------------------|-------|---------------|---------|
| Site | Cluster | — | — | — | Cluster |
| Tenant | Namespace | — | — | — | — |
| SystemDeployment | Deployment | Cluster | App | Service | Service |
| DeploymentSet | ReplicaSet | Server Group | Deployment Slot | Revision | Task Set |
| ComponentDeployment | Pod | Instance | Instance | Instance | Task |
| Route | Ingress | — | Traffic Manager | URL map | Route 53 |

---

## New Entity: Tenant

**The customer's isolated operational footprint on a specific Site.**

Promotes the existing `Site.spec.tenant` string field to a first-class entity. Bridges Commerce (Customer) to Ops (SystemDeployment).

```typescript
// ── Tenant ─────────────────────────────────────────────────

export const TenantEnvironmentSchema = z.enum([
  "production",
  "staging",
  "development",
  "preview",
]);

export const TenantStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "decommissioned",
]);

export const TenantIsolationSchema = z.enum([
  "dedicated",   // own infra (single tenant on site)
  "shared",      // shared infra, app-level isolation (RLS, tenant ID)
  "siloed",      // shared infra, infra-level isolation (own namespace, own pods)
]);

export const TenantSpecSchema = z.object({
  environment: TenantEnvironmentSchema.default("development"),
  isolation: TenantIsolationSchema.default("shared"),
  status: TenantStatusSchema.default("provisioning"),
  k8sNamespace: z.string().optional(),
  resourceQuota: z.object({
    cpu: z.string().optional(),       // e.g., "16"
    memory: z.string().optional(),    // e.g., "32Gi"
    storage: z.string().optional(),   // e.g., "100Gi"
  }).optional(),
  previewConfig: z.object({
    enabled: z.boolean().default(false),
    ttlDays: z.number().int().default(7),
    maxConcurrent: z.number().int().optional(),
    defaultAuthMode: z.enum(["public", "team", "private"]).default("team"),
  }).optional(),
});

export const TenantSchema = z.object({
  id: z.string(),
  slug: z.string(),          // e.g., "trafficure-prod-mumbai"
  name: z.string(),          // e.g., "Trafficure Production (Mumbai)"
  siteId: z.string(),        // which Site this tenant lives on
  customerId: z.string(),    // which Customer (commerce) owns this
  spec: TenantSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(BitemporalSchema).merge(ReconciliationSchema);
```

**Key relationships:**
- `siteId` → `Site` (which infrastructure installation)
- `customerId` → `Customer` (which customer, from commerce schema)

**Examples:**
- `trafficure-prod-mumbai` — Trafficure's production on shared SaaS Mumbai
- `trafficure-prod-dublin` — Trafficure's production on shared SaaS Dublin (for HA)
- `acme-prod` — Acme's production on their dedicated cloud
- `acme-staging` — Acme's staging on shared SaaS (different Tenant, same Customer)
- `iocl-prod` — IOCL's production on their on-prem Delhi site
- `preview-pr-123` — temporary preview tenant (environment=preview, TTL)

---

## New Entity: DeploymentSet

**A role-based group of component deployments within a SystemDeployment.**

Optional — only needed for blue-green, canary, or stateful HA. For simple rolling deployments, ComponentDeployments sit directly on SystemDeployment with no DeploymentSet.

```typescript
// ── DeploymentSet ──────────────────────────────────────────

export const DeploymentSetRoleSchema = z.enum([
  "active",     // single active (rolling deploy, or post-cutover)
  "blue",       // blue-green: current live
  "green",      // blue-green: new version being promoted
  "stable",     // canary: baseline
  "canary",     // canary: experimental
  "primary",    // stateful: write leader
  "replica",    // stateful: read follower
  "standby",    // warm standby for failover
]);

export const DeploymentSetStatusSchema = z.enum([
  "provisioning",
  "running",
  "draining",   // traffic being shifted away
  "stopped",
  "failed",
]);

export const DeploymentSetSpecSchema = z.object({
  role: DeploymentSetRoleSchema.default("active"),
  trafficWeight: z.number().min(0).max(100).default(100),
  status: DeploymentSetStatusSchema.default("provisioning"),
  desiredVersion: z.string().optional(),  // overrides SystemDeployment if set
  testUrl: z.string().optional(),         // per-set URL for pre-switch verification
});

export const DeploymentSetSchema = z.object({
  id: z.string(),
  slug: z.string(),                // e.g., "blue", "green", "primary"
  systemDeploymentId: z.string(),  // parent SystemDeployment
  runtimeId: z.string().nullable(), // can target a different runtime than parent
  spec: DeploymentSetSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
```

**Key relationships:**
- `systemDeploymentId` → `SystemDeployment` (parent)
- `runtimeId` → `Runtime` (optional: allows set-level runtime targeting, e.g., different AZs)

---

## Modified Entity: Site

**Refocused to pure infrastructure installation.** Tenant/environment fields move to Tenant.

```diff
 export const SiteSpecSchema = z.object({
-  tenant: z.string().optional(),
-  environment: SiteEnvironmentSchema.default("development"),
-  isolationLevel: z.enum(["dedicated", "shared", "hybrid"]).default("shared"),
+  type: z.enum(["shared", "dedicated", "on-prem", "edge"]).default("shared"),
   product: z.string().optional(),
   status: SiteStatusSchema.default("provisioning"),
-  previewConfig: z.object({...}).optional(),
+  // previewConfig moves to Tenant
 });
```

**SiteEnvironmentSchema** and **SiteStatusSchema** remain (SiteStatus is still useful).

---

## Modified Entity: SystemDeployment

**Add `tenantId` for tenant scoping. One SystemDeployment per System per Tenant.**

```diff
 export const SystemDeploymentSchema = z.object({
   id: z.string(),
   slug: z.string(),
   name: z.string(),
   type: DeploymentKindSchema,
   systemId: z.string(),
   siteId: z.string().nullable(),
+  tenantId: z.string().nullable(),    // null = shared across all tenants on this site
   runtimeId: z.string().nullable(),
   spec: SystemDeploymentSpecSchema,
   createdAt: z.coerce.date(),
   updatedAt: z.coerce.date(),
 }).merge(BitemporalSchema).merge(ReconciliationSchema);
```

**`tenantId` semantics:**
- `null` — shared deployment serving all tenants on the Site (app-level isolation via RLS/tenant ID)
- set — siloed deployment for one specific Tenant (infra-level isolation)

**SystemDeploymentSpec** additions:
```diff
 export const SystemDeploymentSpecSchema = z.object({
   trigger: DeploymentTriggerSchema.default("manual"),
   status: DeploymentStatusSchema.default("provisioning"),
+  deploymentStrategy: z.enum(["rolling", "blue-green", "canary", "stateful"]).default("rolling"),
   ttl: z.string().optional(),
   expiresAt: z.coerce.date().optional(),
   labels: z.record(z.string()).default({}),
   desiredVersion: z.string().optional(),
   namespace: z.string().optional(),
   createdBy: z.string().optional(),
   runtime: z.enum([...]).default("kubernetes"),
 });
```

---

## Modified Entity: ComponentDeployment

**Add optional `deploymentSetId` for blue-green grouping.**

```diff
 export const ComponentDeploymentSchema = z.object({
   id: z.string(),
   systemDeploymentId: z.string(),
+  deploymentSetId: z.string().nullable(),  // null = shared/pinned component (e.g., DB)
   componentId: z.string(),
   artifactId: z.string().nullable(),
   spec: ComponentDeploymentSpecSchema,
   createdAt: z.coerce.date(),
   updatedAt: z.coerce.date(),
 }).merge(ReconciliationSchema);
```

**`deploymentSetId` semantics:**
- `null` — shared component that persists across deployment transitions (e.g., postgres). Not blue-green'd.
- set — component belongs to this DeploymentSet. Gets created/destroyed with the set.

---

## Modified Entity: Route

**Enriched with multi-target routing for cross-site HA.**

```diff
 export const RouteSpecSchema = z.object({
   domain: z.string(),
-  targetService: z.string(),
-  targetPort: z.number().int(),
+  targets: z.array(z.object({
+    tenantSlug: z.string(),
+    systemDeploymentSlug: z.string(),
+    port: z.number().int(),
+    weight: z.number().min(0).max(100).default(100),
+    geo: z.array(z.string()).optional(),  // e.g., ["Asia", "India"]
+  })).min(1),
   protocol: z.enum(["http", "https", "tcp"]).default("http"),
   status: z.enum(["pending", "active", "error", "expired"]).default("pending"),
   tls: z.object({
     enabled: z.boolean().default(false),
     certRef: z.string().optional(),
   }).optional(),
+  failoverPolicy: z.enum(["active-active", "active-passive", "none"]).default("none"),
+  healthCheck: z.object({
+    path: z.string().default("/health"),
+    intervalSeconds: z.number().int().default(10),
+    failureThreshold: z.number().int().default(3),
+  }).optional(),
   middlewares: z.array(z.object({
     name: z.string(),
     config: z.record(z.string()).default({}),
   })).default([]),
   createdBy: z.enum(["reconciler", "user", "api"]).default("api"),
 });
```

**Route no longer has `siteId` or `systemDeploymentId`** — it references targets by slug, allowing cross-site routing.

---

## Modified Entity: Rollout

**Now orchestrates DeploymentSet transitions.**

```diff
 export const RolloutSpecSchema = z.object({
   status: RolloutStatusSchema.default("pending"),
   strategy: z.enum(["rolling", "blue-green", "canary"]).default("rolling"),
   progress: z.number().min(0).max(100).default(0),
+  fromDeploymentSetId: z.string().optional(),  // the set being replaced
+  toDeploymentSetId: z.string().optional(),     // the set being promoted
   startedAt: z.coerce.date().optional(),
   completedAt: z.coerce.date().optional(),
   error: z.string().optional(),
 });
```

---

## Unchanged Entities

The following require no schema changes:
- **Database** — still references `systemDeploymentId`
- **DatabaseOperation** — still references `databaseId`
- **AnonymizationProfile** — no deployment references
- **Intervention** — still references `systemDeploymentId` + `componentDeploymentId`
- **Workspace** — orthogonal to deployment topology
- **Preview** — still references `siteId` (could optionally reference `tenantId` in future)
- **SiteManifest, InstallManifest** — still reference `siteId`
- **Workbench** — orthogonal
- **All infra entities** (Substrate, Host, Runtime, DnsDomain, IpAddress, Secret, Tunnel) — unchanged

---

## Concrete Example: SmartMarket Blue-Green Deploy

SmartMarket has: API (stateless, 3 replicas), UI (stateless, 2 replicas), Postgres (stateful, primary + read replicas).

```
Site: shared-saas-mumbai (type=shared)
  Runtime: cluster-mumbai-1

Tenant: trafficure-prod-mumbai
  siteId=shared-saas-mumbai, customerId=trafficure, env=production, isolation=siloed

SystemDeployment: smartmarket
  tenantId=trafficure-prod-mumbai, systemId=smartmarket
  spec.deploymentStrategy=blue-green, spec.desiredVersion=v1.1

  DeploymentSet: blue (role=blue, weight=90%)
    ComponentDeployment: api   (v1.0, replicas=3)
    ComponentDeployment: ui    (v1.0, replicas=2)

  DeploymentSet: green (role=green, weight=10%)
    ComponentDeployment: api   (v1.1, replicas=3)
    ComponentDeployment: ui    (v1.1, replicas=2)

  (shared, deploymentSetId=null)
    ComponentDeployment: postgres-primary  (replicas=1)
    ComponentDeployment: postgres-replica  (replicas=2)

Rollout:
  systemDeploymentId=smartmarket, releaseId=v1.1
  strategy=blue-green, fromDeploymentSetId=blue, toDeploymentSetId=green
  progress=10%
```

---

## Concrete Example: Cross-Site HA with Geo Routing

Trafficure wants active-active across Mumbai + Dublin.

```
Site: shared-saas-mumbai
  Tenant: trafficure-prod-mumbai (env=production)
    SystemDeployment: smartmarket
      DeploymentSet: active (role=active, weight=100%)
        ComponentDeployment: api (v1.1, replicas=4)
      ComponentDeployment: postgres-primary (replicas=1)

Site: shared-saas-dublin
  Tenant: trafficure-prod-dublin (env=production)
    SystemDeployment: smartmarket
      DeploymentSet: active (role=active, weight=100%)
        ComponentDeployment: api (v1.1, replicas=4)
      ComponentDeployment: postgres-replica (replicas=1)

Route: trafficure.lepton.app
  targets:
    - tenantSlug: trafficure-prod-mumbai, systemDeploymentSlug: smartmarket, port: 8080, weight: 50, geo: [Asia]
    - tenantSlug: trafficure-prod-dublin, systemDeploymentSlug: smartmarket, port: 8080, weight: 50, geo: [Europe]
  failoverPolicy: active-active
  healthCheck: { path: /health, intervalSeconds: 10, failureThreshold: 3 }
```

**Region failure (Mumbai down):**
Route health check detects failure → Mumbai target weight set to 0 → Dublin absorbs 100% → Intervention recorded.

---

## Concrete Example: Shared Multi-Tenant (No Siloing)

Small tenants share a single deployment. Tenant isolation at app level (RLS).

```
Site: shared-saas-mumbai
  Tenant: smallco-1 (isolation=shared)
  Tenant: smallco-2 (isolation=shared)
  Tenant: smallco-3 (isolation=shared)

  SystemDeployment: smartmarket-shared
    tenantId=null  (shared across all tenants)
    DeploymentSet: active (role=active, weight=100%)
      ComponentDeployment: api (v1.1, replicas=8)
    ComponentDeployment: postgres-primary (replicas=1)
```

---

## Concrete Example: On-Prem Air-Gapped

```
Site: iocl-onprem-delhi (type=on-prem)
  Runtime: k3s-iocl

Tenant: iocl-prod (env=production, isolation=dedicated)

  SystemDeployment: smartmarket
    spec.deploymentStrategy=rolling
    (no DeploymentSets — rolling update in-place)
    ComponentDeployment: api (v1.0, replicas=3)
    ComponentDeployment: ui (v1.0, replicas=2)
    ComponentDeployment: postgres-primary (replicas=1)
```

---

## Concrete Example: Edge Fleet

```
Site: edge-noida (type=edge)
  Tenant: city-noida (env=production)
    SystemDeployment: edge-collector
      ComponentDeployment: collector (v1.0, replicas=1)

Site: edge-gurgaon (type=edge)
  Tenant: city-gurgaon (env=production)
    SystemDeployment: edge-collector
      ComponentDeployment: collector (v1.0, replicas=2)
```

No DeploymentSets. No HA. Designed for eventual sync.

---

## Concrete Example: Preview Deployment

```
Site: shared-saas-mumbai
  Tenant: preview-pr-123
    env=preview, customerId=internal
    spec.previewConfig: { enabled: true, ttlDays: 7 }

  SystemDeployment: smartmarket-preview
    tenantId=preview-pr-123
    spec.trigger=pr, spec.ttl=7d
    ComponentDeployment: api (v1.2-pr123, replicas=1)
    ComponentDeployment: ui (v1.2-pr123, replicas=1)

Route: pr-123.preview.lepton.app
  targets: [{ tenantSlug: preview-pr-123, systemDeploymentSlug: smartmarket-preview, port: 8080, weight: 100 }]

Preview: (existing entity, links PR metadata)
  siteId=shared-saas-mumbai, spec.prNumber=123, spec.sourceBranch=feature/x
```

---

## Migration Path

This is a **schema extension**, not a breaking change. Existing data continues to work.

1. **Add Tenant table** — new entity, no existing data depends on it
2. **Add DeploymentSet table** — new entity, no existing data depends on it
3. **Add `tenantId` to SystemDeployment** — nullable, existing rows have `tenantId=null`
4. **Add `deploymentSetId` to ComponentDeployment** — nullable, existing rows have `deploymentSetId=null`
5. **Add `deploymentStrategy` to SystemDeployment spec** — JSONB, backward compatible
6. **Enrich Route spec** — JSONB, migrate existing `targetService`/`targetPort` to single-element `targets` array
7. **Add DeploymentSet refs to Rollout spec** — JSONB, backward compatible
8. **Refocus Site spec** — migrate `tenant`/`environment`/`isolationLevel` to Tenant; add `type`

Steps 1-5 are additive. Steps 6-8 require data migration for existing rows.

---

## Change Summary

| Entity | Change | Details |
|--------|--------|---------|
| **Tenant** | NEW | Customer isolation per-site, bridges Commerce → Ops |
| **DeploymentSet** | NEW | Role-based component grouping for blue-green/canary/stateful |
| **Site** | Refocused | Remove tenant/env, add `type` (shared/dedicated/on-prem/edge) |
| **SystemDeployment** | Enhanced | Add `tenantId` (nullable), `deploymentStrategy` in spec |
| **ComponentDeployment** | Enhanced | Add `deploymentSetId` (nullable) |
| **Route** | Enriched | Multi-target with weights, geo, health, failover policy |
| **Rollout** | Enhanced | Add from/to DeploymentSet refs |
| All others | Unchanged | Database, Intervention, Workspace, Preview, infra entities |

---

## Drizzle Table Definitions

Following existing patterns from `api/src/db/schema/ops.ts` and `helpers.ts`:
- `opsSchema.table(...)` for schema namespace
- `text("id").primaryKey().$defaultFn(() => newId("prefix"))` for IDs
- `specCol<TypeSpec>()` for JSONB spec columns
- `metadataCol()` for optional metadata
- `bitemporalCols()` / `reconciliationCols()` spread as needed
- `check(...)` constraints for type enums
- Indexes in third argument

### New Table: `ops.tenant`

```typescript
import type { TenantSpec } from "@smp/factory-shared/schemas/ops";
import { customer } from "./commerce-v2";

export const tenant = opsSchema.table(
  "tenant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tnt")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .references(() => customer.id, { onDelete: "set null" }),
    spec: specCol<TenantSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_tenant_slug_idx").on(t.slug),
    index("ops_tenant_site_idx").on(t.siteId),
    index("ops_tenant_customer_idx").on(t.customerId),
  ],
);
```

### New Table: `ops.deployment_set`

```typescript
import type { DeploymentSetSpec } from "@smp/factory-shared/schemas/ops";

export const deploymentSet = opsSchema.table(
  "deployment_set",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("dset")),
    slug: text("slug").notNull(),
    systemDeploymentId: text("system_deployment_id")
      .notNull()
      .references(() => systemDeployment.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id")
      .references(() => runtime.id, { onDelete: "set null" }),
    spec: specCol<DeploymentSetSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_deployment_set_sd_idx").on(t.systemDeploymentId),
    index("ops_deployment_set_slug_idx").on(t.systemDeploymentId, t.slug),
    index("ops_deployment_set_runtime_idx").on(t.runtimeId),
  ],
);
```

### Modified Table: `ops.system_deployment`

```diff
 export const systemDeployment = opsSchema.table(
   "system_deployment",
   {
     // ... existing columns ...
+    tenantId: text("tenant_id")
+      .references(() => tenant.id, { onDelete: "set null" }),
     // ... rest unchanged ...
   },
   (t) => [
     // ... existing indexes ...
+    index("ops_system_deployment_tenant_idx").on(t.tenantId),
   ],
 );
```

### Modified Table: `ops.component_deployment`

```diff
 export const componentDeployment = opsSchema.table(
   "component_deployment",
   {
     // ... existing columns ...
+    deploymentSetId: text("deployment_set_id")
+      .references(() => deploymentSet.id, { onDelete: "cascade" }),
     // ... rest unchanged ...
   },
   (t) => [
     // ... existing indexes ...
+    index("ops_component_deployment_dset_idx").on(t.deploymentSetId),
   ],
 );
```

Note: The existing unique index `ops_component_deployment_sd_component_unique` on
`(systemDeploymentId, componentId)` will need updating — with DeploymentSets, the
same component can appear multiple times per SystemDeployment (once in blue, once
in green). The new unique constraint should be
`(systemDeploymentId, deploymentSetId, componentId)`.

---

## Files to Modify

| File | Change |
|------|--------|
| `shared/src/schemas/ops.ts` | Add Tenant, DeploymentSet Zod schemas; modify SystemDeployment, ComponentDeployment, Rollout |
| `shared/src/schemas/infra.ts` | Modify Route spec (targets, failover, healthCheck) |
| `api/src/db/schema/ops.ts` | Add tenant, deployment_set tables; add tenantId/deploymentSetId columns |
| `api/src/db/schema/infra-v2.ts` | Modify route table (targets in spec JSONB) |
| `api/src/lib/id.ts` | Add `tnt` and `dset` prefixes |
| `ontology/_meta.yaml` | Add Tenant, DeploymentSet to entity registry |

---

## Verification

1. **Schema validation** — all existing Zod schemas still parse existing data (backward compat)
2. **Example modeling** — verify each concrete example above can be expressed as valid entity instances
3. **Query coverage** — verify these queries work:
   - "What systems does tenant X run?" → `SELECT DISTINCT systemId FROM system_deployment WHERE tenantId = ?`
   - "What's the traffic split for this system?" → read DeploymentSets by systemDeploymentId
   - "Cross-site routing for customer X" → read Route by domain
   - "All tenants on site Y" → `SELECT * FROM tenant WHERE siteId = ?`
4. **Migration** — existing rows with null tenantId/deploymentSetId continue to function
