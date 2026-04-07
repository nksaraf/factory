/**
 * Zod schemas for the `infra` schema — "Where Things Run"
 * Single source of truth. TS types derived via z.infer<>.
 */

import { z } from "zod";
import { ReconciliationSchema } from "./common";

// ── Substrate ───────────────────────────────────────────────

export const SubstrateTypeSchema = z.enum([
  "cloud-account",
  "region",
  "datacenter",
  "vpc",
  "subnet",
  "hypervisor",
  "rack",
]);
export type SubstrateType = z.infer<typeof SubstrateTypeSchema>;

export const ProviderKindSchema = z.enum([
  "aws",
  "gcp",
  "azure",
  "proxmox",
  "hetzner",
  "digitalocean",
  "bare-metal",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const SubstrateSpecSchema = z.object({
  providerKind: ProviderKindSchema.optional(),
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
});
export type SubstrateSpec = z.infer<typeof SubstrateSpecSchema>;

export const SubstrateSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: SubstrateTypeSchema,
  parentSubstrateId: z.string().nullable(),
  spec: SubstrateSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
export type Substrate = z.infer<typeof SubstrateSchema>;

// ── Host ────────────────────────────────────────────────────

export const HostTypeSchema = z.enum([
  "bare-metal",
  "vm",
  "lxc",
  "cloud-instance",
]);
export type HostType = z.infer<typeof HostTypeSchema>;

export const OsSchema = z.enum(["linux", "windows", "macos"]);
export type Os = z.infer<typeof OsSchema>;

export const ArchSchema = z.enum(["amd64", "arm64"]);
export type Arch = z.infer<typeof ArchSchema>;

export const AccessMethodSchema = z.enum(["ssh", "winrm", "rdp"]);
export type AccessMethod = z.infer<typeof AccessMethodSchema>;

export const HostSpecSchema = z.object({
  hostname: z.string(),
  os: OsSchema.default("linux"),
  arch: ArchSchema.default("amd64"),
  cpu: z.number().int().optional(),
  memoryMb: z.number().int().optional(),
  diskGb: z.number().int().optional(),
  accessMethod: AccessMethodSchema.default("ssh"),
  accessUser: z.string().default("root"),
  sshPort: z.number().int().min(1).max(65535).default(22),
  ipAddress: z.string().optional(),
  externalId: z.string().optional(), // e.g., Proxmox VMID, AWS instance ID
  role: z.string().optional(), // e.g., "k8s-server", "k8s-agent", "general"
  lifecycle: z.enum(["active", "maintenance", "offline", "decommissioned"]).default("active"),
  jumpHost: z.string().optional(),
  jumpUser: z.string().optional(),
  jumpPort: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().optional(),
});
export type HostSpec = z.infer<typeof HostSpecSchema>;

export const HostSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: HostTypeSchema,
  substrateId: z.string().nullable(),
  spec: HostSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
export type Host = z.infer<typeof HostSchema>;

// ── Runtime ─────────────────────────────────────────────────

export const RuntimeTypeSchema = z.enum([
  "k8s-cluster",
  "k8s-namespace",
  "docker-engine",
  "compose-project",
  "systemd",
  "reverse-proxy",
]);
export type RuntimeType = z.infer<typeof RuntimeTypeSchema>;

export const RuntimeSpecSchema = z.object({
  endpoint: z.string().optional(),
  kubeconfigRef: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(["provisioning", "ready", "degraded", "destroying"]).default("provisioning"),
  isDefault: z.boolean().optional(),
  nodeCount: z.number().int().optional(),
  capacity: z.object({
    cpu: z.number().optional(),
    memoryMb: z.number().optional(),
    pods: z.number().optional(),
  }).optional(),
});
export type RuntimeSpec = z.infer<typeof RuntimeSpecSchema>;

// ── Reverse Proxy Runtime Spec ──────────────────────────────

export const ProxyEntrypointSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https", "tcp", "udp"]).default("http"),
});
export type ProxyEntrypoint = z.infer<typeof ProxyEntrypointSchema>;

export const ReverseProxyRuntimeSpecSchema = z.object({
  engine: z.enum(["traefik", "caddy", "nginx", "factory-gateway"]),
  entrypoints: z.array(ProxyEntrypointSchema).default([]),
  configRef: z.string().optional(),
  dynamicConfigDir: z.string().optional(),
  dashboardUrl: z.string().optional(),
  certResolvers: z.array(z.string()).default([]),
});
export type ReverseProxyRuntimeSpec = z.infer<typeof ReverseProxyRuntimeSpecSchema>;

export const RuntimeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: RuntimeTypeSchema,
  parentRuntimeId: z.string().nullable(),
  hostId: z.string().nullable(),
  spec: RuntimeSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
export type Runtime = z.infer<typeof RuntimeSchema>;

// ── Route ───────────────────────────────────────────────────

export const RouteTypeSchema = z.enum([
  "ingress",
  "workspace",
  "preview",
  "tunnel",
  "custom-domain",
]);
export type RouteType = z.infer<typeof RouteTypeSchema>;

export const RouteTargetSchema = z.object({
  tenantSlug: z.string(),
  systemDeploymentSlug: z.string(),
  port: z.number().int(),
  weight: z.number().min(0).max(100).default(100),
  geo: z.array(z.string()).optional(), // e.g., ["Asia", "India"]
});
export type RouteTarget = z.infer<typeof RouteTargetSchema>;

export const RouteSpecSchema = z.object({
  // Flat target fields — used by reconciler-created routes (workspace, preview, tunnel)
  targetService: z.string().optional(),
  targetPort: z.number().int().optional(),
  pathPrefix: z.string().optional(),
  // Multi-target — used by user-created ingress routes with weighted routing
  targets: z.array(RouteTargetSchema).optional(),
  protocol: z.enum(["http", "https", "tcp"]).default("http"),
  status: z.enum(["pending", "active", "error", "expired"]).default("pending"),
  createdBy: z.enum(["reconciler", "user", "api"]).default("api"),
  expiresAt: z.string().optional(),
  siteId: z.string().optional(),
  systemDeploymentId: z.string().optional(),
  tlsMode: z.string().optional(),
  tlsCertRef: z.string().optional(),
  priority: z.number().int().optional(),
  middlewares: z.array(z.unknown()).default([]),
}).passthrough();
export type RouteSpec = z.infer<typeof RouteSpecSchema>;

export const RouteSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: RouteTypeSchema,
  domain: z.string(),
  runtimeId: z.string().nullable(),
  spec: RouteSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
export type Route = z.infer<typeof RouteSchema>;

// ── Route Status (resolved state in reconciliation status col) ──

export const ResolvedTargetSchema = z.object({
  systemDeploymentSlug: z.string(),
  componentSlug: z.string(),
  address: z.string(),
  port: z.number().int(),
  weight: z.number().min(0).max(100),
  runtimeType: z.string(),
  geo: z.array(z.string()).optional(),
});
export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;

export const RouteStatusSchema = z.object({
  resolvedTargets: z.array(ResolvedTargetSchema).default([]),
  resolvedAt: z.coerce.date().optional(),
  resolutionError: z.string().optional(),
  phase: z.enum(["pending", "resolved", "error", "stale"]).default("pending"),
});
export type RouteStatus = z.infer<typeof RouteStatusSchema>;

// ── DNS Domain ──────────────────────────────────────────────

export const DnsDomainTypeSchema = z.enum([
  "primary",
  "alias",
  "custom",
  "wildcard",
]);
export type DnsDomainType = z.infer<typeof DnsDomainTypeSchema>;

export const DnsDomainSpecSchema = z.object({
  registrar: z.string().optional(),
  verified: z.boolean().default(false),
  dnsProvider: z.string().optional(),
  txtRecordValue: z.string().optional(),
  verifiedAt: z.coerce.date().optional(),
});
export type DnsDomainSpec = z.infer<typeof DnsDomainSpecSchema>;

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
});
export type DnsDomain = z.infer<typeof DnsDomainSchema>;

// ── Tunnel ──────────────────────────────────────────────────

export const TunnelTypeSchema = z.enum(["http", "tcp"]);
export type TunnelType = z.infer<typeof TunnelTypeSchema>;

export const TunnelSpecSchema = z.object({
  localPort: z.number().int(),
  remotePort: z.number().int(),
  connectedAt: z.coerce.date().optional(),
});
export type TunnelSpec = z.infer<typeof TunnelSpecSchema>;

export const TunnelSchema = z.object({
  id: z.string(),
  type: TunnelTypeSchema,
  routeId: z.string(),
  principalId: z.string(),
  subdomain: z.string(),
  phase: z.enum(["connecting", "connected", "disconnected", "error"]).default("connecting"),
  spec: TunnelSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(ReconciliationSchema);
export type Tunnel = z.infer<typeof TunnelSchema>;

// ── IP Address ──────────────────────────────────────────────

export const IpAddressStatusSchema = z.enum([
  "available",
  "assigned",
  "reserved",
  "dhcp",
]);
export type IpAddressStatus = z.infer<typeof IpAddressStatusSchema>;

export const IpAddressSpecSchema = z.object({
  version: z.enum(["v4", "v6"]).default("v4"),
  status: IpAddressStatusSchema.default("available"),
  assignedToType: z.string().optional(), // e.g., "host", "runtime", "service"
  assignedToId: z.string().optional(),
  gateway: z.string().optional(),
  cidr: z.number().int().optional(),
});
export type IpAddressSpec = z.infer<typeof IpAddressSpecSchema>;

export const IpAddressSchema = z.object({
  id: z.string(),
  address: z.string(),
  subnetId: z.string().nullable(),
  spec: IpAddressSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type IpAddress = z.infer<typeof IpAddressSchema>;

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
});
export type SecretSpec = z.infer<typeof SecretSpecSchema>;

export const SecretSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  spec: SecretSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Secret = z.infer<typeof SecretSchema>;

// ── Network Link ─────────────────────────────────────────

export const NetworkLinkTypeSchema = z.enum([
  "proxy",
  "direct",
  "tunnel",
  "nat",
  "firewall",
  "mesh",
  "peering",
]);
export type NetworkLinkType = z.infer<typeof NetworkLinkTypeSchema>;

export const NetworkLinkEndpointKindSchema = z.enum([
  "substrate",
  "host",
  "runtime",
]);
export type NetworkLinkEndpointKind = z.infer<typeof NetworkLinkEndpointKindSchema>;

export const NetworkLinkSpecSchema = z.object({
  // Protocol & Ports
  ingressPort: z.number().int().min(1).max(65535).optional(),
  egressPort: z.number().int().min(1).max(65535).optional(),
  ingressProtocol: z.enum(["http", "https", "tcp", "udp", "grpc"]).optional(),
  egressProtocol: z.enum(["http", "https", "tcp", "udp", "grpc"]).optional(),

  // TLS
  tls: z.object({
    termination: z.enum(["edge", "passthrough", "reencrypt"]).optional(),
    certRef: z.string().optional(),
    certResolver: z.string().optional(),
  }).optional(),

  // Match criteria (what traffic flows through this link)
  match: z.object({
    hosts: z.array(z.string()).default([]),
    pathPrefixes: z.array(z.string()).default([]),
    headers: z.record(z.string()).default({}),
    sni: z.array(z.string()).default([]),
  }).optional(),

  // Load balancing
  loadBalancing: z.object({
    strategy: z.enum(["round-robin", "least-connections", "ip-hash", "random"]).default("round-robin"),
    weight: z.number().min(0).max(100).default(100),
    sticky: z.boolean().default(false),
  }).optional(),

  // Health check
  healthCheck: z.object({
    path: z.string().default("/health"),
    intervalSeconds: z.number().int().default(10),
    timeoutSeconds: z.number().int().default(5),
    failureThreshold: z.number().int().default(3),
  }).optional(),

  // Control
  description: z.string().optional(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  middlewares: z.array(z.object({
    name: z.string(),
    config: z.record(z.unknown()).default({}),
  })).default([]),
});
export type NetworkLinkSpec = z.infer<typeof NetworkLinkSpecSchema>;

export const NetworkLinkSchema = z.object({
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
}).merge(ReconciliationSchema);
export type NetworkLink = z.infer<typeof NetworkLinkSchema>;

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateSubstrateSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: SubstrateTypeSchema,
  parentSubstrateId: z.string().optional(),
  spec: SubstrateSpecSchema.default({}),
});
export const UpdateSubstrateSchema = CreateSubstrateSchema.partial();

export const CreateHostSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: HostTypeSchema,
  substrateId: z.string().optional(),
  spec: HostSpecSchema,
});
export const UpdateHostSchema = CreateHostSchema.partial();

export const CreateRuntimeSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: RuntimeTypeSchema,
  parentRuntimeId: z.string().optional(),
  hostId: z.string().optional(),
  spec: RuntimeSpecSchema.default({}),
});
export const UpdateRuntimeSchema = CreateRuntimeSchema.partial();

export const CreateRouteSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: RouteTypeSchema,
  domain: z.string().min(1),
  runtimeId: z.string().optional(),
  spec: RouteSpecSchema,
});
export const UpdateRouteSchema = CreateRouteSchema.partial();

export const CreateDnsDomainSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: DnsDomainTypeSchema,
  fqdn: z.string().min(1),
  siteId: z.string().optional(),
  spec: DnsDomainSpecSchema,
});
export const UpdateDnsDomainSchema = CreateDnsDomainSchema.partial();

export const CreateTunnelSchema = z.object({
  type: TunnelTypeSchema,
  routeId: z.string().min(1),
  principalId: z.string().min(1),
  subdomain: z.string().min(1),
  spec: TunnelSpecSchema,
});
export const UpdateTunnelSchema = CreateTunnelSchema.partial();

export const CreateIpAddressSchema = z.object({
  address: z.string().min(1),
  subnetId: z.string().optional(),
  spec: IpAddressSpecSchema.default({}),
});
export const UpdateIpAddressSchema = CreateIpAddressSchema.partial();

export const CreateSecretSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  spec: SecretSpecSchema,
});
export const UpdateSecretSchema = CreateSecretSchema.partial();

export const CreateNetworkLinkSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: NetworkLinkTypeSchema,
  sourceKind: NetworkLinkEndpointKindSchema,
  sourceId: z.string().min(1),
  targetKind: NetworkLinkEndpointKindSchema,
  targetId: z.string().min(1),
  spec: NetworkLinkSpecSchema.default({}),
});
export const UpdateNetworkLinkSchema = CreateNetworkLinkSchema.partial();
