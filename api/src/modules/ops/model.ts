import { type UnwrapSchema, t } from "elysia"

export const OpsModel = {
  // Releases
  createReleaseBody: t.Object({ version: t.String() }),
  createReleaseBodyV2: t.Object({
    version: t.String(),
    modulePins: t.Optional(t.Array(t.Object({ moduleVersionId: t.String() }))),
  }),
  releaseVersionParams: t.Object({ version: t.String() }),
  promoteReleaseBody: t.Object({ target: t.Optional(t.String()) }),

  // Sites
  createSiteBody: t.Object({ name: t.String(), product: t.String() }),
  siteNameQuery: t.Object({ name: t.String() }),
  siteNameParams: t.Object({ name: t.String() }),
  assignTenantBody: t.Object({ tenantId: t.String() }),

  // System Deployments
  createSystemDeploymentBody: t.Object({
    name: t.String(),
    kind: t.String(),
    siteId: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    namespace: t.Optional(t.String()),
    trigger: t.String(),
    ttl: t.Optional(t.String()),
    tierPolicies: t.Optional(t.Record(t.String(), t.Unknown())),
    labels: t.Optional(t.Record(t.String(), t.Unknown())),
    runtime: t.Optional(t.String()),
    hostId: t.Optional(t.String()),
    vmId: t.Optional(t.String()),
  }),
  systemDeploymentIdParams: t.Object({ id: t.String() }),
  systemDeploymentQuery: t.Object({
    kind: t.Optional(t.String()),
    status: t.Optional(t.String()),
    siteId: t.Optional(t.String()),
    runtime: t.Optional(t.String()),
  }),

  // Workloads
  createWorkloadBody: t.Object({
    moduleVersionId: t.String(),
    componentId: t.String(),
    artifactId: t.String(),
    desiredImage: t.String(),
    replicas: t.Optional(t.Number()),
    envOverrides: t.Optional(t.Record(t.String(), t.Unknown())),
    resourceOverrides: t.Optional(t.Record(t.String(), t.Unknown())),
    desiredArtifactUri: t.Optional(t.String()),
  }),
  updateWorkloadBody: t.Object({
    replicas: t.Optional(t.Number()),
    desiredImage: t.Optional(t.String()),
    envOverrides: t.Optional(t.Record(t.String(), t.Unknown())),
    resourceOverrides: t.Optional(t.Record(t.String(), t.Unknown())),
    status: t.Optional(t.String()),
  }),
  workloadIdParams: t.Object({ id: t.String() }),
  scaleWorkloadBody: t.Object({ replicas: t.Number() }),

  // Rollouts
  createRolloutBody: t.Object({
    releaseId: t.String(),
    systemDeploymentId: t.String(),
  }),
  updateRolloutBody: t.Object({ status: t.String() }),
  rolloutIdParams: t.Object({ id: t.String() }),

  // Check-in
  checkinBody: t.Object({
    healthSnapshot: t.Record(t.String(), t.Unknown()),
    lastAppliedManifestVersion: t.Number(),
  }),
  assignReleaseBody: t.Object({ releaseVersion: t.String() }),

  // Sandboxes
  createSandboxBody: t.Object({
    name: t.Optional(t.String()),
    ttl: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    trigger: t.Optional(t.String()),
    labels: t.Optional(t.Record(t.String(), t.Unknown())),
    dependencies: t.Optional(
      t.Array(
        t.Object({
          name: t.String(),
          image: t.String(),
          port: t.Number(),
          env: t.Optional(t.Record(t.String(), t.Unknown())),
        })
      )
    ),
    publishPorts: t.Optional(t.Array(t.Number())),
    snapshotId: t.Optional(t.String()),
  }),
  sandboxIdParams: t.Object({ id: t.String() }),
  sandboxIdQuery: t.Object({ id: t.String() }),
  sandboxListQuery: t.Object({ all: t.Optional(t.String()) }),

  // Interventions
  createInterventionBody: t.Object({
    action: t.String(),
    reason: t.String(),
    workloadId: t.Optional(t.String()),
    details: t.Optional(t.Record(t.String(), t.Unknown())),
  }),

  // Snapshots
  snapshotIdParams: t.Object({ id: t.String() }),
  createSnapshotBody: t.Object({ stop: t.Optional(t.Boolean()) }),
  // Connection Audit Events
  createConnectionAuditBody: t.Object({
    principalId: t.String(),
    systemDeploymentId: t.String(),
    connectedResources: t.Record(t.String(), t.Unknown()),
    readonly: t.Boolean(),
    reason: t.Optional(t.String()),
  }),
  connectionAuditIdParams: t.Object({ id: t.String() }),
  connectionAuditQuery: t.Object({
    systemDeploymentId: t.Optional(t.String()),
    principalId: t.Optional(t.String()),
  }),
  // Install Manifests
  installManifestBody: t.Object({
    version: t.Number(),
    role: t.String(),
    installedAt: t.String(),
    dxVersion: t.String(),
    installMode: t.String(),
    k3sVersion: t.String(),
    helmChartVersion: t.String(),
    siteName: t.String(),
    domain: t.String(),
    enabledPlanes: t.Array(t.String()),
    nodes: t.Array(
      t.Object({
        name: t.String(),
        role: t.String(),
        joinedAt: t.String(),
        ip: t.String(),
      })
    ),
    upgrades: t.Array(
      t.Object({
        fromVersion: t.String(),
        toVersion: t.String(),
        upgradedAt: t.String(),
      })
    ),
  }),
  installManifestQuery: t.Object({
    role: t.Optional(t.String()),
  }),

  // Release Bundles
  createReleaseBundleBody: t.Object({
    releaseId: t.String(),
    role: t.Optional(t.String()),
    arch: t.Optional(t.String()),
    dxVersion: t.String(),
    k3sVersion: t.String(),
    helmChartVersion: t.String(),
  }),
  updateReleaseBundleBody: t.Object({
    status: t.String(),
    imageCount: t.Optional(t.Number()),
    sizeBytes: t.Optional(t.Number()),
    checksumSha256: t.Optional(t.String()),
    storagePath: t.Optional(t.String()),
  }),
  releaseBundleIdParams: t.Object({ id: t.String() }),
  releaseBundleQuery: t.Object({
    releaseId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    role: t.Optional(t.String()),
  }),
  // Workbenches
  registerWorkbenchBody: t.Object({
    workbenchId: t.String(),
    type: t.String(),
    hostname: t.String(),
    ips: t.Array(t.String()),
    os: t.String(),
    arch: t.String(),
    dxVersion: t.String(),
  }),
  workbenchPingBody: t.Object({
    command: t.String(),
    dxVersion: t.String(),
    timestamp: t.String(),
  }),
  workbenchIdParams: t.Object({ workbenchId: t.String() }),
  workbenchListQuery: t.Object({
    type: t.Optional(t.String()),
  }),
} as const

export type OpsModels = {
  [K in keyof typeof OpsModel]: UnwrapSchema<(typeof OpsModel)[K]>
}
