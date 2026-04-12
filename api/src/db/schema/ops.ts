import type {
  AnonymizationProfileSpec,
  ComponentDeploymentSpec,
  ConnectionAuditSpec,
  DatabaseOperationSpec,
  DeploymentSetSpec,
  ForwardedPortSpec,
  InstallManifestSpec,
  InterventionSpec,
  DatabaseSpec as OpsDatabaseSpec,
  PreviewSpec,
  RolloutSpec,
  SiteManifestSpec,
  SiteSpec,
  SystemDeploymentSpec,
  TenantSpec,
  WorkbenchSnapshotSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import { customer } from "./commerce"
import {
  bitemporalCols,
  createdAt,
  metadataCol,
  opsSchema,
  reconciliationCols,
  specCol,
  updatedAt,
} from "./helpers"
import { host, realm, service } from "./infra"
import { principal } from "./org"
import { artifact, component, release, system, template } from "./software"

// ─── Site ────────────────────────────────────────────────────

export const site = opsSchema.table(
  "site",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("site")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("production"),
    spec: specCol<SiteSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    // Partial unique indexes in migration (bitemporal)
    index("ops_site_slug_idx").on(t.slug),
    index("ops_site_name_idx").on(t.name),
    index("ops_site_type_idx").on(t.type),
  ]
)

// ─── Tenant ─────────────────────────────────────────────────

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
    /** FK → commerce.customer (cross-schema) */
    customerId: text("customer_id").notNull(),
    spec: specCol<TenantSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
    ...reconciliationCols(),
  },
  (t) => [
    // Partial unique indexes in migration (bitemporal)
    index("ops_tenant_slug_idx").on(t.slug),
    index("ops_tenant_site_idx").on(t.siteId),
    index("ops_tenant_customer_idx").on(t.customerId),
  ]
)

// ─── System Deployment ───────────────────────────────────────

export const systemDeployment = opsSchema.table(
  "system_deployment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sdp")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenant.id, {
      onDelete: "set null",
    }),
    realmId: text("realm_id").references(() => realm.id, {
      onDelete: "set null",
    }),
    workbenchId: text("workbench_id"),
    spec: specCol<SystemDeploymentSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_system_deployment_site_slug_idx").on(t.siteId, t.slug),
    index("ops_system_deployment_system_idx").on(t.systemId),
    index("ops_system_deployment_tenant_idx").on(t.tenantId),
    index("ops_system_deployment_realm_idx").on(t.realmId),
    index("ops_system_deployment_workbench_idx").on(t.workbenchId),
  ]
)

// ─── DeploymentSet ──────────────────────────────────────────

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
    realmId: text("realm_id").references(() => realm.id, {
      onDelete: "set null",
    }),
    spec: specCol<DeploymentSetSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("ops_deployment_set_sd_slug_unique").on(
      t.systemDeploymentId,
      t.slug
    ),
    index("ops_deployment_set_sd_idx").on(t.systemDeploymentId),
    index("ops_deployment_set_realm_idx").on(t.realmId),
  ]
)

// ─── Component Deployment ────────────────────────────────────

export const componentDeployment = opsSchema.table(
  "component_deployment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cdp")),
    systemDeploymentId: text("system_deployment_id")
      .notNull()
      .references(() => systemDeployment.id, { onDelete: "cascade" }),
    deploymentSetId: text("deployment_set_id").references(
      () => deploymentSet.id,
      { onDelete: "cascade" }
    ),
    componentId: text("component_id")
      .notNull()
      .references(() => component.id),
    artifactId: text("artifact_id").references(() => artifact.id, {
      onDelete: "set null",
    }),
    workbenchId: text("workbench_id"),
    serviceId: text("service_id").references(() => service.id, {
      onDelete: "set null",
    }),
    spec: specCol<ComponentDeploymentSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_component_deployment_sd_dset_component_idx").on(
      t.systemDeploymentId,
      t.deploymentSetId,
      t.componentId
    ),
    index("ops_component_deployment_sd_idx").on(t.systemDeploymentId),
    index("ops_component_deployment_dset_idx").on(t.deploymentSetId),
    index("ops_component_deployment_component_idx").on(t.componentId),
    index("ops_component_deployment_artifact_idx").on(t.artifactId),
    index("ops_component_deployment_workbench_idx").on(t.workbenchId),
    index("ops_component_deployment_service_idx").on(t.serviceId),
  ]
)

// ─── Workbench ──────────────────────────────────────────────

export const workbench = opsSchema.table(
  "workbench",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wbnch")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    siteId: text("site_id").references(() => site.id, { onDelete: "cascade" }),
    hostId: text("host_id").references(() => host.id, { onDelete: "set null" }),
    realmId: text("realm_id").references(() => realm.id, {
      onDelete: "set null",
    }),
    serviceId: text("service_id").references(() => service.id, {
      onDelete: "set null",
    }),
    parentWorkbenchId: text("parent_workbench_id"),
    templateId: text("template_id").references(() => template.id, {
      onDelete: "set null",
    }),
    ownerId: text("owner_id").references(() => principal.id, {
      onDelete: "set null",
    }),
    spec: specCol<WorkbenchSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_workbench_slug_idx").on(t.slug),
    index("ops_workbench_type_idx").on(t.type),
    index("ops_workbench_site_idx").on(t.siteId),
    index("ops_workbench_host_idx").on(t.hostId),
    index("ops_workbench_realm_idx").on(t.realmId),
    index("ops_workbench_service_idx").on(t.serviceId),
    index("ops_workbench_parent_idx").on(t.parentWorkbenchId),
    index("ops_workbench_owner_idx").on(t.ownerId),
  ]
)

// ─── Workbench Snapshot ─────────────────────────────────────

export const workbenchSnapshot = opsSchema.table(
  "workbench_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wbsnap")),
    workbenchId: text("workbench_id")
      .notNull()
      .references(() => workbench.id, { onDelete: "cascade" }),
    spec: specCol<WorkbenchSnapshotSpec>(),
    createdAt: createdAt(),
  },
  (t) => [index("ops_workbench_snapshot_workbench_idx").on(t.workbenchId)]
)

// ─── Preview ─────────────────────────────────────────────────

export const preview = opsSchema.table(
  "preview",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("prev")),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => principal.id, {
      onDelete: "set null",
    }),
    phase: text("phase").notNull().default("pending_image"),
    sourceBranch: text("source_branch").notNull(),
    prNumber: integer("pr_number"),
    spec: specCol<PreviewSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_preview_site_idx").on(t.siteId),
    index("ops_preview_owner_idx").on(t.ownerId),
    index("ops_preview_phase_idx").on(t.phase),
    index("ops_preview_branch_idx").on(t.sourceBranch),
    index("ops_preview_pr_idx").on(t.prNumber),
  ]
)

// ─── Database ────────────────────────────────────────────────

export const opsDatabase = opsSchema.table(
  "database",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("db")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    systemDeploymentId: text("system_deployment_id").references(
      () => systemDeployment.id,
      { onDelete: "set null" }
    ),
    componentId: text("component_id").references(() => component.id, {
      onDelete: "set null",
    }),
    spec: specCol<OpsDatabaseSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ops_database_slug_unique").on(t.slug),
    index("ops_database_sd_idx").on(t.systemDeploymentId),
    index("ops_database_component_idx").on(t.componentId),
  ]
)

// ─── Database Operation ──────────────────────────────────────

export const databaseOperation = opsSchema.table(
  "database_operation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("dbop")),
    type: text("type").notNull(), // backup, restore, seed, anonymize
    databaseId: text("database_id")
      .notNull()
      .references(() => opsDatabase.id, { onDelete: "cascade" }),
    spec: specCol<DatabaseOperationSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ops_database_operation_db_idx").on(t.databaseId),
    index("ops_database_operation_type_idx").on(t.type),
  ]
)

// ─── Anonymization Profile ───────────────────────────────────

export const anonymizationProfile = opsSchema.table(
  "anonymization_profile",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("aprf")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    spec: specCol<AnonymizationProfileSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ops_anonymization_profile_slug_unique").on(t.slug)]
)

// ─── Rollout ─────────────────────────────────────────────────

export const rollout = opsSchema.table(
  "rollout",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rout")),
    releaseId: text("release_id").references(() => release.id, {
      onDelete: "set null",
    }),
    systemDeploymentId: text("system_deployment_id")
      .notNull()
      .references(() => systemDeployment.id, { onDelete: "cascade" }),
    spec: specCol<RolloutSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    index("ops_rollout_release_idx").on(t.releaseId),
    index("ops_rollout_sd_idx").on(t.systemDeploymentId),
  ]
)

// ─── Intervention ────────────────────────────────────────────

export const intervention = opsSchema.table(
  "intervention",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("intv")),
    type: text("type").notNull(), // restart, scale, rollback, manual
    systemDeploymentId: text("system_deployment_id").references(
      () => systemDeployment.id,
      { onDelete: "set null" }
    ),
    componentDeploymentId: text("component_deployment_id").references(
      () => componentDeployment.id,
      { onDelete: "set null" }
    ),
    spec: specCol<InterventionSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ops_intervention_type_idx").on(t.type),
    index("ops_intervention_sd_idx").on(t.systemDeploymentId),
    index("ops_intervention_cd_idx").on(t.componentDeploymentId),
  ]
)

// ─── Forwarded Port ──────────────────────────────────────────

export const forwardedPort = opsSchema.table(
  "forwarded_port",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("fp")),
    type: text("type").notNull(), // http, tcp
    workbenchId: text("workbench_id")
      .notNull()
      .references(() => workbench.id, { onDelete: "cascade" }),
    spec: specCol<ForwardedPortSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ops_forwarded_port_type_idx").on(t.type),
    index("ops_forwarded_port_workbench_idx").on(t.workbenchId),
  ]
)

// ─── Site Manifest ───────────────────────────────────────────

export const siteManifest = opsSchema.table(
  "site_manifest",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("smfst")),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    releaseId: text("release_id").references(() => release.id, {
      onDelete: "set null",
    }),
    spec: specCol<SiteManifestSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ops_site_manifest_site_idx").on(t.siteId),
    index("ops_site_manifest_release_idx").on(t.releaseId),
  ]
)

// ─── Install Manifest ────────────────────────────────────────

export const installManifest = opsSchema.table(
  "install_manifest",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("imfst")),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    spec: specCol<InstallManifestSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ops_install_manifest_site_idx").on(t.siteId)]
)

// ─── Connection Audit Event ──────────────────────────────────

export const connectionAuditEvent = opsSchema.table(
  "connection_audit_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cae")),
    systemDeploymentId: text("system_deployment_id").references(
      () => systemDeployment.id,
      { onDelete: "set null" }
    ),
    spec: specCol<ConnectionAuditSpec>(),
    createdAt: createdAt(),
  },
  (t) => [index("ops_connection_audit_sd_idx").on(t.systemDeploymentId)]
)

// ─── Operation Run ──────────────────────────────────────────
// Tracks each execution of a background operation (sync loop, reconciler, cleanup).

export const operationRun = opsSchema.table(
  "operation_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("opr")),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(), // "schedule" | "manual" | "startup"
    status: text("status").notNull().default("running"), // "running" | "succeeded" | "failed" | "skipped"
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ops_opr_name_started_idx").on(t.name, t.startedAt),
    index("ops_opr_status_idx").on(t.name, t.status),
  ]
)
