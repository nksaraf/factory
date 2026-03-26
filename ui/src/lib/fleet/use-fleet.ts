/**
 * Dual-mode fleet data hooks — PowerSync (realtime) or REST API (polling).
 *
 * Each hook is a thin config passed to useDualListQuery / useDualOneQuery.
 * The helpers handle PowerSync vs REST switching, polling, and transforms.
 */
import {
  buildQueryString,
  buildWhere,
  parseJson,
  useDualListQuery,
  useDualOneQuery,
} from "./use-dual-query"
import type {
  DeploymentTarget,
  FleetSite,
  Intervention,
  Release,
  ReleaseBundle,
  Rollout,
  Sandbox,
  Workload,
} from "./types"

// ---------------------------------------------------------------------------
// Row transformers (PowerSync snake_case → domain camelCase)
// ---------------------------------------------------------------------------

const toDeploymentTarget = (r: Record<string, unknown>): DeploymentTarget => ({
  id: r.id as string,
  name: r.name as string,
  slug: r.slug as string,
  kind: r.kind as string,
  runtime: r.runtime as string,
  hostId: (r.host_id ?? r.hostId ?? null) as string | null,
  vmId: (r.vm_id ?? r.vmId ?? null) as string | null,
  siteId: (r.site_id ?? r.siteId ?? null) as string | null,
  clusterId: (r.cluster_id ?? r.clusterId ?? null) as string | null,
  namespace: (r.namespace as string) ?? null,
  createdBy: (r.created_by ?? r.createdBy ?? "") as string,
  trigger: (r.trigger as string) ?? "",
  ttl: (r.ttl as string) ?? null,
  expiresAt: (r.expires_at ?? r.expiresAt ?? null) as string | null,
  tierPolicies: parseJson(r.tier_policies ?? r.tierPolicies),
  status: r.status as string,
  labels: parseJson(r.labels),
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
  destroyedAt: (r.destroyed_at ?? r.destroyedAt ?? null) as string | null,
})

// REST returns deploymentTargetId as the PK name
const apiToDeploymentTarget = (r: Record<string, unknown>): DeploymentTarget =>
  toDeploymentTarget({ ...r, id: r.deploymentTargetId ?? r.id })

const toWorkload = (r: Record<string, unknown>): Workload => ({
  id: r.id as string,
  deploymentTargetId: (r.deployment_target_id ?? r.deploymentTargetId) as string,
  moduleVersionId: (r.module_version_id ?? r.moduleVersionId) as string,
  componentId: (r.component_id ?? r.componentId) as string,
  artifactId: (r.artifact_id ?? r.artifactId) as string,
  replicas: (r.replicas as number) ?? 1,
  envOverrides: parseJson(r.env_overrides ?? r.envOverrides),
  resourceOverrides: parseJson(r.resource_overrides ?? r.resourceOverrides),
  status: r.status as string,
  desiredImage: (r.desired_image ?? r.desiredImage) as string,
  desiredArtifactUri: (r.desired_artifact_uri ?? r.desiredArtifactUri ?? null) as string | null,
  actualImage: (r.actual_image ?? r.actualImage ?? null) as string | null,
  driftDetected: r.drift_detected === 1 || r.driftDetected === true || r.drift_detected === true,
  lastReconciledAt: (r.last_reconciled_at ?? r.lastReconciledAt ?? null) as string | null,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
  updatedAt: (r.updated_at ?? r.updatedAt ?? "") as string,
})

const apiToWorkload = (r: Record<string, unknown>): Workload =>
  toWorkload({ ...r, id: r.workloadId ?? r.id })

const toSandbox = (r: Record<string, unknown>): Sandbox => ({
  id: r.id as string,
  deploymentTargetId: (r.deployment_target_id ?? r.deploymentTargetId) as string,
  name: r.name as string,
  slug: r.slug as string,
  runtimeType: (r.runtime_type ?? r.runtimeType) as string,
  vmId: (r.vm_id ?? r.vmId ?? null) as string | null,
  podName: (r.pod_name ?? r.podName ?? null) as string | null,
  ownerId: (r.owner_id ?? r.ownerId) as string,
  ownerType: (r.owner_type ?? r.ownerType) as string,
  statusMessage: (r.status_message ?? r.statusMessage ?? null) as string | null,
  cpu: (r.cpu as string) ?? null,
  memory: (r.memory as string) ?? null,
  storageGb: (r.storage_gb ?? r.storageGb ?? 10) as number,
  sshHost: (r.ssh_host ?? r.sshHost ?? null) as string | null,
  sshPort: (r.ssh_port ?? r.sshPort ?? null) as number | null,
  webTerminalUrl: (r.web_terminal_url ?? r.webTerminalUrl ?? null) as string | null,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
  updatedAt: (r.updated_at ?? r.updatedAt ?? "") as string,
})

const apiToSandbox = (r: Record<string, unknown>): Sandbox =>
  toSandbox({ ...r, id: r.sandboxId ?? r.id })

const toRelease = (r: Record<string, unknown>): Release => ({
  id: r.id as string,
  version: r.version as string,
  status: r.status as string,
  createdBy: (r.created_by ?? r.createdBy) as string,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
})

const apiToRelease = (r: Record<string, unknown>): Release =>
  toRelease({ ...r, id: r.releaseId ?? r.id })

const toRollout = (r: Record<string, unknown>): Rollout => ({
  id: r.id as string,
  releaseId: (r.release_id ?? r.releaseId) as string,
  deploymentTargetId: (r.deployment_target_id ?? r.deploymentTargetId) as string,
  status: r.status as string,
  startedAt: (r.started_at ?? r.startedAt) as string,
  completedAt: (r.completed_at ?? r.completedAt ?? null) as string | null,
})

const apiToRollout = (r: Record<string, unknown>): Rollout =>
  toRollout({ ...r, id: r.rolloutId ?? r.id })

const toSite = (r: Record<string, unknown>): FleetSite => ({
  id: r.id as string,
  name: r.name as string,
  slug: r.slug as string,
  product: r.product as string,
  clusterId: (r.cluster_id ?? r.clusterId) as string,
  status: r.status as string,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
  lastCheckinAt: (r.last_checkin_at ?? r.lastCheckinAt ?? null) as string | null,
  currentManifestVersion: (r.current_manifest_version ?? r.currentManifestVersion ?? null) as number | null,
})

const apiToSite = (r: Record<string, unknown>): FleetSite =>
  toSite({ ...r, id: r.siteId ?? r.id })

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useDeploymentTargets(opts?: { kind?: string; status?: string }) {
  const where = buildWhere(opts)
  return useDualListQuery<DeploymentTarget>({
    queryKey: ["fleet", "deployment-targets", opts],
    sql: `SELECT * FROM deployment_target${where.sql}`,
    sqlParams: where.params,
    fetchPath: `/deployment-targets${buildQueryString(opts ?? {})}`,
    fromRow: toDeploymentTarget,
    fromApi: apiToDeploymentTarget,
  })
}

export function useDeploymentTarget(id: string | undefined) {
  return useDualOneQuery<DeploymentTarget>({
    queryKey: ["fleet", "deployment-target", id],
    sql: "SELECT * FROM deployment_target WHERE id = ?",
    sqlParams: id ? [id] : [],
    fetchPath: `/deployment-targets/${id}`,
    fromRow: toDeploymentTarget,
    fromApi: apiToDeploymentTarget,
    enabled: !!id,
    single: true,
  })
}

export function useWorkloads(deploymentTargetId: string | undefined) {
  return useDualListQuery<Workload>({
    queryKey: ["fleet", "workloads", deploymentTargetId],
    sql: "SELECT * FROM workload WHERE deployment_target_id = ?",
    sqlParams: deploymentTargetId ? [deploymentTargetId] : [],
    fetchPath: `/deployment-targets/${deploymentTargetId}/workloads`,
    fromRow: toWorkload,
    fromApi: apiToWorkload,
    enabled: !!deploymentTargetId,
  })
}

export function useSandboxes() {
  return useDualListQuery<Sandbox>({
    queryKey: ["fleet", "sandboxes"],
    sql: "SELECT * FROM sandbox",
    fetchPath: "/sandboxes",
    fromRow: toSandbox,
    fromApi: apiToSandbox,
  })
}

export function useReleases() {
  return useDualListQuery<Release>({
    queryKey: ["fleet", "releases"],
    sql: "SELECT * FROM release ORDER BY created_at DESC",
    fetchPath: "/releases",
    fromRow: toRelease,
    fromApi: apiToRelease,
  })
}

export function useRollouts() {
  return useDualListQuery<Rollout>({
    queryKey: ["fleet", "rollouts"],
    sql: "SELECT * FROM rollout ORDER BY started_at DESC",
    fetchPath: "/rollouts",
    fromRow: toRollout,
    fromApi: apiToRollout,
  })
}

export function useFleetSites() {
  return useDualListQuery<FleetSite>({
    queryKey: ["fleet", "sites"],
    sql: "SELECT * FROM site",
    fetchPath: "/sites",
    fromRow: toSite,
    fromApi: apiToSite,
  })
}

export function useFleetSite(slug: string | undefined) {
  return useDualOneQuery<FleetSite>({
    queryKey: ["fleet", "site", slug],
    sql: "SELECT * FROM site WHERE slug = ?",
    sqlParams: slug ? [slug] : [],
    fetchPath: `/sites/${slug}`,
    fromRow: toSite,
    fromApi: apiToSite,
    enabled: !!slug,
    single: true,
  })
}

// --- Interventions (REST-only, no PowerSync table) ---

const toIntervention = (r: Record<string, unknown>): Intervention => ({
  id: (r.interventionId ?? r.id) as string,
  deploymentTargetId: (r.deployment_target_id ?? r.deploymentTargetId) as string,
  workloadId: (r.workload_id ?? r.workloadId ?? null) as string | null,
  action: r.action as string,
  principalId: (r.principal_id ?? r.principalId) as string,
  reason: r.reason as string,
  details: parseJson(r.details),
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
})

export function useInterventions(deploymentTargetId?: string) {
  return useDualListQuery<Intervention>({
    queryKey: ["fleet", "interventions", deploymentTargetId],
    sql: deploymentTargetId
      ? "SELECT * FROM intervention WHERE deployment_target_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM intervention ORDER BY created_at DESC",
    sqlParams: deploymentTargetId ? [deploymentTargetId] : [],
    fetchPath: deploymentTargetId
      ? `/deployment-targets/${deploymentTargetId}/interventions`
      : "/deployment-targets/all/interventions",
    fromRow: toIntervention,
    fromApi: toIntervention,
    enabled: true,
  })
}

// --- Release Bundles (REST-only) ---

const toReleaseBundle = (r: Record<string, unknown>): ReleaseBundle => ({
  id: (r.releaseBundleId ?? r.id) as string,
  releaseId: (r.release_id ?? r.releaseId) as string,
  role: r.role as string,
  arch: r.arch as string,
  dxVersion: (r.dx_version ?? r.dxVersion) as string,
  k3sVersion: (r.k3s_version ?? r.k3sVersion) as string,
  helmChartVersion: (r.helm_chart_version ?? r.helmChartVersion) as string,
  imageCount: (r.image_count ?? r.imageCount ?? 0) as number,
  sizeBytes: (r.size_bytes ?? r.sizeBytes ?? null) as string | null,
  checksumSha256: (r.checksum_sha256 ?? r.checksumSha256 ?? null) as string | null,
  storagePath: (r.storage_path ?? r.storagePath ?? null) as string | null,
  status: r.status as string,
  createdBy: (r.created_by ?? r.createdBy) as string,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
  completedAt: (r.completed_at ?? r.completedAt ?? null) as string | null,
})

export function useReleaseBundles(opts?: { releaseId?: string; status?: string }) {
  const qs = buildQueryString(opts ?? {})
  return useDualListQuery<ReleaseBundle>({
    queryKey: ["fleet", "bundles", opts],
    sql: "SELECT * FROM release_bundle ORDER BY created_at DESC",
    fetchPath: `/bundles${qs}`,
    fromRow: toReleaseBundle,
    fromApi: toReleaseBundle,
  })
}
