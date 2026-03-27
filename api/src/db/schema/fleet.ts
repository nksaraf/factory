import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { artifact, moduleVersion } from "./build";
import { catalogResource } from "./catalog";
import { cluster, host, vm } from "./infra";
import { componentSpec } from "./product";

export const factoryFleet = pgSchema("factory_fleet");

export const fleetSite = factoryFleet.table(
  "site",
  {
    siteId: text("site_id")
      .primaryKey()
      .$defaultFn(() => newId("site")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    product: text("product").notNull(),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => cluster.clusterId, { onDelete: "restrict" }),
    status: text("status").notNull().default("provisioning"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
    currentManifestVersion: integer("current_manifest_version"),
  },
  (t) => [
    uniqueIndex("fleet_site_name_unique").on(t.name),
    uniqueIndex("fleet_site_slug_unique").on(t.slug),
    index("fleet_site_product_idx").on(t.product),
    check(
      "fleet_site_status_valid",
      sql`${t.status} IN ('provisioning', 'active', 'suspended', 'decommissioned')`
    ),
  ]
);

export const release = factoryFleet.table(
  "release",
  {
    releaseId: text("release_id")
      .primaryKey()
      .$defaultFn(() => newId("rel")),
    version: text("version").notNull(),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("release_version_unique").on(t.version),
    check(
      "release_status_valid",
      sql`${t.status} IN ('draft', 'staging', 'production', 'superseded', 'failed')`
    ),
  ]
);

export const releaseModulePin = factoryFleet.table(
  "release_module_pin",
  {
    releaseModulePinId: text("release_module_pin_id")
      .primaryKey()
      .$defaultFn(() => newId("rmp")),
    releaseId: text("release_id")
      .notNull()
      .references(() => release.releaseId, { onDelete: "cascade" }),
    moduleVersionId: text("module_version_id")
      .notNull()
      .references(() => moduleVersion.moduleVersionId, { onDelete: "restrict" }),
  }
);

export const deploymentTarget = factoryFleet.table(
  "deployment_target",
  {
    deploymentTargetId: text("deployment_target_id")
      .primaryKey()
      .$defaultFn(() => newId("dt")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    runtime: text("runtime").notNull().default("kubernetes"),
    hostId: text("host_id")
      .references(() => host.hostId, { onDelete: "set null" }),
    vmId: text("vm_id")
      .references(() => vm.vmId, { onDelete: "set null" }),
    siteId: text("site_id").references(() => fleetSite.siteId, {
      onDelete: "set null",
    }),
    clusterId: text("cluster_id").references(() => cluster.clusterId, {
      onDelete: "set null",
    }),
    namespace: text("namespace"),
    createdBy: text("created_by").notNull(),
    trigger: text("trigger").notNull(),
    ttl: text("ttl"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tierPolicies: jsonb("tier_policies").notNull().default({}),
    status: text("status").notNull().default("provisioning"),
    labels: jsonb("labels").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("deployment_target_name_unique").on(t.name),
    uniqueIndex("deployment_target_slug_unique").on(t.slug),
    index("deployment_target_kind_status_idx").on(t.kind, t.status),
    check(
      "deployment_target_kind_valid",
      sql`${t.kind} IN ('production', 'staging', 'sandbox', 'dev', 'preview')`
    ),
    check(
      "deployment_target_runtime_valid",
      sql`${t.runtime} IN ('kubernetes', 'compose', 'systemd', 'windows_service', 'iis', 'process')`
    ),
    check(
      "deployment_target_trigger_valid",
      sql`${t.trigger} IN ('manual', 'pr', 'release', 'agent', 'ci')`
    ),
    check(
      "deployment_target_status_valid",
      sql`${t.status} IN ('provisioning', 'active', 'suspended', 'destroying', 'destroyed')`
    ),
  ]
);

export const workload = factoryFleet.table(
  "workload",
  {
    workloadId: text("workload_id")
      .primaryKey()
      .$defaultFn(() => newId("wl")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    moduleVersionId: text("module_version_id")
      .notNull()
      .references(() => moduleVersion.moduleVersionId, { onDelete: "restrict" }),
    componentId: text("component_id")
      .notNull()
      .references(() => componentSpec.componentId, { onDelete: "restrict" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.artifactId, { onDelete: "restrict" }),
    replicas: integer("replicas").notNull().default(1),
    envOverrides: jsonb("env_overrides").notNull().default({}),
    resourceOverrides: jsonb("resource_overrides").notNull().default({}),
    status: text("status").notNull().default("provisioning"),
    desiredImage: text("desired_image").notNull(),
    desiredArtifactUri: text("desired_artifact_uri"),
    actualImage: text("actual_image"),
    driftDetected: boolean("drift_detected").notNull().default(false),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("workload_target_component_idx").on(t.deploymentTargetId, t.componentId),
    check(
      "workload_status_valid",
      sql`${t.status} IN ('provisioning', 'running', 'degraded', 'stopped', 'failed', 'completed')`
    ),
  ]
);

export const dependencyWorkload = factoryFleet.table(
  "dependency_workload",
  {
    dependencyWorkloadId: text("dependency_workload_id")
      .primaryKey()
      .$defaultFn(() => newId("dwo")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    image: text("image").notNull(),
    port: integer("port").notNull(),
    env: jsonb("env").notNull().default({}),
    catalogResourceId: text("catalog_resource_id").references(
      () => catalogResource.resourceId,
      { onDelete: "set null" }
    ),
    status: text("status").notNull().default("provisioning"),
  },
  (t) => [
    uniqueIndex("dependency_workload_target_slug_unique").on(
      t.deploymentTargetId,
      t.slug
    ),
    check(
      "dependency_workload_status_valid",
      sql`${t.status} IN ('provisioning', 'running', 'failed', 'stopped')`
    ),
  ]
);

export const rollout = factoryFleet.table(
  "rollout",
  {
    rolloutId: text("rollout_id")
      .primaryKey()
      .$defaultFn(() => newId("ro")),
    releaseId: text("release_id")
      .notNull()
      .references(() => release.releaseId, { onDelete: "cascade" }),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("rollout_release_idx").on(t.releaseId),
    check(
      "rollout_status_valid",
      sql`${t.status} IN ('pending', 'in_progress', 'succeeded', 'failed', 'rolled_back')`
    ),
  ]
);

export const workloadOverride = factoryFleet.table(
  "workload_override",
  {
    overrideId: text("override_id")
      .primaryKey()
      .$defaultFn(() => newId("wlo")),
    workloadId: text("workload_id")
      .notNull()
      .references(() => workload.workloadId, { onDelete: "cascade" }),
    field: text("field").notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedBy: text("reverted_by"),
  }
);

export const intervention = factoryFleet.table(
  "intervention",
  {
    interventionId: text("intervention_id")
      .primaryKey()
      .$defaultFn(() => newId("int")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    workloadId: text("workload_id").references(() => workload.workloadId, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    principalId: text("principal_id").notNull(),
    reason: text("reason").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const siteManifest = factoryFleet.table(
  "site_manifest",
  {
    manifestId: text("manifest_id")
      .primaryKey()
      .$defaultFn(() => newId("mfst")),
    siteId: text("site_id")
      .notNull()
      .references(() => fleetSite.siteId, { onDelete: "cascade" }),
    manifestVersion: integer("manifest_version").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    releaseId: text("release_id").references(() => release.releaseId, {
      onDelete: "set null",
    }),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("site_manifest_site_version_unique").on(
      t.siteId,
      t.manifestVersion
    ),
    index("site_manifest_site_latest_idx").on(t.siteId, t.manifestVersion),
  ]
);

export const sandbox = factoryFleet.table(
  "sandbox",
  {
    sandboxId: text("sandbox_id").primaryKey().$defaultFn(() => newId("sbx")),
    deploymentTargetId: text("deployment_target_id").notNull()
      .references(() => deploymentTarget.deploymentTargetId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    runtimeType: text("runtime_type").notNull(),    // container | vm
    vmId: text("vm_id"),                            // set when runtimeType=vm
    podName: text("pod_name"),                      // set when runtimeType=container, once running
    devcontainerConfig: jsonb("devcontainer_config").notNull().default({}),
    devcontainerImage: text("devcontainer_image"),
    ownerId: text("owner_id").notNull(),
    ownerType: text("owner_type").notNull(),        // user | agent
    setupProgress: jsonb("setup_progress").notNull().default({}),
    statusMessage: text("status_message"),
    repos: jsonb("repos").notNull().default([]),    // [{url, branch, clonePath}]
    dockerCacheGb: integer("docker_cache_gb").notNull().default(20),
    cpu: text("cpu"),
    memory: text("memory"),
    storageGb: integer("storage_gb").notNull().default(10),
    sshHost: text("ssh_host"),
    sshPort: integer("ssh_port"),
    webTerminalUrl: text("web_terminal_url"),
    clonedFromSnapshotId: text("cloned_from_snapshot_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sandbox_deployment_target_unique").on(t.deploymentTargetId),
    uniqueIndex("sandbox_slug_unique").on(t.slug),
    index("sandbox_owner_idx").on(t.ownerType, t.ownerId),
    check("sandbox_runtime_type_valid", sql`${t.runtimeType} IN ('container', 'vm')`),
    check("sandbox_owner_type_valid", sql`${t.ownerType} IN ('user', 'agent')`),
  ]
);

export const preview = factoryFleet.table(
  "preview",
  {
    previewId: text("preview_id")
      .primaryKey()
      .$defaultFn(() => newId("prev")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    siteId: text("site_id").references(() => fleetSite.siteId, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sourceBranch: text("source_branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number"),
    ownerId: text("owner_id").notNull(),
    authMode: text("auth_mode").notNull().default("team"),
    runtimeClass: text("runtime_class").notNull().default("hot"),
    status: text("status").notNull().default("building"),
    statusMessage: text("status_message"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("preview_slug_unique").on(t.slug),
    uniqueIndex("preview_deployment_target_unique").on(t.deploymentTargetId),
    index("preview_site_idx").on(t.siteId),
    index("preview_status_idx").on(t.status),
    index("preview_branch_idx").on(t.sourceBranch),
    check(
      "preview_auth_mode_valid",
      sql`${t.authMode} IN ('public', 'team', 'private')`
    ),
    check(
      "preview_runtime_class_valid",
      sql`${t.runtimeClass} IN ('hot', 'warm', 'cold')`
    ),
    check(
      "preview_status_valid",
      sql`${t.status} IN ('building', 'deploying', 'active', 'inactive', 'expired', 'failed')`
    ),
  ]
);

export const sandboxTemplate = factoryFleet.table(
  "sandbox_template",
  {
    sandboxTemplateId: text("sandbox_template_id").primaryKey().$defaultFn(() => newId("sbt")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    runtimeType: text("runtime_type").notNull(),
    image: text("image"),
    defaultCpu: text("default_cpu"),
    defaultMemory: text("default_memory"),
    defaultStorageGb: integer("default_storage_gb"),
    defaultDockerCacheGb: integer("default_docker_cache_gb"),
    vmTemplateRef: text("vm_template_ref"),
    defaultTtlMinutes: integer("default_ttl_minutes"),
    preInstalledTools: jsonb("pre_installed_tools").notNull().default([]),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sandbox_template_slug_unique").on(t.slug),
    check("sandbox_template_runtime_valid", sql`${t.runtimeType} IN ('container', 'vm')`),
  ]
);

export const sandboxSnapshot = factoryFleet.table(
  "sandbox_snapshot",
  {
    sandboxSnapshotId: text("sandbox_snapshot_id").primaryKey().$defaultFn(() => newId("sns")),
    sandboxId: text("sandbox_id").notNull()
      .references(() => sandbox.sandboxId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    runtimeType: text("runtime_type").notNull(),
    volumeSnapshotName: text("volume_snapshot_name"),
    imageRef: text("image_ref"),
    proxmoxSnapshotName: text("proxmox_snapshot_name"),
    vmId: text("vm_id"),
    snapshotMetadata: jsonb("snapshot_metadata").notNull().default({}),
    sizeBytes: text("size_bytes"),
    status: text("status").notNull().default("creating"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sandbox_snapshot_sandbox_idx").on(t.sandboxId),
    check("snapshot_status_valid", sql`${t.status} IN ('creating', 'ready', 'failed', 'deleted')`),
    check("snapshot_runtime_valid", sql`${t.runtimeType} IN ('container', 'vm')`),
  ]
);

// sandboxAccess table removed — access control is now handled by
// auth-service resource permissions with parentId-based inheritance.

export const connectionAuditEvent = factoryFleet.table(
  "connection_audit_event",
  {
    eventId: text("event_id")
      .primaryKey()
      .$defaultFn(() => newId("cae")),
    principalId: text("principal_id").notNull(),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    connectedResources: jsonb("connected_resources").notNull().default({}),
    readonly: boolean("readonly").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: text("reason"),
  }
);

export const installManifest = factoryFleet.table(
  "install_manifest",
  {
    installManifestId: text("install_manifest_id")
      .primaryKey()
      .$defaultFn(() => newId("imfst")),
    siteId: text("site_id")
      .notNull()
      .references(() => fleetSite.siteId, { onDelete: "cascade" }),
    manifestVersion: integer("manifest_version").notNull().default(1),
    role: text("role").notNull().default("site"),
    dxVersion: text("dx_version").notNull(),
    installMode: text("install_mode").notNull().default("connected"),
    k3sVersion: text("k3s_version").notNull(),
    helmChartVersion: text("helm_chart_version").notNull(),
    siteName: text("site_name").notNull(),
    domain: text("domain").notNull(),
    enabledPlanes: jsonb("enabled_planes").notNull().default([]),
    nodes: jsonb("nodes").notNull().default([]),
    upgrades: jsonb("upgrades").notNull().default([]),
    rawManifest: jsonb("raw_manifest").notNull().default({}),
    reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("install_manifest_site_id_unique").on(t.siteId),
    index("install_manifest_role_idx").on(t.role),
    check("install_manifest_role_valid", sql`${t.role} IN ('site', 'factory')`),
    check("install_manifest_mode_valid", sql`${t.installMode} IN ('connected', 'offline')`),
  ]
);

export const fleetWorkbench = factoryFleet.table(
  "workbench",
  {
    workbenchId: text("workbench_id").primaryKey(), // client-generated wb-<8hex>
    type: text("type").notNull().default("developer"),
    hostname: text("hostname").notNull(),
    ips: jsonb("ips").notNull().default([]),
    os: text("os").notNull(),
    arch: text("arch").notNull(),
    dxVersion: text("dx_version").notNull(),
    principalId: text("principal_id"),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
    lastCommand: text("last_command"),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("fleet_workbench_type_idx").on(t.type),
    index("fleet_workbench_principal_idx").on(t.principalId),
    check(
      "fleet_workbench_type_valid",
      sql`${t.type} IN ('developer', 'ci', 'agent', 'sandbox', 'build', 'testbed')`
    ),
  ]
);

export const releaseBundle = factoryFleet.table(
  "release_bundle",
  {
    releaseBundleId: text("release_bundle_id")
      .primaryKey()
      .$defaultFn(() => newId("rbnd")),
    releaseId: text("release_id")
      .notNull()
      .references(() => release.releaseId, { onDelete: "cascade" }),
    role: text("role").notNull().default("site"),
    arch: text("arch").notNull().default("amd64"),
    dxVersion: text("dx_version").notNull(),
    k3sVersion: text("k3s_version").notNull(),
    helmChartVersion: text("helm_chart_version").notNull(),
    imageCount: integer("image_count").notNull().default(0),
    sizeBytes: text("size_bytes"),
    checksumSha256: text("checksum_sha256"),
    storagePath: text("storage_path"),
    status: text("status").notNull().default("building"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("release_bundle_release_idx").on(t.releaseId),
    index("release_bundle_status_idx").on(t.status),
    check("release_bundle_role_valid", sql`${t.role} IN ('site', 'factory')`),
    check("release_bundle_arch_valid", sql`${t.arch} IN ('amd64', 'arm64')`),
    check(
      "release_bundle_status_valid",
      sql`${t.status} IN ('building', 'ready', 'failed', 'expired')`
    ),
  ]
);
