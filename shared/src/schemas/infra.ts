/**
 * Zod schemas for the `infra` schema — "Where Things Run"
 * Single source of truth. TS types derived via z.infer<>.
 *
 * DESIGN: All entity type/kind columns are plain `text` in Postgres.
 * Validation happens here in TypeScript via Zod enums.
 * Adding a new type = add it to the enum here (code only, zero migrations).
 */
import { z } from "zod"

import { ReconciliationSchema } from "./common"

// ── Estate ───────────────────────────────────────────────
// Ownership hierarchy: accounts, regions, datacenters, network topology.

export const EstateTypeSchema = z.enum([
  "cloud-account",
  "region",
  "datacenter",
  "vpc",
  "subnet",
  "rack",
  "dns-zone",
  "wan",
  "cdn",
])
export type EstateType = z.infer<typeof EstateTypeSchema>

export const EstateSpecSchema = z.object({
  providerKind: z.string().optional(), // open-ended: aws, gcp, azure, proxmox, hetzner, atlassian, anthropic, stripe, etc.
  credentialsRef: z.string().optional(),
  accessMechanism: z.enum(["api", "ssh", "console"]).optional(),
  endpoint: z.string().optional(),
  location: z.string().optional(),
  lifecycle: z.enum(["active", "maintenance", "decommissioned"]).optional(),
  metadata: z.record(z.string()).optional(),
  // Proxmox / hypervisor-specific fields
  apiHost: z.string().optional(),
  apiPort: z.number().int().optional(),
  tokenId: z.string().optional(),
  tokenSecret: z.string().optional(), // encrypted at rest
  sslFingerprint: z.string().optional(),
  // Sync tracking
  syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  lastSyncAt: z.coerce.date().optional(),
  syncError: z.string().optional(),
  // Subnet-specific
  cidr: z.string().optional(),
  gatewayIp: z.string().optional(),
  // DNS zone-specific
  dnsProvider: z.string().optional(),
  registrar: z.string().optional(),
  zone: z.string().optional(),
  // Gateway-specific
  managementUrl: z.string().optional(),
  model: z.string().optional(),
  publicIpCount: z.number().int().optional(),
})
export type EstateSpec = z.infer<typeof EstateSpecSchema>

export const EstateSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: EstateTypeSchema,
    parentEstateId: z.string().nullable(),
    spec: EstateSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Estate = z.infer<typeof EstateSchema>

// ── Host ────────────────────────────────────────────────────

export const HostTypeSchema = z.enum([
  "bare-metal",
  "vm",
  "lxc",
  "cloud-instance",
  "network-appliance",
])
export type HostType = z.infer<typeof HostTypeSchema>

export const OsSchema = z.enum(["linux", "windows", "macos"])
export type Os = z.infer<typeof OsSchema>

export const ArchSchema = z.enum(["amd64", "arm64"])
export type Arch = z.infer<typeof ArchSchema>

export const HostAccessMethodSchema = z.enum(["ssh", "winrm", "rdp"])
export type HostAccessMethod = z.infer<typeof HostAccessMethodSchema>

export const HostSpecSchema = z.object({
  hostname: z.string(),
  os: OsSchema.default("linux"),
  arch: ArchSchema.default("amd64"),
  cpu: z.number().int().optional(),
  memoryMb: z.number().int().optional(),
  diskGb: z.number().int().optional(),
  accessMethod: HostAccessMethodSchema.default("ssh"),
  accessUser: z.string().default("root"),
  sshPort: z.number().int().min(1).max(65535).default(22),
  ipAddress: z.string().optional(),
  externalId: z.string().optional(), // e.g., Proxmox VMID, AWS instance ID
  role: z.string().optional(), // e.g., "k8s-server", "k8s-agent", "general"
  lifecycle: z
    .enum(["active", "maintenance", "offline", "decommissioned"])
    .default("active"),
  jumpHost: z.string().optional(),
  jumpUser: z.string().optional(),
  jumpPort: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().optional(),
  // Network-appliance-specific
  model: z.string().optional(),
  managementUrl: z.string().optional(),
  // dx workbench registration (absorbed from ops.workbench)
  dxVersion: z.string().optional(),
  lastPingAt: z.string().optional(),
  lastCommand: z.string().optional(),
  principalId: z.string().optional(),
  ips: z.array(z.string()).optional(),
})
export type HostSpec = z.infer<typeof HostSpecSchema>

export const HostSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: HostTypeSchema,
    estateId: z.string().nullable(),
    spec: HostSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Host = z.infer<typeof HostSchema>

// ── Realm ──────────────────────────────────────────────────
// Active governance — bounded domain of authority where things spawn and are controlled.

export const RealmTypeSchema = z.enum([
  // compute
  "k8s-cluster",
  "k8s-namespace",
  "docker-engine",
  "compose-project",
  "systemd",
  "process",
  "proxmox",
  "kvm",
  // network
  "reverse-proxy",
  "firewall",
  "router",
  "load-balancer",
  "vpn-gateway",
  "service-mesh",
  // storage
  "ceph",
  "zfs-pool",
  "nfs-server",
  "minio",
  "glusterfs",
  "lvm",
  // ai
  "ollama",
  "vllm",
  "triton-server",
  "tgi",
  // build
  "docker-buildkit",
  "nix-daemon",
  "bazel-remote",
  // scheduling
  "temporal-server",
  "airflow-scheduler",
  "inngest",
  "celery-worker",
  // legacy compat
  "iis",
  "windows-service",
])
export type RealmType = z.infer<typeof RealmTypeSchema>

export const RealmCategorySchema = z.enum([
  "compute",
  "network",
  "storage",
  "ai",
  "build",
  "scheduling",
])
export type RealmCategory = z.infer<typeof RealmCategorySchema>

export const RealmSpecSchema = z.object({
  category: RealmCategorySchema.optional(),
  endpoint: z.string().optional(),
  kubeconfigRef: z.string().optional(),
  version: z.string().optional(),
  status: z
    .enum(["provisioning", "ready", "degraded", "destroying"])
    .default("provisioning"),
  isDefault: z.boolean().optional(),
  nodeCount: z.number().int().optional(),
  capacity: z
    .object({
      cpu: z.number().optional(),
      memoryMb: z.number().optional(),
      pods: z.number().optional(),
    })
    .optional(),
})
export type RealmSpec = z.infer<typeof RealmSpecSchema>

// ── Reverse Proxy Realm Spec ──────────────────────────────

export const ProxyEntrypointSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https", "tcp", "udp"]).default("http"),
})
export type ProxyEntrypoint = z.infer<typeof ProxyEntrypointSchema>

export const ReverseProxyRealmSpecSchema = z.object({
  engine: z.enum(["traefik", "caddy", "nginx", "factory-gateway"]),
  entrypoints: z.array(ProxyEntrypointSchema).default([]),
  configRef: z.string().optional(),
  dynamicConfigDir: z.string().optional(),
  dashboardUrl: z.string().optional(),
  certResolvers: z.array(z.string()).default([]),
})
export type ReverseProxyRealmSpec = z.infer<typeof ReverseProxyRealmSpecSchema>

export const RealmSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: RealmTypeSchema,
    parentRealmId: z.string().nullable(),
    estateId: z.string().nullable(),
    workbenchId: z.string().nullable(),
    spec: RealmSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Realm = z.infer<typeof RealmSchema>

// ── Realm-Host join ────────────────────────────────────────

export const RealmHostRoleSchema = z.enum(["single", "control-plane", "worker"])
export type RealmHostRole = z.infer<typeof RealmHostRoleSchema>

// ── Service ────────────────────────────────────────────────
// Anything consumed via protocol/API: managed infra, SaaS, AI/ML, internal services.

export const ServiceTypeSchema = z.enum([
  "database",
  "cache",
  "object-store",
  "queue",
  "search",
  "cdn",
  "managed-k8s",
  "compute-platform",
  "llm",
  "auth-provider",
  "ci-cd",
  "source-control",
  "issue-tracker",
  "messaging",
  "payment",
  "monitoring",
  "email",
  "dns-provider",
  "analytics",
])
export type ServiceType = z.infer<typeof ServiceTypeSchema>

export const ServiceSpecSchema = z.object({
  endpoint: z.string().optional(),
  protocol: z.string().optional(),
  provider: z.string().optional(),
  version: z.string().optional(),
  connectionString: z.string().optional(),
  arnRef: z.string().optional(),
  apiKeyRef: z.string().optional(),
  billing: z
    .object({
      plan: z.string().optional(),
      cost: z.number().optional(),
      currency: z.string().optional(),
      renewal: z.string().optional(),
    })
    .optional(),
  sla: z
    .object({
      uptime: z.number().optional(),
      latencyMs: z.number().optional(),
    })
    .optional(),
  compliance: z
    .object({
      certifications: z.array(z.string()).optional(),
      dataResidency: z.string().optional(),
    })
    .optional(),
})
export type ServiceSpec = z.infer<typeof ServiceSpecSchema>

export const ServiceSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: ServiceTypeSchema,
    estateId: z.string().nullable(),
    realmId: z.string().nullable(),
    systemDeploymentId: z.string().nullable(),
    spec: ServiceSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Service = z.infer<typeof ServiceSchema>

// ── Route ───────────────────────────────────────────────────

export const RouteTypeSchema = z.enum([
  "ingress",
  "workspace",
  "preview",
  "tunnel",
  "custom-domain",
])
export type RouteType = z.infer<typeof RouteTypeSchema>

export const RouteTargetSchema = z.object({
  tenantSlug: z.string(),
  systemDeploymentSlug: z.string(),
  port: z.number().int(),
  weight: z.number().min(0).max(100).default(100),
  geo: z.array(z.string()).optional(), // e.g., ["Asia", "India"]
})
export type RouteTarget = z.infer<typeof RouteTargetSchema>

export const RouteSpecSchema = z
  .object({
    // Flat target fields — used by reconciler-created routes (workspace, preview, tunnel)
    targetService: z.string().optional(),
    targetPort: z.number().int().optional(),
    pathPrefix: z.string().optional(),
    // Multi-target — used by user-created ingress routes with weighted routing
    targets: z.array(RouteTargetSchema).optional(),
    protocol: z.enum(["http", "https", "tcp"]).default("http"),
    status: z
      .enum(["pending", "active", "error", "expired"])
      .default("pending"),
    createdBy: z.enum(["reconciler", "user", "api"]).default("api"),
    expiresAt: z.string().optional(),
    siteId: z.string().optional(),
    systemDeploymentId: z.string().optional(),
    tlsMode: z.string().optional(),
    tlsCertRef: z.string().optional(),
    priority: z.number().int().optional(),
    middlewares: z.array(z.unknown()).default([]),
  })
  .passthrough()
export type RouteSpec = z.infer<typeof RouteSpecSchema>

export const RouteSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: RouteTypeSchema,
    domain: z.string(),
    realmId: z.string().nullable(),
    spec: RouteSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Route = z.infer<typeof RouteSchema>

// ── Route Status (resolved state in reconciliation status col) ──

export const ResolvedTargetSchema = z.object({
  systemDeploymentSlug: z.string(),
  componentSlug: z.string(),
  address: z.string(),
  port: z.number().int(),
  weight: z.number().min(0).max(100),
  realmType: z.string(),
  geo: z.array(z.string()).optional(),
})
export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>

export const RouteStatusSchema = z.object({
  resolvedTargets: z.array(ResolvedTargetSchema).default([]),
  resolvedAt: z.coerce.date().optional(),
  resolutionError: z.string().optional(),
  phase: z.enum(["pending", "resolved", "error", "stale"]).default("pending"),
})
export type RouteStatus = z.infer<typeof RouteStatusSchema>

// ── DNS Domain ──────────────────────────────────────────────

export const DnsDomainTypeSchema = z.enum([
  "primary",
  "alias",
  "custom",
  "wildcard",
])
export type DnsDomainType = z.infer<typeof DnsDomainTypeSchema>

export const DnsDomainSpecSchema = z.object({
  registrar: z.string().optional(),
  verified: z.boolean().default(false),
  dnsProvider: z.string().optional(),
  txtRecordValue: z.string().optional(),
  verifiedAt: z.coerce.date().optional(),
})
export type DnsDomainSpec = z.infer<typeof DnsDomainSpecSchema>

export const DnsDomainSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: DnsDomainTypeSchema,
  fqdn: z.string(),
  siteId: z.string().nullable(),
  spec: DnsDomainSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type DnsDomain = z.infer<typeof DnsDomainSchema>

// ── Tunnel ──────────────────────────────────────────────────

export const TunnelTypeSchema = z.enum(["http", "tcp"])
export type TunnelType = z.infer<typeof TunnelTypeSchema>

export const TunnelSpecSchema = z.object({
  localPort: z.number().int(),
  remotePort: z.number().int(),
  connectedAt: z.coerce.date().optional(),
})
export type TunnelSpec = z.infer<typeof TunnelSpecSchema>

export const TunnelSchema = z
  .object({
    id: z.string(),
    type: TunnelTypeSchema,
    routeId: z.string(),
    principalId: z.string(),
    subdomain: z.string(),
    phase: z
      .enum(["connecting", "connected", "disconnected", "error"])
      .default("connecting"),
    spec: TunnelSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type Tunnel = z.infer<typeof TunnelSchema>

// ── IP Address ──────────────────────────────────────────────

export const IpAddressStatusSchema = z.enum([
  "available",
  "assigned",
  "reserved",
  "dhcp",
])
export type IpAddressStatus = z.infer<typeof IpAddressStatusSchema>

export const IpAddressSpecSchema = z.object({
  version: z.enum(["v4", "v6"]).default("v4"),
  status: IpAddressStatusSchema.default("available"),
  assignedToType: z.string().optional(), // e.g., "host", "realm", "service"
  assignedToId: z.string().optional(),
  gateway: z.string().optional(),
  cidr: z.number().int().optional(),
  scope: z
    .enum(["public", "private", "management", "vpn", "virtual", "loopback"])
    .optional(),
  purpose: z.string().optional(), // freeform: "web", "ssh", "management", "api"
  hostname: z.string().optional(), // reverse DNS / FQDN
  interface: z.string().optional(), // "eth0", "en0", "wan1", "lan2"
  primary: z.boolean().optional(), // preferred IP for this entity
})
export type IpAddressSpec = z.infer<typeof IpAddressSpecSchema>

export const IpAddressSchema = z.object({
  id: z.string(),
  address: z.string(),
  subnetId: z.string().nullable(),
  spec: IpAddressSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type IpAddress = z.infer<typeof IpAddressSchema>

// ── Secret ──────────────────────────────────────────────────

export const SecretSpecSchema = z.object({
  name: z.string(),
  ownerType: z.enum(["org", "team", "principal", "system"]),
  ownerId: z.string(),
  externalRef: z.string().optional(), // vault path, AWS secret ARN, etc.
  rotationPolicy: z.enum(["manual", "30d", "90d", "365d"]).default("manual"),
  lastRotatedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  description: z.string().optional(),
})
export type SecretSpec = z.infer<typeof SecretSpecSchema>

export const SecretSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  spec: SecretSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Secret = z.infer<typeof SecretSchema>

// ── Network Link ─────────────────────────────────────────

export const NetworkLinkTypeSchema = z.enum([
  "proxy",
  "direct",
  "tunnel",
  "nat",
  "firewall",
  "mesh",
  "peering",
  "dns-resolution",
  "port-forward",
  "host-local",
  "container-bridge",
  "socket",
  "cdn-forward",
])
export type NetworkLinkType = z.infer<typeof NetworkLinkTypeSchema>

export const NetworkLinkEndpointKindSchema = z.enum([
  "estate",
  "host",
  "realm",
  "service",
  "workbench",
  "dns-domain",
  "ip-address",
  "route",
  "component-deployment",
  "system-deployment",
])
export type NetworkLinkEndpointKind = z.infer<
  typeof NetworkLinkEndpointKindSchema
>

export const NetworkLinkSpecSchema = z.object({
  // Protocol & Ports
  ingressPort: z.number().int().min(1).max(65535).optional(),
  egressPort: z.number().int().min(1).max(65535).optional(),
  ingressProtocol: z.enum(["http", "https", "tcp", "udp", "grpc"]).optional(),
  egressProtocol: z.enum(["http", "https", "tcp", "udp", "grpc"]).optional(),

  // TLS
  tls: z
    .object({
      termination: z.enum(["edge", "passthrough", "reencrypt"]).optional(),
      certRef: z.string().optional(),
      certResolver: z.string().optional(),
    })
    .optional(),

  // Match criteria (what traffic flows through this link)
  match: z
    .object({
      hosts: z.array(z.string()).default([]),
      pathPrefixes: z.array(z.string()).default([]),
      headers: z.record(z.string()).default({}),
      sni: z.array(z.string()).default([]),
    })
    .optional(),

  // Load balancing
  loadBalancing: z
    .object({
      strategy: z
        .enum(["round-robin", "least-connections", "ip-hash", "random"])
        .default("round-robin"),
      weight: z.number().min(0).max(100).default(100),
      sticky: z.boolean().default(false),
    })
    .optional(),

  // Health check
  healthCheck: z
    .object({
      path: z.string().default("/health"),
      intervalSeconds: z.number().int().default(10),
      timeoutSeconds: z.number().int().default(5),
      failureThreshold: z.number().int().default(3),
    })
    .optional(),

  // Control
  description: z.string().optional(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  middlewares: z
    .array(
      z.object({
        name: z.string(),
        config: z.record(z.unknown()).default({}),
      })
    )
    .default([]),
})
export type NetworkLinkSpec = z.infer<typeof NetworkLinkSpecSchema>

export const NetworkLinkSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: NetworkLinkTypeSchema,
    sourceKind: NetworkLinkEndpointKindSchema,
    sourceId: z.string(),
    targetKind: NetworkLinkEndpointKindSchema,
    targetId: z.string(),
    spec: NetworkLinkSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(ReconciliationSchema)
export type NetworkLink = z.infer<typeof NetworkLinkSchema>

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateEstateSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: EstateTypeSchema,
  parentEstateId: z.string().optional(),
  spec: EstateSpecSchema.default({}),
})
export const UpdateEstateSchema = CreateEstateSchema.partial()

export const CreateHostSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: HostTypeSchema,
  estateId: z.string().optional(),
  spec: HostSpecSchema,
})
export const UpdateHostSchema = CreateHostSchema.partial().extend({
  spec: HostSpecSchema.partial().optional(),
})

export const CreateRealmSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: RealmTypeSchema,
  parentRealmId: z.string().optional(),
  estateId: z.string().optional(),
  workbenchId: z.string().optional(),
  spec: RealmSpecSchema.default({}),
})
export const UpdateRealmSchema = CreateRealmSchema.partial()

export const CreateServiceSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: ServiceTypeSchema,
  estateId: z.string().optional(),
  realmId: z.string().optional(),
  systemDeploymentId: z.string().optional(),
  spec: ServiceSpecSchema.default({}),
})
export const UpdateServiceSchema = CreateServiceSchema.partial()

export const CreateRouteSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: RouteTypeSchema,
  domain: z.string().min(1),
  realmId: z.string().optional(),
  spec: RouteSpecSchema,
})
export const UpdateRouteSchema = CreateRouteSchema.partial()

export const CreateDnsDomainSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: DnsDomainTypeSchema,
  fqdn: z.string().min(1),
  siteId: z.string().optional(),
  spec: DnsDomainSpecSchema,
})
export const UpdateDnsDomainSchema = CreateDnsDomainSchema.partial()

export const CreateTunnelSchema = z.object({
  type: TunnelTypeSchema,
  routeId: z.string().min(1),
  principalId: z.string().min(1),
  subdomain: z.string().min(1),
  spec: TunnelSpecSchema,
})
export const UpdateTunnelSchema = CreateTunnelSchema.partial()

export const CreateIpAddressSchema = z.object({
  address: z.string().min(1),
  subnetId: z.string().optional(),
  spec: IpAddressSpecSchema.default({}),
})
export const UpdateIpAddressSchema = CreateIpAddressSchema.partial()

export const CreateSecretSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  spec: SecretSpecSchema,
})
export const UpdateSecretSchema = CreateSecretSchema.partial()

export const CreateNetworkLinkSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: NetworkLinkTypeSchema,
  sourceKind: NetworkLinkEndpointKindSchema,
  sourceId: z.string().min(1),
  targetKind: NetworkLinkEndpointKindSchema,
  targetId: z.string().min(1),
  spec: NetworkLinkSpecSchema.default({}),
})
export const UpdateNetworkLinkSchema = CreateNetworkLinkSchema.partial()

// ── Host Scan Result (wire format from CLI → API) ────────

export const HostScanPortSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["tcp", "udp"]),
  address: z.string().default("0.0.0.0"),
  process: z.string().optional(),
  pid: z.number().int().optional(),
  state: z.string().optional(),
})
export type HostScanPort = z.infer<typeof HostScanPortSchema>

export const HostScanServiceSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  realmType: z.enum(["docker", "systemd", "iis", "windows-service", "process"]),
  status: z.string(),
  ports: z.array(z.number().int()).default([]),
  image: z.string().optional(),
  command: z.string().optional(),
  pid: z.number().int().optional(),
  composeProject: z.string().optional(),
  metadata: z.record(z.string()).optional(),
})
export type HostScanService = z.infer<typeof HostScanServiceSchema>

export const HostScanRealmSchema = z.object({
  type: z.enum([
    "docker-engine",
    "systemd",
    "iis",
    "windows-service",
    "process",
  ]),
  version: z.string().optional(),
  status: z.string().optional(),
})
export type HostScanRealm = z.infer<typeof HostScanRealmSchema>

export const HostScanComposeProjectSchema = z.object({
  name: z.string(),
  workingDir: z.string().optional(),
  status: z.string().optional(),
  services: z.array(z.string()).default([]),
})
export type HostScanComposeProject = z.infer<
  typeof HostScanComposeProjectSchema
>

export const HostScanCollectorStatusSchema = z.object({
  name: z.string(),
  status: z.enum(["ok", "failed", "skipped"]),
  error: z.string().optional(),
  count: z.number().int().optional(),
})
export type HostScanCollectorStatus = z.infer<
  typeof HostScanCollectorStatusSchema
>

// ── Reverse proxy scan schemas ──────────────────────────────

export const ScanBackendContainerSchema = z.object({
  name: z.string(),
  composeProject: z.string(),
  composeService: z.string(),
})

export const ScanBackendSchema = z.object({
  url: z.string(),
  weight: z.number().optional(),
  container: ScanBackendContainerSchema.optional(),
  hostIp: z.string().optional(),
})

export const ContainerIpEntrySchema = z.object({
  ip: z.string(),
  containerName: z.string(),
  composeProject: z.string(),
  composeService: z.string(),
})

export const ScanRouterSchema = z.object({
  name: z.string(),
  rule: z.string(),
  domains: z.array(z.string()).default([]),
  pathPrefixes: z.array(z.string()).default([]),
  entrypoints: z.array(z.string()).default([]),
  service: z.string(),
  tls: z
    .object({
      certResolver: z.string().optional(),
      passthrough: z.boolean().optional(),
    })
    .optional(),
  middlewares: z.array(z.string()).default([]),
  backends: z.array(ScanBackendSchema).default([]),
  status: z.string().optional(),
  provider: z.string().optional(),
})

export const ScanEntrypointSchema = z.object({
  name: z.string(),
  port: z.number().int(),
  protocol: z.string(),
})

export const ScanReverseProxySchema = z.object({
  name: z.string(),
  engine: z.enum(["traefik", "nginx", "caddy", "haproxy"]),
  version: z.string().optional(),
  containerName: z.string().optional(),
  pid: z.number().int().optional(),
  apiUrl: z.string().optional(),
  entrypoints: z.array(ScanEntrypointSchema).default([]),
  routers: z.array(ScanRouterSchema).default([]),
})

export const HostScanResultSchema = z.object({
  scannedAt: z.coerce.date(),
  scanDurationMs: z.number().int().optional(),
  os: OsSchema.optional(),
  arch: ArchSchema.optional(),
  hostname: z.string().optional(),
  ipAddress: z.string().optional(),
  realms: z.array(HostScanRealmSchema).default([]),
  services: z.array(HostScanServiceSchema).default([]),
  ports: z.array(HostScanPortSchema).default([]),
  composeProjects: z.array(HostScanComposeProjectSchema).default([]),
  collectors: z.array(HostScanCollectorStatusSchema).default([]),
  reverseProxies: z.array(ScanReverseProxySchema).default([]),
  containerIpMap: z.array(ContainerIpEntrySchema).default([]),
  networkCrawl: z.lazy(() => NetworkCrawlResultSchema).optional(),
})
export type HostScanResult = z.infer<typeof HostScanResultSchema>

// ── Network Crawl Result ─────────────────────────────────

export const NetworkCrawlResolvedServiceSchema = z.object({
  port: z.number().int(),
  domains: z.array(z.string()),
  routerName: z.string(),
  service: z
    .object({
      name: z.string(),
      displayName: z.string().optional(),
      composeProject: z.string().optional(),
      image: z.string().optional(),
      realmType: z.string(),
    })
    .optional(),
})
export type NetworkCrawlResolvedService = z.infer<
  typeof NetworkCrawlResolvedServiceSchema
>

export const NetworkCrawlHostEntrySchema = z.object({
  ip: z.string(),
  hostname: z.string().optional(),
  reachable: z.boolean(),
  error: z.string().optional(),
  resolvedServices: z.array(NetworkCrawlResolvedServiceSchema).default([]),
  /** Full scan data from this host — used by --deep to submit scans for discovered hosts. Untyped to avoid circular ref with HostScanResult. */
  scanResult: z.record(z.unknown()).optional(),
})
export type NetworkCrawlHostEntry = z.infer<typeof NetworkCrawlHostEntrySchema>

export const NetworkCrawlResultSchema = z.object({
  crawledAt: z.coerce.date(),
  hostEntries: z.array(NetworkCrawlHostEntrySchema).default([]),
})
export type NetworkCrawlResult = z.infer<typeof NetworkCrawlResultSchema>
