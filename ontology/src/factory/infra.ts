import { z } from "zod"
import { defineEntity, link, Reconcilable, Junction } from "../schema/index"

export const Estate = defineEntity("estate", {
  namespace: "infra",
  prefix: "est",
  description:
    "A cloud account, datacenter, or infrastructure provider boundary",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    providerKind: z.string(),
    credentialsRef: z.string().optional(),
    endpoint: z.string().optional(),
    location: z.string().optional(),
    lifecycle: z
      .enum(["active", "decommissioning", "decommissioned"])
      .optional(),
    syncStatus: z.enum(["synced", "syncing", "error"]).optional(),
    lastSyncAt: z.string().optional(),
  }),
  links: {
    parent: link.manyToOne("estate", {
      fk: "parentEstateId",
      inverse: "children",
      description: "Recursive parent for estate hierarchy",
    }),
    hosts: link.oneToMany("host", {
      targetFk: "estateId",
      inverse: "estate",
    }),
    realms: link.oneToMany("realm", {
      targetFk: "estateId",
      inverse: "estate",
    }),
  },
})

export const Host = defineEntity("host", {
  namespace: "infra",
  prefix: "host",
  description: "A physical or virtual machine registered in an estate",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    hostname: z.string(),
    os: z.string().optional(),
    arch: z.string().optional(),
    cpu: z.number().optional(),
    memoryMb: z.number().optional(),
    diskGb: z.number().optional(),
    lifecycle: z
      .enum(["provisioning", "active", "draining", "decommissioned"])
      .optional(),
    ipAddress: z.string().optional(),
    sshPort: z.number().optional(),
    accessMethod: z.enum(["ssh", "agent", "api"]).optional(),
  }),
  annotations: {
    hostname: { searchable: true, sortable: true, visibility: "prominent" },
    ipAddress: { searchable: true },
  },
  identity: { slug: { scope: "global" }, titleProperty: "hostname" },
  links: {
    estate: link.manyToOne("estate", {
      fk: "estateId",
      inverse: "hosts",
    }),
    realmHosts: link.oneToMany("realm-host", {
      targetFk: "hostId",
      description: "Realm-host assignments — traverse to reach realms",
    }),
  },
})

export const Realm = defineEntity("realm", {
  namespace: "infra",
  prefix: "rlm",
  description:
    "A runtime environment within an estate (k8s cluster, Docker host, etc.)",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    category: z.string(),
    endpoint: z.string().optional(),
    version: z.string().optional(),
    status: z.enum(["ready", "provisioning", "degraded", "offline"]).optional(),
    nodeCount: z.number().optional(),
  }),
  links: {
    estate: link.manyToOne("estate", {
      fk: "estateId",
      inverse: "realms",
    }),
    parent: link.manyToOne("realm", {
      fk: "parentRealmId",
      inverse: "children",
      description: "Recursive parent for realm hierarchy",
    }),
    realmHosts: link.oneToMany("realm-host", {
      targetFk: "realmId",
      description: "Realm-host assignments — traverse to reach hosts",
    }),
  },
})

export const Service = defineEntity("service", {
  namespace: "infra",
  prefix: "svc",
  plural: "services",
  description:
    "External service consumed via protocol/API: managed infra, SaaS, AI/ML",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    endpoint: z.string().optional(),
    protocol: z.string().optional(),
    provider: z.string().optional(),
    version: z.string().optional(),
    connectionString: z.string().optional(),
  }),
  links: {
    estate: link.manyToOne("estate", {
      fk: "estateId",
      inverse: "services",
    }),
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "services",
    }),
    systemDeployment: link.manyToOne("systemDeployment", {
      fk: "systemDeploymentId",
      inverse: "services",
    }),
  },
})

export const Route = defineEntity("route", {
  namespace: "infra",
  prefix: "rte",
  plural: "routes",
  description: "Traffic routing rule that exposes services via domains",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    targetService: z.string().optional(),
    targetPort: z.number().optional(),
    pathPrefix: z.string().optional(),
    protocol: z.enum(["http", "https", "tcp"]).optional(),
    status: z.enum(["pending", "active", "error", "expired"]).optional(),
  }),
  links: {
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "routes",
    }),
  },
})

export const DnsDomain = defineEntity("dnsDomain", {
  namespace: "infra",
  prefix: "dom",
  plural: "dnsDomains",
  description: "DNS domain record associated with a site",
  metadata: "standard",
  spec: z.object({
    dnsProvider: z.string().optional(),
    registrar: z.string().optional(),
    verified: z.boolean().optional(),
    status: z.string().optional(),
  }),
  links: {
    site: link.manyToOne("site", {
      fk: "siteId",
      inverse: "dnsDomains",
    }),
  },
})

export const IpAddress = defineEntity("ipAddress", {
  namespace: "infra",
  prefix: "ipa",
  plural: "ipAddresses",
  description: "IP address allocation within a subnet",
  spec: z.object({
    version: z.enum(["v4", "v6"]).optional(),
    status: z.enum(["available", "assigned", "reserved", "dhcp"]).optional(),
    scope: z.string().optional(),
    role: z.string().optional(),
  }),
  links: {
    subnet: link.manyToOne("estate", {
      fk: "subnetId",
      inverse: "ipAddresses",
    }),
  },
})

export const NetworkLink = defineEntity("networkLink", {
  namespace: "infra",
  prefix: "nlnk",
  plural: "networkLinks",
  description:
    "Directed edge in the infrastructure graph modeling traffic flow",
  traits: [Reconcilable],
  metadata: "standard",
  reconciliation: true,
  spec: z.object({
    ingressPort: z.number().optional(),
    egressPort: z.number().optional(),
    bidirectional: z.boolean().optional(),
    enabled: z.boolean().optional(),
    description: z.string().optional(),
  }),
  links: {},
})

export const RealmHost = defineEntity("realm-host", {
  namespace: "infra",
  prefix: "rlmh",
  plural: "realmHosts",
  description:
    "Links a realm to a host with a role (control-plane, worker, etc.)",
  traits: [Junction],
  softDelete: false,
  spec: z.object({
    role: z.enum(["single", "control-plane", "worker"]).default("single"),
  }),
  links: {
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "realmHosts",
      required: true,
      cascade: "delete",
    }),
    host: link.manyToOne("host", {
      fk: "hostId",
      inverse: "realmHosts",
      required: true,
      cascade: "delete",
    }),
  },
})
