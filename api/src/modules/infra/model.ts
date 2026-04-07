import { t, type UnwrapSchema } from "elysia"

export const InfraModel = {
  idParams: t.Object({ id: t.String() }),

  // Provider
  createProviderBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    providerType: t.String(),
    url: t.Optional(t.String()),
    credentialsRef: t.Optional(t.String()),
    providerKind: t.Optional(t.String()),
  }),
  listProvidersQuery: t.Object({
    status: t.Optional(t.String()),
  }),

  // VM Cluster
  createVmClusterBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    providerId: t.String(),
    apiHost: t.String(),
    apiPort: t.Optional(t.Number()),
    tokenId: t.Optional(t.String()),
    tokenSecret: t.Optional(t.String()),
    sslFingerprint: t.Optional(t.String()),
  }),
  updateVmClusterBody: t.Object({
    name: t.Optional(t.String()),
    apiHost: t.Optional(t.String()),
    apiPort: t.Optional(t.Number()),
    tokenId: t.Optional(t.String()),
    tokenSecret: t.Optional(t.String()),
    sslFingerprint: t.Optional(t.String()),
  }),
  listVmClustersQuery: t.Object({
    providerId: t.Optional(t.String()),
  }),

  // Region
  createRegionBody: t.Object({
    name: t.String(),
    displayName: t.String(),
    slug: t.Optional(t.String()),
    country: t.Optional(t.String()),
    city: t.Optional(t.String()),
    timezone: t.Optional(t.String()),
    providerId: t.Optional(t.String()),
  }),
  listRegionsQuery: t.Object({
    providerId: t.Optional(t.String()),
  }),

  // Cluster
  createClusterBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    providerId: t.String(),
    kubeconfigRef: t.Optional(t.String()),
  }),
  listClustersQuery: t.Object({
    providerId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),

  // VM
  createVmBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    providerId: t.String(),
    cpu: t.Number(),
    memoryMb: t.Number(),
    diskGb: t.Number(),
    hostId: t.Optional(t.String()),
    datacenterId: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    vmClusterId: t.Optional(t.String()),
    externalVmid: t.Optional(t.Number()),
    vmType: t.Optional(t.String()),
    osType: t.Optional(t.String()),
    accessMethod: t.Optional(t.String()),
    accessUser: t.Optional(t.String()),
  }),
  listVmsQuery: t.Object({
    slug: t.Optional(t.String()),
    providerId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    hostId: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    datacenterId: t.Optional(t.String()),
    osType: t.Optional(t.String()),
  }),
  resizeVmBody: t.Object({
    cpu: t.Optional(t.Number()),
    memoryMb: t.Optional(t.Number()),
    diskGb: t.Optional(t.Number()),
  }),
  migrateVmBody: t.Object({
    targetHostId: t.String(),
  }),
  cloneVmBody: t.Object({
    sourceVmId: t.String(),
    name: t.String(),
    cpu: t.Optional(t.Number()),
    memoryMb: t.Optional(t.Number()),
    diskGb: t.Optional(t.Number()),
    full: t.Optional(t.Boolean()),
  }),
  createSnapshotBody: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
  }),
  snapshotNameParams: t.Object({
    id: t.String(),
    name: t.String(),
  }),

  // Host
  createHostBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    providerId: t.String(),
    hostname: t.Optional(t.String()),
    datacenterId: t.Optional(t.String()),
    ipAddress: t.Optional(t.String()),
    ipmiAddress: t.Optional(t.String()),
    cpuCores: t.Number(),
    memoryMb: t.Number(),
    diskGb: t.Number(),
    rackLocation: t.Optional(t.String()),
    osType: t.Optional(t.String()),
    accessMethod: t.Optional(t.String()),
  }),
  listHostsQuery: t.Object({
    slug: t.Optional(t.String()),
    providerId: t.Optional(t.String()),
    datacenterId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    osType: t.Optional(t.String()),
  }),

  // Kube Node
  createKubeNodeBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    clusterId: t.String(),
    vmId: t.Optional(t.String()),
    role: t.String(),
    ipAddress: t.String(),
  }),
  listKubeNodesQuery: t.Object({
    clusterId: t.String(),
  }),

  // Subnet
  createSubnetBody: t.Object({
    cidr: t.String(),
    gateway: t.Optional(t.String()),
    netmask: t.Optional(t.String()),
    vlanId: t.Optional(t.Number()),
    vlanName: t.Optional(t.String()),
    datacenterId: t.Optional(t.String()),
    subnetType: t.Optional(t.String()),
    description: t.Optional(t.String()),
    dnsServers: t.Optional(t.String()),
    dnsDomain: t.Optional(t.String()),
  }),
  listSubnetsQuery: t.Object({
    datacenterId: t.Optional(t.String()),
    subnetType: t.Optional(t.String()),
  }),

  // IP
  listIpsQuery: t.Object({
    subnetId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    assignedToType: t.Optional(t.String()),
  }),
  listAvailableIpsQuery: t.Object({
    subnetId: t.Optional(t.String()),
  }),
  lookupIpBody: t.Object({
    address: t.String(),
  }),
  registerIpBody: t.Object({
    address: t.String(),
    subnetId: t.Optional(t.String()),
  }),
  assignIpBody: t.Object({
    assignedToType: t.String(),
    assignedToId: t.String(),
    hostname: t.Optional(t.String()),
    purpose: t.Optional(t.String()),
  }),
  ipamStatsQuery: t.Object({
    subnetId: t.Optional(t.String()),
  }),

  // Atomic allocation
  allocateIpBody: t.Object({
    subnetId: t.String(),
    assignedToType: t.String(),
    assignedToId: t.String(),
    hostname: t.Optional(t.String()),
    purpose: t.Optional(t.String()),
    policy: t.Optional(t.Union([t.Literal("sequential"), t.Literal("random")])),
  }),

  // Conflict detection
  checkConflictsBody: t.Object({
    addresses: t.Optional(t.Array(t.String())),
    subnetId: t.Optional(t.String()),
    networkCheck: t.Optional(t.Boolean()),
    deviceType: t.Optional(t.String()),
    deviceHost: t.Optional(t.String()),
    devicePort: t.Optional(t.Number()),
    community: t.Optional(t.String()),
  }),

  // Import
  importIpsBody: t.Object({
    rows: t.Array(
      t.Object({
        address: t.String(),
        subnet_cidr: t.Optional(t.String()),
        hostname: t.Optional(t.String()),
        purpose: t.Optional(t.String()),
        status: t.Optional(t.String()),
        assigned_to_type: t.Optional(t.String()),
        assigned_to_id: t.Optional(t.String()),
      })
    ),
  }),

  // Export
  exportIpsQuery: t.Object({
    format: t.Optional(t.Union([t.Literal("csv"), t.Literal("json")])),
    subnetId: t.Optional(t.String()),
  }),

  // Import from device
  importFromDeviceBody: t.Object({
    subnetId: t.Optional(t.String()),
    dryRun: t.Optional(t.Boolean()),
    deviceType: t.Optional(t.String()),
    deviceHost: t.Optional(t.String()),
    devicePort: t.Optional(t.Number()),
    community: t.Optional(t.String()),
  }),

  // Subnet tree
  subnetTreeQuery: t.Object({
    rootId: t.Optional(t.String()),
  }),
} as const

export type InfraModels = {
  [K in keyof typeof InfraModel]: UnwrapSchema<(typeof InfraModel)[K]>
}
