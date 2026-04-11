/**
 * Ops plane domain types — shared between PowerSync and REST API paths.
 *
 * These are the "domain" types consumed by UI components. Both the
 * PowerSync queries and the REST API responses are normalized to these types.
 */

export interface DeploymentTarget {
  id: string
  name: string
  slug: string
  kind: string
  realm: string
  hostId: string | null
  vmId: string | null
  siteId: string | null
  clusterId: string | null
  namespace: string | null
  createdBy: string
  trigger: string
  ttl: string | null
  expiresAt: string | null
  tierPolicies: Record<string, unknown>
  status: string
  labels: Record<string, unknown>
  createdAt: string
  destroyedAt: string | null
}

export interface Workload {
  id: string
  deploymentTargetId: string
  moduleVersionId: string
  componentId: string
  artifactId: string
  replicas: number
  envOverrides: Record<string, unknown>
  resourceOverrides: Record<string, unknown>
  status: string
  desiredImage: string
  desiredArtifactUri: string | null
  actualImage: string | null
  driftDetected: boolean
  lastReconciledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Sandbox {
  id: string
  deploymentTargetId: string
  name: string
  slug: string
  realmType: string
  vmId: string | null
  podName: string | null
  ownerId: string
  ownerType: string
  statusMessage: string | null
  cpu: string | null
  memory: string | null
  storageGb: number
  sshHost: string | null
  sshPort: number | null
  webTerminalUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface Release {
  id: string
  version: string
  status: string
  createdBy: string
  createdAt: string
}

export interface Rollout {
  id: string
  releaseId: string
  deploymentTargetId: string
  status: string
  startedAt: string
  completedAt: string | null
}

export interface OpsSite {
  id: string
  name: string
  slug: string
  product: string
  clusterId: string
  status: string
  createdAt: string
  lastCheckinAt: string | null
  currentManifestVersion: number | null
}

export interface Intervention {
  id: string
  deploymentTargetId: string
  workloadId: string | null
  action: string
  principalId: string
  reason: string
  details: Record<string, unknown>
  createdAt: string
}

export interface ReleaseBundle {
  id: string
  releaseId: string
  role: string
  arch: string
  dxVersion: string
  k3sVersion: string
  helmChartVersion: string
  imageCount: number
  sizeBytes: string | null
  checksumSha256: string | null
  storagePath: string | null
  status: string
  createdBy: string
  createdAt: string
  completedAt: string | null
}
