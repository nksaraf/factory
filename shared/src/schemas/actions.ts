/**
 * Zod body schemas for entity action routes.
 *
 * These validate the request body for `POST /:entity/:slugOrId/:action` routes
 * wired through the `ontologyRoutes()` `actions` config.
 */
import { z } from "zod"

import { HostScanResultSchema } from "./infra"

// ── Agent: Job actions ──────────────────────────────────────

export const CompleteJobBody = z.object({
  outcome: z.record(z.unknown()).optional(),
  costCents: z.number().int().optional(),
})
export type CompleteJobBody = z.infer<typeof CompleteJobBody>

export const FailJobBody = z.object({
  outcome: z.record(z.unknown()).optional(),
})
export type FailJobBody = z.infer<typeof FailJobBody>

export const OverrideJobBody = z.object({
  note: z.string().min(1),
})
export type OverrideJobBody = z.infer<typeof OverrideJobBody>

// ── Agent: Memory actions ───────────────────────────────────

export const ApproveMemoryBody = z.object({
  approvedByPrincipalId: z.string().min(1),
})
export type ApproveMemoryBody = z.infer<typeof ApproveMemoryBody>

export const SupersedeMemoryBody = z.object({
  replacementId: z.string().optional(),
})
export type SupersedeMemoryBody = z.infer<typeof SupersedeMemoryBody>

export const PromoteMemoryBody = z.object({
  targetOrgId: z.string().min(1),
})
export type PromoteMemoryBody = z.infer<typeof PromoteMemoryBody>

// ── Ops: Site actions ─────────────────────────────────────

export const SiteCheckinBody = z.object({
  status: z.string(),
  manifest: z.record(z.unknown()).optional(),
  installState: z.record(z.unknown()).optional(),
  currentVersion: z.number().int().optional(),
})
export type SiteCheckinBody = z.infer<typeof SiteCheckinBody>

export const AssignReleaseBody = z.object({
  releaseVersion: z.string().min(1),
})
export type AssignReleaseBody = z.infer<typeof AssignReleaseBody>

// ── Ops: Rollout actions ──────────────────────────────────

export const UpdateRolloutStatusBody = z.object({
  status: z.enum([
    "pending",
    "in_progress",
    "succeeded",
    "failed",
    "rolled_back",
  ]),
})
export type UpdateRolloutStatusBody = z.infer<typeof UpdateRolloutStatusBody>

// ── Ops: Workbench actions ────────────────────────────────

export const ExtendWorkbenchBody = z.object({
  minutes: z.number().int().min(1),
})
export type ExtendWorkbenchBody = z.infer<typeof ExtendWorkbenchBody>

export const SnapshotWorkbenchBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
})
export type SnapshotWorkbenchBody = z.infer<typeof SnapshotWorkbenchBody>

export const ResizeWorkbenchBody = z.object({
  cpu: z.string().optional(),
  memory: z.string().optional(),
  storageGb: z.number().int().optional(),
})
export type ResizeWorkbenchBody = z.infer<typeof ResizeWorkbenchBody>

export const RestoreSnapshotBody = z.object({
  workbenchId: z.string().min(1),
})
export type RestoreSnapshotBody = z.infer<typeof RestoreSnapshotBody>

export const CloneSnapshotBody = z.object({
  name: z.string().min(1),
  ownerId: z.string().min(1),
  ownerType: z.enum(["user", "agent"]).default("user"),
})
export type CloneSnapshotBody = z.infer<typeof CloneSnapshotBody>

// ── Ops: Component Deployment actions ─────────────────────

export const ScaleComponentDeploymentBody = z.object({
  replicas: z.number().int().min(0),
})
export type ScaleComponentDeploymentBody = z.infer<
  typeof ScaleComponentDeploymentBody
>

export const RestartComponentDeploymentBody = z.object({
  reason: z.string().optional(),
})
export type RestartComponentDeploymentBody = z.infer<
  typeof RestartComponentDeploymentBody
>

// ── Ops: Workbench actions ────────────────────────────────

export const WorkbenchPingBody = z.object({
  hostname: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  nodes: z.array(z.record(z.unknown())).optional(),
  connectedResources: z.record(z.unknown()).optional(),
})
export type WorkbenchPingBody = z.infer<typeof WorkbenchPingBody>

// ── Ops: Preview actions ─────────────────────────────────

export const UpdatePreviewStatusBody = z.object({
  phase: z.enum([
    "pending_image",
    "building",
    "deploying",
    "active",
    "inactive",
    "expired",
    "failed",
  ]),
  statusMessage: z.string().optional(),
})
export type UpdatePreviewStatusBody = z.infer<typeof UpdatePreviewStatusBody>

export const DeliverPreviewImageBody = z.object({
  imageRef: z.string().min(1),
  commitSha: z.string().optional(),
})
export type DeliverPreviewImageBody = z.infer<typeof DeliverPreviewImageBody>

export const ExtendPreviewBody = z.object({
  minutes: z.number().int().min(1).max(43200),
})
export type ExtendPreviewBody = z.infer<typeof ExtendPreviewBody>

// ── Ops: Database actions ───────────────────────────────

export const DatabaseOperationBody = z.object({
  spec: z.record(z.unknown()).default({}),
})
export type DatabaseOperationBody = z.infer<typeof DatabaseOperationBody>

// ── Build: Git Host Provider actions ────────────────────────

/** @deprecated Use CreatePullRequestBody on repos instead */
export const CreatePullRequestBodyLegacy = z.object({
  repoSlug: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  head: z.string().min(1),
  base: z.string().min(1),
})
export type CreatePullRequestBodyLegacy = z.infer<
  typeof CreatePullRequestBodyLegacy
>

/** @deprecated Use MergePullRequestBody on repos instead */
export const MergePullRequestBodyLegacy = z.object({
  repoSlug: z.string().min(1),
  prNumber: z.number().int(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
})
export type MergePullRequestBodyLegacy = z.infer<
  typeof MergePullRequestBodyLegacy
>

/** Create a PR on this repo — no repoSlug needed, the repo IS the entity */
export const CreatePullRequestBody = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  head: z.string().min(1),
  base: z.string().min(1),
})
export type CreatePullRequestBody = z.infer<typeof CreatePullRequestBody>

/** Merge a PR on this repo — no repoSlug needed, the repo IS the entity */
export const MergePullRequestBody = z.object({
  prNumber: z.number().int(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
})
export type MergePullRequestBody = z.infer<typeof MergePullRequestBody>

// ── Build: Pipeline Run actions ─────────────────────────────

export const TriggerBuildBody = z.object({
  repoId: z.string().min(1),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
})
export type TriggerBuildBody = z.infer<typeof TriggerBuildBody>

// ── Product: Work item actions ──────────────────────────────

export const PushWorkItemBody = z.object({
  workTrackerProviderId: z.string().min(1),
})
export type PushWorkItemBody = z.infer<typeof PushWorkItemBody>

// ── Messaging: Channel mapping ──────────────────────────────

export const MapChannelBody = z.object({
  externalChannelId: z.string().min(1),
  externalChannelName: z.string().optional(),
  teamId: z.string().optional(),
})
export type MapChannelBody = z.infer<typeof MapChannelBody>

export const LinkMessagingUserBody = z.object({
  externalUserId: z.string().min(1),
  principalId: z.string().min(1),
})
export type LinkMessagingUserBody = z.infer<typeof LinkMessagingUserBody>

// ── Thread actions ──────────────────────────────────────────

export const CompleteThreadBody = z.object({
  result: z
    .object({
      summary: z.string().optional(),
      artifacts: z.array(z.string()).optional(),
      commitRange: z.string().optional(),
    })
    .optional(),
})
export type CompleteThreadBody = z.infer<typeof CompleteThreadBody>

export const ForkThreadBody = z.object({
  source: z.string().optional(),
  spec: z.record(z.unknown()).optional(),
  continuationNote: z.string().optional(),
})
export type ForkThreadBody = z.infer<typeof ForkThreadBody>

// ── Ops: Release actions ──────────────────────────────────

export const PromoteReleaseBody = z.object({
  targetSites: z.array(z.string()).optional(),
  strategy: z.enum(["rolling", "blue-green", "canary"]).optional(),
})
export type PromoteReleaseBody = z.infer<typeof PromoteReleaseBody>

// ── Infra: Estate actions ────────────────────────────────

export const SyncEstateBody = z.object({
  force: z.boolean().default(false),
})
export type SyncEstateBody = z.infer<typeof SyncEstateBody>

// ── Infra: Realm actions ──────────────────────────────────

export const UpgradeRealmBody = z.object({
  targetVersion: z.string().min(1),
  strategy: z.enum(["in-place", "rolling", "blue-green"]).default("rolling"),
})
export type UpgradeRealmBody = z.infer<typeof UpgradeRealmBody>

// ── Infra: Host actions ─────────────────────────────────────

export const HostLifecycleBody = z.object({
  reason: z.string().optional(),
})
export type HostLifecycleBody = z.infer<typeof HostLifecycleBody>

export const ResizeHostBody = z.object({
  cpu: z.number().int().optional(),
  memoryMb: z.number().int().optional(),
  diskGb: z.number().int().optional(),
})
export type ResizeHostBody = z.infer<typeof ResizeHostBody>

export const MigrateHostBody = z.object({
  targetEstateId: z.string().min(1),
  reason: z.string().optional(),
})
export type MigrateHostBody = z.infer<typeof MigrateHostBody>

export const CloneHostBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
})
export type CloneHostBody = z.infer<typeof CloneHostBody>

export const SnapshotHostBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
})
export type SnapshotHostBody = z.infer<typeof SnapshotHostBody>

export const RestoreHostSnapshotBody = z.object({
  snapshotId: z.string().min(1),
})
export type RestoreHostSnapshotBody = z.infer<typeof RestoreHostSnapshotBody>

export { HostScanResultSchema } from "./infra"

export const ScanHostBody = z.object({
  scanResult: HostScanResultSchema,
})
export type ScanHostBody = z.infer<typeof ScanHostBody>

// ── Infra: Tunnel actions ───────────────────────────────────

export const CloseTunnelBody = z.object({
  reason: z.string().optional(),
})
export type CloseTunnelBody = z.infer<typeof CloseTunnelBody>

// ── Infra: Secret actions ───────────────────────────────────

export const RevokeSecretBody = z.object({
  reason: z.string().optional(),
})
export type RevokeSecretBody = z.infer<typeof RevokeSecretBody>

// ── Infra: IP Address actions ───────────────────────────────

export const AssignIpBody = z.object({
  assignedToKind: z.string().min(1),
  assignedToId: z.string().min(1),
})
export type AssignIpBody = z.infer<typeof AssignIpBody>

export const AllocateIpBody = z.object({
  subnetId: z.string().min(1),
  assignedToKind: z.string().optional(),
  assignedToId: z.string().optional(),
  strategy: z.enum(["sequential", "random"]).default("sequential"),
})
export type AllocateIpBody = z.infer<typeof AllocateIpBody>
