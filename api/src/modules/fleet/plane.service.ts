import type { Database } from "../../db/connection"
import type { SandboxAdapter } from "../../adapters/sandbox-adapter"
import { NoopSandboxAdapter } from "../../adapters/sandbox-adapter-noop"
import type { FleetModels } from "./model"
import {
  listReleases,
  createRelease,
  getRelease,
  promoteRelease,
  addModulePin,
  removeModulePin,
  listReleasePins,
  listSites as listSitesService,
  createSite as createSiteService,
  getSite as getSiteService,
  deleteSite as deleteSiteService,
  updateSiteStatus,
  assignTenant as assignTenantService,
  listDeploymentTargets as listDeploymentTargetsService,
  createDeploymentTarget as createDeploymentTargetService,
  getDeploymentTarget as getDeploymentTargetService,
  updateDeploymentTargetStatus as updateDeploymentTargetStatusService,
  destroyDeploymentTarget as destroyDeploymentTargetService,
  listWorkloads as listWorkloadsService,
  createWorkload as createWorkloadService,
  getWorkload as getWorkloadService,
  updateWorkload as updateWorkloadService,
  deleteWorkload as deleteWorkloadService,
  listDependencyWorkloads as listDependencyWorkloadsService,
  createDependencyWorkload as createDependencyWorkloadService,
  updateDependencyWorkloadStatus as updateDependencyWorkloadStatusService,
  createRollout as createRolloutService,
  getRollout as getRolloutService,
  updateRolloutStatus as updateRolloutStatusService,
  listRollouts as listRolloutsService,
  createWorkloadOverride as createWorkloadOverrideService,
  revertWorkloadOverride as revertWorkloadOverrideService,
  listWorkloadOverrides as listWorkloadOverridesService,
  createIntervention as createInterventionService,
  listInterventions as listInterventionsService,
  listSandboxes as listSandboxesService,
  createSandbox as createSandboxService,
  destroySandbox as destroySandboxService,
  cleanupExpiredSandboxes as cleanupExpiredSandboxesService,
  createSnapshot as createSnapshotService,
  listSnapshots as listSnapshotsService,
  getSnapshot as getSnapshotService,
  deleteSnapshot as deleteSnapshotService,
  siteCheckin as siteCheckinService,
  assignReleaseToSite as assignReleaseToSiteService,
  getSiteManifest as getSiteManifestService,
  createConnectionAuditEvent as createConnectionAuditEventService,
  endConnectionAuditEvent as endConnectionAuditEventService,
  listConnectionAuditEvents as listConnectionAuditEventsService,
} from "./service"
import {
  listInstallManifests as listInstallManifestsService,
  getInstallManifestBySite as getInstallManifestBySiteService,
  upsertInstallManifest as upsertInstallManifestService,
  listReleaseBundles as listReleaseBundlesService,
  getReleaseBundleById as getReleaseBundleByIdService,
  createReleaseBundle as createReleaseBundleService,
  updateReleaseBundleStatus as updateReleaseBundleStatusService,
} from "./install-manifest.service"
import type { InstallManifest } from "@smp/factory-shared/install-types"

export class FleetPlaneService {
  private readonly sandboxAdapter: SandboxAdapter

  constructor(
    private readonly db: Database,
    sandboxAdapter?: SandboxAdapter
  ) {
    this.sandboxAdapter = sandboxAdapter ?? new NoopSandboxAdapter()
  }

  listReleases(opts?: { status?: string }) {
    return listReleases(this.db, opts)
  }

  createRelease(body: FleetModels["createReleaseBody"] & { createdBy?: string; modulePins?: Array<{ moduleVersionId: string }> }) {
    return createRelease(this.db, {
      ...body,
      createdBy: body.createdBy ?? "system",
    })
  }

  getRelease(version: string) {
    return getRelease(this.db, version)
  }

  promoteRelease(version: string, body: FleetModels["promoteReleaseBody"]) {
    return promoteRelease(this.db, version, body.target ?? "staging")
  }

  addModulePin(releaseId: string, moduleVersionId: string) {
    return addModulePin(this.db, releaseId, moduleVersionId)
  }

  removeModulePin(releaseId: string, moduleVersionId: string) {
    return removeModulePin(this.db, releaseId, moduleVersionId)
  }

  listReleasePins(releaseId: string) {
    return listReleasePins(this.db, releaseId)
  }

  // ---- Site lifecycle ----

  listSites(opts?: { product?: string; status?: string }) {
    return listSitesService(this.db, opts)
  }

  createSite(body: FleetModels["createSiteBody"] & { clusterId?: string; createdBy?: string }) {
    return createSiteService(this.db, {
      name: body.name,
      product: body.product,
      clusterId: body.clusterId ?? "default",
      createdBy: body.createdBy ?? "system",
    })
  }

  deleteSite(name: string) {
    return deleteSiteService(this.db, name)
  }

  getSite(name: string) {
    return getSiteService(this.db, name)
  }

  updateSiteStatus(name: string, status: string) {
    return updateSiteStatus(this.db, name, status)
  }

  assignTenant(siteName: string, body: FleetModels["assignTenantBody"]) {
    return assignTenantService(this.db, siteName, body.tenantId)
  }

  // ---- Deployment Target lifecycle ----

  listDeploymentTargets(opts?: { kind?: string; status?: string; siteId?: string; runtime?: string }) {
    return listDeploymentTargetsService(this.db, opts)
  }

  createDeploymentTarget(input: {
    name: string; kind: string; siteId?: string; clusterId?: string;
    namespace?: string; createdBy?: string; trigger?: string;
    ttl?: string; tierPolicies?: Record<string, unknown>; labels?: Record<string, unknown>;
    runtime?: string; hostId?: string; vmId?: string;
  }) {
    return createDeploymentTargetService(this.db, {
      ...input,
      createdBy: input.createdBy ?? "system",
      trigger: input.trigger ?? "manual",
    })
  }

  getDeploymentTarget(id: string) {
    return getDeploymentTargetService(this.db, id)
  }

  updateDeploymentTargetStatus(id: string, status: string) {
    return updateDeploymentTargetStatusService(this.db, id, status)
  }

  destroyDeploymentTarget(id: string) {
    return destroyDeploymentTargetService(this.db, id)
  }

  // ---- Workload lifecycle ----

  listWorkloads(deploymentTargetId: string) {
    return listWorkloadsService(this.db, deploymentTargetId)
  }

  createWorkload(input: {
    deploymentTargetId: string; moduleVersionId: string; componentId: string;
    artifactId: string; desiredImage: string; replicas?: number;
    envOverrides?: Record<string, unknown>; resourceOverrides?: Record<string, unknown>
  }) {
    return createWorkloadService(this.db, input)
  }

  getWorkload(id: string) {
    return getWorkloadService(this.db, id)
  }

  updateWorkload(id: string, updates: Partial<{
    replicas: number; desiredImage: string; envOverrides: Record<string, unknown>;
    resourceOverrides: Record<string, unknown>; status: string;
    actualImage: string; driftDetected: boolean; lastReconciledAt: Date
  }>) {
    return updateWorkloadService(this.db, id, updates)
  }

  deleteWorkload(id: string) {
    return deleteWorkloadService(this.db, id)
  }

  // ---- Dependency Workload lifecycle ----

  listDependencyWorkloads(deploymentTargetId: string) {
    return listDependencyWorkloadsService(this.db, deploymentTargetId)
  }

  createDependencyWorkload(input: {
    deploymentTargetId: string; name: string; image: string; port: number;
    env?: Record<string, unknown>
  }) {
    return createDependencyWorkloadService(this.db, input)
  }

  updateDependencyWorkloadStatus(id: string, status: string) {
    return updateDependencyWorkloadStatusService(this.db, id, status)
  }

  // ---- Sandbox lifecycle ----

  listSandboxes(opts?: { createdBy?: string; trigger?: string; all?: boolean }) {
    return listSandboxesService(this.db, opts)
  }

  createSandbox(body: FleetModels["createSandboxBody"] & {
    createdBy?: string; clusterId?: string; ttl?: string; trigger?: string;
    labels?: Record<string, unknown>;
    dependencies?: Array<{ name: string; image: string; port: number; env?: Record<string, unknown> }>;
    publishPorts?: number[]; snapshotId?: string;
  }) {
    return createSandboxService(this.db, this.sandboxAdapter, {
      ...body,
      createdBy: body.createdBy ?? "system",
    })
  }

  destroySandbox(id: string) {
    return destroySandboxService(this.db, this.sandboxAdapter, id)
  }

  cleanupExpiredSandboxes() {
    return cleanupExpiredSandboxesService(this.db, this.sandboxAdapter)
  }

  // ---- Snapshot lifecycle ----

  createSnapshot(input: { sandboxId: string; createdBy: string; stop?: boolean }) {
    return createSnapshotService(this.db, this.sandboxAdapter, input)
  }

  listSnapshots(opts?: { createdBy?: string }) {
    return listSnapshotsService(this.db, opts)
  }

  getSnapshot(snapshotId: string) {
    return getSnapshotService(this.db, snapshotId)
  }

  deleteSnapshot(snapshotId: string) {
    return deleteSnapshotService(this.db, snapshotId)
  }

  // ---- Rollout lifecycle ----

  createRollout(input: { releaseId: string; deploymentTargetId: string }) {
    return createRolloutService(this.db, input)
  }

  getRollout(id: string) {
    return getRolloutService(this.db, id)
  }

  updateRolloutStatus(id: string, status: string) {
    return updateRolloutStatusService(this.db, id, status)
  }

  listRollouts(opts?: { releaseId?: string; deploymentTargetId?: string }) {
    return listRolloutsService(this.db, opts)
  }

  // ---- Workload Overrides ----

  createWorkloadOverride(input: {
    workloadId: string; field: string; previousValue: unknown;
    newValue: unknown; reason: string; createdBy: string
  }) {
    return createWorkloadOverrideService(this.db, input)
  }

  revertWorkloadOverride(overrideId: string, revertedBy: string) {
    return revertWorkloadOverrideService(this.db, overrideId, revertedBy)
  }

  listWorkloadOverrides(workloadId: string) {
    return listWorkloadOverridesService(this.db, workloadId)
  }

  // ---- Interventions ----

  createIntervention(input: {
    deploymentTargetId: string; workloadId?: string; action: string;
    principalId: string; reason: string; details?: Record<string, unknown>
  }) {
    return createInterventionService(this.db, input)
  }

  listInterventions(deploymentTargetId: string) {
    return listInterventionsService(this.db, deploymentTargetId)
  }

  // ---- Manifest & Check-in ----

  siteCheckin(siteName: string, input: {
    healthSnapshot: Record<string, unknown>
    lastAppliedManifestVersion: number
  }) {
    return siteCheckinService(this.db, siteName, input)
  }

  assignReleaseToSite(siteName: string, releaseVersion: string) {
    return assignReleaseToSiteService(this.db, siteName, releaseVersion)
  }

  getSiteManifest(siteName: string) {
    return getSiteManifestService(this.db, siteName)
  }

  // ---- Connection Audit ----

  createConnectionAuditEvent(input: {
    principalId: string
    deploymentTargetId: string
    connectedResources: Record<string, unknown>
    readonly: boolean
    reason?: string
  }) {
    return createConnectionAuditEventService(this.db, input)
  }

  endConnectionAuditEvent(eventId: string) {
    return endConnectionAuditEventService(this.db, eventId)
  }

  listConnectionAuditEvents(opts?: {
    deploymentTargetId?: string
    principalId?: string
  }) {
    return listConnectionAuditEventsService(this.db, opts)
  }

  // ---- Install Manifests ----

  listInstallManifests(opts?: { role?: string }) {
    return listInstallManifestsService(this.db, opts)
  }

  getInstallManifestBySite(siteId: string) {
    return getInstallManifestBySiteService(this.db, siteId)
  }

  upsertInstallManifest(siteId: string, manifest: InstallManifest) {
    return upsertInstallManifestService(this.db, siteId, manifest)
  }

  // ---- Release Bundles ----

  listReleaseBundles(opts?: { releaseId?: string; status?: string; role?: string }) {
    return listReleaseBundlesService(this.db, opts)
  }

  getReleaseBundleById(id: string) {
    return getReleaseBundleByIdService(this.db, id)
  }

  createReleaseBundle(input: {
    releaseId: string; role: string; arch?: string;
    dxVersion: string; k3sVersion: string; helmChartVersion: string;
    createdBy: string;
  }) {
    return createReleaseBundleService(this.db, input)
  }

  updateReleaseBundleStatus(id: string, updates: {
    status: string; imageCount?: number; sizeBytes?: number;
    checksumSha256?: string; storagePath?: string; completedAt?: Date;
  }) {
    return updateReleaseBundleStatusService(this.db, id, updates)
  }
}
