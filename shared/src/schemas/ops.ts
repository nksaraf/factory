/**
 * Zod schemas for the `ops` schema — "What Is Running"
 * Single source of truth. TS types derived via z.infer<>.
 */
import { z } from "zod"

import { BitemporalSchema, ReconciliationSchema } from "./common"

// ── Site ────────────────────────────────────────────────────

export const SiteTypeSchema = z.enum([
  "production",
  "staging",
  "preview",
  "development",
  "sandbox",
  "qat",
  "test",
])
export type SiteType = z.infer<typeof SiteTypeSchema>

export const SiteStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "decommissioned",
])
export type SiteStatus = z.infer<typeof SiteStatusSchema>

export const SitePreviewConfigSchema = z.object({
  enabled: z.boolean().default(false),
  registry: z.string().optional(),
  defaultAuthMode: z.enum(["public", "team", "private"]).optional(),
  containerPort: z.number().optional(),
})
export type SitePreviewConfig = z.infer<typeof SitePreviewConfigSchema>

export const SiteSpecSchema = z.object({
  tenancy: z.enum(["shared", "dedicated"]).optional(),
  product: z.string().optional(),
  status: SiteStatusSchema.default("provisioning"),
  previewConfig: SitePreviewConfigSchema.optional(),
})
export type SiteSpec = z.infer<typeof SiteSpecSchema>

export const SiteSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: SiteTypeSchema,
    spec: SiteSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
export type Site = z.infer<typeof SiteSchema>

// ── Tenant ─────────────────────────────────────────────────

export const TenantEnvironmentSchema = z.enum([
  "production",
  "staging",
  "development",
  "preview",
])
export type TenantEnvironment = z.infer<typeof TenantEnvironmentSchema>

export const TenantStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "decommissioned",
])
export type TenantStatus = z.infer<typeof TenantStatusSchema>

export const TenantIsolationSchema = z.enum([
  "dedicated", // own infra (single tenant on site)
  "shared", // shared infra, app-level isolation (RLS, tenant ID)
  "siloed", // shared infra, infra-level isolation (own namespace, own pods)
])
export type TenantIsolation = z.infer<typeof TenantIsolationSchema>

export const TenantSpecSchema = z.object({
  environment: TenantEnvironmentSchema.default("development"),
  isolation: TenantIsolationSchema.default("shared"),
  status: TenantStatusSchema.default("provisioning"),
  k8sNamespace: z.string().optional(),
  resourceQuota: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
      storage: z.string().optional(),
    })
    .optional(),
  previewConfig: z
    .object({
      enabled: z.boolean().default(false),
      ttlDays: z.number().int().default(7),
      maxConcurrent: z.number().int().optional(),
      defaultAuthMode: z.enum(["public", "team", "private"]).default("team"),
    })
    .optional(),
})
export type TenantSpec = z.infer<typeof TenantSpecSchema>

export const TenantSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    siteId: z.string(),
    customerId: z.string(),
    spec: TenantSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
  .merge(ReconciliationSchema)
export type Tenant = z.infer<typeof TenantSchema>

// ── System Deployment ───────────────────────────────────────

export const DeploymentKindSchema = z.enum([
  "production",
  "staging",
  "dev",
  "preview",
])
export type DeploymentKind = z.infer<typeof DeploymentKindSchema>

export const DeploymentTriggerSchema = z.enum([
  "manual",
  "pr",
  "preview",
  "release",
  "agent",
  "ci",
])
export type DeploymentTrigger = z.infer<typeof DeploymentTriggerSchema>

export const DeploymentStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "destroying",
  "destroyed",
])
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>

export const DeploymentStrategySchema = z.enum([
  "rolling",
  "blue-green",
  "canary",
  "stateful",
])
export type DeploymentStrategy = z.infer<typeof DeploymentStrategySchema>

export const SystemDeploymentSpecSchema = z.object({
  trigger: DeploymentTriggerSchema.default("manual"),
  status: DeploymentStatusSchema.default("provisioning"),
  deploymentStrategy: DeploymentStrategySchema.default("rolling"),
  ttl: z.string().optional(), // e.g., "24h", "7d"
  expiresAt: z.coerce.date().optional(),
  labels: z.record(z.string()).default({}),
  desiredVersion: z.string().optional(),
  namespace: z.string().optional(), // k8s namespace
  createdBy: z.string().optional(),
  runtime: z
    .enum([
      "kubernetes",
      "docker-compose",
      "systemd",
      "windows_service",
      "iis",
      "process",
    ])
    .default("kubernetes"),
})
export type SystemDeploymentSpec = z.infer<typeof SystemDeploymentSpecSchema>

export const SystemDeploymentSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: DeploymentKindSchema,
    systemId: z.string(),
    siteId: z.string(),
    tenantId: z.string().nullable(),
    realmId: z.string().nullable(),
    workbenchId: z.string().nullable(),
    spec: SystemDeploymentSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
  .merge(ReconciliationSchema)
export type SystemDeployment = z.infer<typeof SystemDeploymentSchema>

// ── Component Deployment ────────────────────────────────────

export const ComponentDeploymentStatusSchema = z.enum([
  "provisioning",
  "running",
  "degraded",
  "stopped",
  "failed",
  "completed",
])
export type ComponentDeploymentStatus = z.infer<
  typeof ComponentDeploymentStatusSchema
>

export const DataLifecycleSchema = z
  .object({
    backupSchedule: z.string().optional(),
    retentionPolicy: z.string().optional(),
    snapshotStrategy: z.string().optional(),
    migrationVersion: z.string().optional(),
    replicationMode: z.string().optional(),
    anonymization: z.string().optional(),
    recoveryPointObjective: z.string().optional(),
    recoveryTimeObjective: z.string().optional(),
  })
  .optional()
export type DataLifecycle = z.infer<typeof DataLifecycleSchema>

export const ComponentDeploymentSpecSchema = z.object({
  replicas: z.number().int().default(1),
  envOverrides: z.record(z.string()).default({}),
  resourceOverrides: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
    })
    .default({}),
  desiredImage: z.string().optional(),
  actualImage: z.string().optional(),
  trackedImageRef: z.string().optional(),
  driftDetected: z.boolean().default(false),
  status: ComponentDeploymentStatusSchema.default("provisioning"),
  lastReconciledAt: z.coerce.date().optional(),
  statusMessage: z.string().optional(),
  dataLifecycle: DataLifecycleSchema,
})
export type ComponentDeploymentSpec = z.infer<
  typeof ComponentDeploymentSpecSchema
>

export const ComponentDeploymentSchema = z
  .object({
    id: z.string(),
    systemDeploymentId: z.string(),
    deploymentSetId: z.string().nullable(),
    componentId: z.string(),
    artifactId: z.string().nullable(),
    workbenchId: z.string().nullable(),
    serviceId: z.string().nullable(),
    spec: ComponentDeploymentSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type ComponentDeployment = z.infer<typeof ComponentDeploymentSchema>

export const CreateComponentDeploymentSchema = z.object({
  systemDeploymentId: z.string().min(1),
  deploymentSetId: z.string().nullable().optional(),
  componentId: z.string().min(1),
  artifactId: z.string().nullable().optional(),
  workbenchId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  spec: ComponentDeploymentSpecSchema.partial().default({}),
})
export type CreateComponentDeployment = z.infer<
  typeof CreateComponentDeploymentSchema
>

export const UpdateComponentDeploymentSchema = z.object({
  spec: ComponentDeploymentSpecSchema.partial().optional(),
  artifactId: z.string().nullable().optional(),
})
export type UpdateComponentDeployment = z.infer<
  typeof UpdateComponentDeploymentSchema
>

// ── DeploymentSet ──────────────────────────────────────────

export const DeploymentSetRoleSchema = z.enum([
  "active", // single active (rolling deploy, or post-cutover)
  "blue", // blue-green: current live
  "green", // blue-green: new version being promoted
  "stable", // canary: baseline
  "canary", // canary: experimental
  "primary", // stateful: write leader
  "replica", // stateful: read follower
  "standby", // warm standby for failover
])
export type DeploymentSetRole = z.infer<typeof DeploymentSetRoleSchema>

export const DeploymentSetStatusSchema = z.enum([
  "provisioning",
  "running",
  "draining", // traffic being shifted away
  "stopped",
  "failed",
])
export type DeploymentSetStatus = z.infer<typeof DeploymentSetStatusSchema>

export const DeploymentSetSpecSchema = z.object({
  role: DeploymentSetRoleSchema.default("active"),
  trafficWeight: z.number().min(0).max(100).default(100),
  status: DeploymentSetStatusSchema.default("provisioning"),
  desiredVersion: z.string().optional(), // overrides SystemDeployment if set
  testUrl: z.string().optional(), // per-set URL for pre-switch verification
})
export type DeploymentSetSpec = z.infer<typeof DeploymentSetSpecSchema>

export const DeploymentSetSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    systemDeploymentId: z.string(),
    realmId: z.string().nullable(), // can target a different realm than parent
    spec: DeploymentSetSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type DeploymentSet = z.infer<typeof DeploymentSetSchema>

// ── Workbench ───────────────────────────────────────────────

export const WorkbenchTypeSchema = z.enum([
  "worktree",
  "container",
  "vm",
  "preview-build",
  "preview-dev",
  "namespace",
  "pod",
  "bare-process",
  "function",
  "sandbox",
  "edge-worker",
  "static",
])
export type WorkbenchType = z.infer<typeof WorkbenchTypeSchema>

export const WorkbenchHealthSchema = z.enum([
  "unknown",
  "building",
  "ready",
  "unhealthy",
  "terminated",
])
export type WorkbenchHealth = z.infer<typeof WorkbenchHealthSchema>

export const WorkbenchRepoSchema = z.object({
  url: z.string(),
  branch: z.string().optional(),
  clonePath: z.string().optional(),
})
export type WorkbenchRepo = z.infer<typeof WorkbenchRepoSchema>

export const WorkbenchSpecSchema = z.object({
  realmType: z.string().optional(), // provisioning hint: "container" | "vm"
  devcontainerConfig: z.record(z.unknown()).default({}),
  repos: z.array(WorkbenchRepoSchema).default([]),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  storageGb: z.number().int().optional(),
  dockerCacheGb: z.number().int().optional(),
  ownerType: z.enum(["user", "agent"]).default("user"),
  authMode: z.enum(["public", "team", "private"]).default("private"),
  accessMethod: z
    .string()
    .optional()
    .describe(
      "Common: ssh, kubectl-exec, docker-exec, console-logs, web-terminal, none"
    ),
  sshHost: z.string().optional(),
  sshPort: z.number().int().optional(),
  webTerminalUrl: z.string().optional(),
  webIdeUrl: z.string().optional(),
  podName: z.string().optional(),
  ipAddress: z.string().optional(),
  healthStatus: WorkbenchHealthSchema.default("unknown"),
  setupProgress: z.record(z.unknown()).default({}),
  lifecycle: z
    .enum(["provisioning", "active", "suspended", "destroying", "destroyed"])
    .default("provisioning"),
  expiresAt: z.coerce.date().optional(),
  sourceBranch: z.string().optional(),
  prNumber: z.number().int().optional(),
  commitSha: z.string().optional(),
  imageRef: z.string().optional(),
  runtimeClass: z.string().optional(),
})
export type WorkbenchSpec = z.infer<typeof WorkbenchSpecSchema>

export const WorkbenchSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: WorkbenchTypeSchema,
    siteId: z.string().nullable(),
    hostId: z.string().nullable(),
    realmId: z.string().nullable(),
    serviceId: z.string().nullable(),
    parentWorkbenchId: z.string().nullable(),
    templateId: z.string().nullable(),
    ownerId: z.string(),
    spec: WorkbenchSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
  .merge(ReconciliationSchema)
export type Workbench = z.infer<typeof WorkbenchSchema>

// ── Workbench Snapshot ──────────────────────────────────────

export const WorkbenchSnapshotSpecSchema = z.object({
  volumeSnapshotName: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  status: z
    .enum(["creating", "ready", "failed", "deleted"])
    .default("creating"),
  error: z.string().optional(),
})
export type WorkbenchSnapshotSpec = z.infer<typeof WorkbenchSnapshotSpecSchema>

export const WorkbenchSnapshotSchema = z.object({
  id: z.string(),
  workbenchId: z.string(),
  spec: WorkbenchSnapshotSpecSchema,
  createdAt: z.coerce.date(),
})
export type WorkbenchSnapshot = z.infer<typeof WorkbenchSnapshotSchema>

// ── Preview ─────────────────────────────────────────────────

export const PreviewPhaseSchema = z.enum([
  "pending_image",
  "building",
  "deploying",
  "provisioning",
  "starting",
  "active",
  "inactive",
  "expired",
  "failed",
])
export type PreviewPhase = z.infer<typeof PreviewPhaseSchema>

export const PreviewStrategySchema = z.enum(["deploy", "dev"])
export type PreviewStrategy = z.infer<typeof PreviewStrategySchema>

export const RuntimeClassSchema = z.enum(["hot", "warm", "cold"])
export type RuntimeClass = z.infer<typeof RuntimeClassSchema>

export const PreviewSpecSchema = z.object({
  name: z.string().optional(),
  createdBy: z.string().optional(),
  commitSha: z.string().optional(),
  repo: z.string().optional(),
  systemId: z.string().optional(),
  runtimeClass: RuntimeClassSchema.default("warm"),
  authMode: z.enum(["public", "team", "private"]).default("team"),
  imageRef: z.string().nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  statusMessage: z.string().optional(),
  githubDeploymentId: z.number().int().optional(),
  githubCommentId: z.number().int().optional(),
  lastAccessedAt: z.coerce.date().optional(),
})
export type PreviewSpec = z.infer<typeof PreviewSpecSchema>

export const PreviewSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    strategy: PreviewStrategySchema.default("deploy"),
    siteId: z.string(),
    ownerId: z.string(),
    phase: PreviewPhaseSchema.default("pending_image"),
    sourceBranch: z.string(),
    prNumber: z.number().int().nullable(),
    workbenchId: z.string().nullable().optional(),
    systemDeploymentId: z.string().nullable().optional(),
    realmId: z.string().nullable().optional(),
    spec: PreviewSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Preview = z.infer<typeof PreviewSchema>

// ── Database ────────────────────────────────────────────────

export const DatabaseEngineSchema = z.enum([
  "postgres",
  "mysql",
  "redis",
  "mongodb",
])
export type DatabaseEngine = z.infer<typeof DatabaseEngineSchema>

export const ProvisionModeSchema = z.enum(["sidecar", "managed", "external"])
export type ProvisionMode = z.infer<typeof ProvisionModeSchema>

export const DatabaseSpecSchema = z.object({
  engine: DatabaseEngineSchema,
  version: z.string().optional(),
  provisionMode: ProvisionModeSchema.default("sidecar"),
  connectionString: z.string().optional(), // encrypted at rest
  backupConfig: z
    .object({
      schedule: z.string().optional(), // cron expression
      retention: z.number().int().default(7), // days
      destination: z.string().optional(), // s3 bucket, etc.
    })
    .optional(),
  seedConfig: z
    .object({
      sourceRef: z.string().optional(), // backup ID or URL
      anonymizationProfileId: z.string().optional(),
    })
    .optional(),
  status: z
    .enum(["provisioning", "running", "stopped", "failed"])
    .default("provisioning"),
})
export type DatabaseSpec = z.infer<typeof DatabaseSpecSchema>

export const DatabaseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  systemDeploymentId: z.string(),
  componentId: z.string().nullable(),
  spec: DatabaseSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Database = z.infer<typeof DatabaseSchema>

// ── Database Operation ──────────────────────────────────────

export const DatabaseOperationTypeSchema = z.enum([
  "backup",
  "restore",
  "seed",
  "anonymize",
])
export type DatabaseOperationType = z.infer<typeof DatabaseOperationTypeSchema>

export const DatabaseOperationSpecSchema = z.object({
  status: z
    .enum(["pending", "running", "succeeded", "failed"])
    .default("pending"),
  k8sJobRef: z.string().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  error: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  targetRef: z.string().optional(), // backup destination or restore source
})
export type DatabaseOperationSpec = z.infer<typeof DatabaseOperationSpecSchema>

export const DatabaseOperationSchema = z.object({
  id: z.string(),
  type: DatabaseOperationTypeSchema,
  databaseId: z.string(),
  spec: DatabaseOperationSpecSchema,
  createdAt: z.coerce.date(),
})
export type DatabaseOperation = z.infer<typeof DatabaseOperationSchema>

// ── Anonymization Profile ───────────────────────────────────

export const AnonymizationRuleSchema = z.object({
  table: z.string(),
  column: z.string(),
  strategy: z.enum(["hash", "fake", "mask", "null", "truncate", "shuffle"]),
  params: z.record(z.string()).default({}),
})
export type AnonymizationRule = z.infer<typeof AnonymizationRuleSchema>

export const AnonymizationProfileSpecSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  rules: z.array(AnonymizationRuleSchema).default([]),
})
export type AnonymizationProfileSpec = z.infer<
  typeof AnonymizationProfileSpecSchema
>

export const AnonymizationProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  spec: AnonymizationProfileSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type AnonymizationProfile = z.infer<typeof AnonymizationProfileSchema>

// ── Rollout ─────────────────────────────────────────────────

export const RolloutStatusSchema = z.enum([
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "rolled_back",
])
export type RolloutStatus = z.infer<typeof RolloutStatusSchema>

export const RolloutSpecSchema = z.object({
  status: RolloutStatusSchema.default("pending"),
  strategy: z.enum(["rolling", "blue-green", "canary"]).default("rolling"),
  progress: z.number().min(0).max(100).default(0),
  fromDeploymentSetId: z.string().optional(), // the set being replaced
  toDeploymentSetId: z.string().optional(), // the set being promoted
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  error: z.string().optional(),
})
export type RolloutSpec = z.infer<typeof RolloutSpecSchema>

export const RolloutSchema = z
  .object({
    id: z.string(),
    releaseId: z.string(),
    systemDeploymentId: z.string(),
    spec: RolloutSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Rollout = z.infer<typeof RolloutSchema>

// ── Intervention ────────────────────────────────────────────

export const InterventionTypeSchema = z.enum([
  "restart",
  "scale",
  "rollback",
  "manual",
])
export type InterventionType = z.infer<typeof InterventionTypeSchema>

export const InterventionSpecSchema = z.object({
  reason: z.string(),
  actorPrincipalId: z.string().optional(),
  result: z.enum(["pending", "success", "failure"]).default("pending"),
  details: z.record(z.unknown()).default({}),
  executedAt: z.coerce.date().optional(),
})
export type InterventionSpec = z.infer<typeof InterventionSpecSchema>

export const InterventionSchema = z.object({
  id: z.string(),
  type: InterventionTypeSchema,
  systemDeploymentId: z.string(),
  componentDeploymentId: z.string().nullable(),
  spec: InterventionSpecSchema,
  createdAt: z.coerce.date(),
})
export type Intervention = z.infer<typeof InterventionSchema>

// ── Forwarded Port ──────────────────────────────────────────

export const ForwardedPortTypeSchema = z.enum(["http", "tcp"])
export type ForwardedPortType = z.infer<typeof ForwardedPortTypeSchema>

export const ForwardedPortSpecSchema = z.object({
  localPort: z.number().int(),
  remotePort: z.number().int(),
  protocol: z.enum(["http", "tcp"]).default("http"),
  label: z.string().optional(),
})
export type ForwardedPortSpec = z.infer<typeof ForwardedPortSpecSchema>

export const ForwardedPortSchema = z.object({
  id: z.string(),
  type: ForwardedPortTypeSchema,
  workbenchId: z.string(),
  spec: ForwardedPortSpecSchema,
  createdAt: z.coerce.date(),
})
export type ForwardedPort = z.infer<typeof ForwardedPortSchema>

// ── Site Manifest ───────────────────────────────────────────

export const SiteManifestSpecSchema = z.object({
  version: z.number().int(),
  config: z.record(z.unknown()).default({}),
  appliedAt: z.coerce.date().optional(),
})
export type SiteManifestSpec = z.infer<typeof SiteManifestSpecSchema>

export const SiteManifestSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  releaseId: z.string().nullable(),
  spec: SiteManifestSpecSchema,
  createdAt: z.coerce.date(),
})
export type SiteManifest = z.infer<typeof SiteManifestSchema>

// ── Install Manifest ────────────────────────────────────────

export const InstallManifestSpecSchema = z.object({
  installState: z.record(z.unknown()).default({}),
  lastCheckinAt: z.coerce.date().optional(),
  currentVersion: z.number().int().optional(),
})
export type InstallManifestSpec = z.infer<typeof InstallManifestSpecSchema>

export const InstallManifestSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  spec: InstallManifestSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type InstallManifest = z.infer<typeof InstallManifestSchema>

// ── Connection Audit Event ──────────────────────────────────

export const ConnectionAuditSpecSchema = z.object({
  principalId: z.string(),
  transport: z.enum(["ssh", "kubectl", "web"]),
  sourceIp: z.string().optional(),
  action: z.enum(["connect", "disconnect"]),
  timestamp: z.coerce.date(),
  duration: z.number().int().optional(), // seconds
  metadata: z.record(z.string()).default({}),
})
export type ConnectionAuditSpec = z.infer<typeof ConnectionAuditSpecSchema>

export const ConnectionAuditEventSchema = z.object({
  id: z.string(),
  systemDeploymentId: z.string().nullable(),
  spec: ConnectionAuditSpecSchema,
  createdAt: z.coerce.date(),
})
export type ConnectionAuditEvent = z.infer<typeof ConnectionAuditEventSchema>

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateSiteSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: SiteTypeSchema.default("production"),
  spec: SiteSpecSchema.default({}),
})
export const UpdateSiteSchema = CreateSiteSchema.partial()

export const CreateTenantSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  siteId: z.string(),
  customerId: z.string(),
  spec: TenantSpecSchema.default({}),
})
export const UpdateTenantSchema = CreateTenantSchema.partial()

export const CreateSystemDeploymentSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: DeploymentKindSchema,
  systemId: z.string(),
  siteId: z.string(),
  tenantId: z.string().optional(),
  realmId: z.string().optional(),
  workbenchId: z.string().optional(),
  spec: SystemDeploymentSpecSchema.default({}),
})
export const UpdateSystemDeploymentSchema =
  CreateSystemDeploymentSchema.partial()

export const CreateDeploymentSetSchema = z.object({
  slug: z.string().min(1).max(100),
  systemDeploymentId: z.string(),
  realmId: z.string().optional(),
  spec: DeploymentSetSpecSchema.default({}),
})
export const UpdateDeploymentSetSchema = CreateDeploymentSetSchema.partial()

export const CreateWorkbenchSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: WorkbenchTypeSchema,
  siteId: z.string().optional(),
  hostId: z.string().optional(),
  realmId: z.string().optional(),
  serviceId: z.string().optional(),
  parentWorkbenchId: z.string().optional(),
  templateId: z.string().optional(),
  ownerId: z.string(),
  spec: WorkbenchSpecSchema.default({}),
})
export const UpdateWorkbenchSchema = CreateWorkbenchSchema.partial()

export const CreateRolloutSchema = z.object({
  releaseId: z.string(),
  systemDeploymentId: z.string(),
  spec: RolloutSpecSchema.default({}),
})
export const UpdateRolloutSchema = CreateRolloutSchema.partial()

// ── Preview ─────────────────────────────────────────────────

export const CreatePreviewSchema = z.object({
  siteId: z.string().min(1),
  ownerId: z.string().optional(),
  strategy: PreviewStrategySchema.default("deploy"),
  sourceBranch: z.string().min(1),
  prNumber: z.number().int().optional(),
  workbenchId: z.string().optional(),
  systemDeploymentId: z.string().optional(),
  realmId: z.string().optional(),
  spec: PreviewSpecSchema.default({}),
})
export const UpdatePreviewSchema = z.object({
  phase: PreviewPhaseSchema.optional(),
  strategy: PreviewStrategySchema.optional(),
  workbenchId: z.string().nullable().optional(),
  systemDeploymentId: z.string().nullable().optional(),
  realmId: z.string().nullable().optional(),
  spec: PreviewSpecSchema.partial().optional(),
})

// ── Intervention ────────────────────────────────────────────

export const CreateInterventionSchema = z.object({
  type: InterventionTypeSchema,
  systemDeploymentId: z.string().min(1),
  componentDeploymentId: z.string().optional(),
  spec: InterventionSpecSchema.partial().default({
    reason: "Manual intervention",
  }),
})

// ── Connection Audit Event ──────────────────────────────────

export const CreateConnectionAuditEventSchema = z.object({
  systemDeploymentId: z.string().optional(),
  spec: ConnectionAuditSpecSchema,
})
export const UpdateConnectionAuditEventSchema = z.object({
  spec: ConnectionAuditSpecSchema.partial(),
})

// ── Install Manifest ────────────────────────────────────────

export const CreateInstallManifestSchema = z.object({
  siteId: z.string().min(1),
  spec: InstallManifestSpecSchema.default({}),
})
export const UpdateInstallManifestSchema = z.object({
  spec: InstallManifestSpecSchema.partial(),
})

// ── Site Manifest ───────────────────────────────────────────

export const CreateSiteManifestSchema = z.object({
  siteId: z.string().min(1),
  releaseId: z.string().optional(),
  spec: SiteManifestSpecSchema,
})
export const UpdateSiteManifestSchema = z.object({
  spec: SiteManifestSpecSchema.partial(),
})

// ── Database ────────────────────────────────────────────────

export const CreateDatabaseSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  systemDeploymentId: z.string().optional(),
  componentId: z.string().optional(),
  spec: DatabaseSpecSchema,
})
export const UpdateDatabaseSchema = CreateDatabaseSchema.partial()

// ── Database Operation ──────────────────────────────────────

export const CreateDatabaseOperationSchema = z.object({
  type: DatabaseOperationTypeSchema,
  databaseId: z.string().min(1),
  spec: DatabaseOperationSpecSchema.default({}),
})

// ── Anonymization Profile ───────────────────────────────────

export const CreateAnonymizationProfileSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  spec: AnonymizationProfileSpecSchema,
})
export const UpdateAnonymizationProfileSchema =
  CreateAnonymizationProfileSchema.partial()

// ── Forwarded Port ──────────────────────────────────────────

export const CreateForwardedPortSchema = z.object({
  type: ForwardedPortTypeSchema,
  workbenchId: z.string().min(1),
  spec: ForwardedPortSpecSchema,
})
