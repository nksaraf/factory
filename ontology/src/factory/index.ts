import { z } from "zod"
import {
  defineEntity,
  compileOntology,
  link,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Addressable,
  Junction,
} from "../schema/index"

// ---------------------------------------------------------------------------
// Org namespace
// ---------------------------------------------------------------------------

export const Team = defineEntity("team", {
  namespace: "org",
  prefix: "team",
  description: "Organizational unit that owns resources and receives secrets",
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    description: z.string().optional(),
    slackChannel: z.string().optional(),
    oncallUrl: z.string().optional(),
  }),
  links: {
    parent: link.manyToOne("team", {
      fk: "parentTeamId",
      inverse: "children",
      description: "Recursive parent for team hierarchy",
    }),
    memberships: link.oneToMany("membership", {
      targetFk: "teamId",
      description: "Team memberships — traverse to reach principals",
    }),
  },
})

export const Principal = defineEntity("principal", {
  namespace: "org",
  prefix: "prin",
  plural: "principals",
  description: "A human or machine identity that can authenticate",
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    authUserId: z.string(),
    avatarUrl: z.string().optional(),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(["active", "inactive", "suspended"]),
  }),
  links: {
    primaryTeam: link.manyToOne("team", {
      fk: "primaryTeamId",
      inverse: "members",
    }),
  },
})

// ---------------------------------------------------------------------------
// Infra namespace
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Software namespace
// ---------------------------------------------------------------------------

export const System = defineEntity("system", {
  namespace: "software",
  prefix: "sys",
  description:
    "A deployable software system (product, platform, service suite)",
  traits: [Bitemporal, TeamOwned],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    namespace: z.string().optional(),
    lifecycle: z
      .enum(["incubating", "active", "deprecated", "retired"])
      .optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
  }),
  links: {
    components: link.oneToMany("component", {
      targetFk: "systemId",
      inverse: "system",
    }),
  },
})

export const Component = defineEntity("component", {
  namespace: "software",
  prefix: "cmp",
  description: "A single deployable unit within a system",
  traits: [Bitemporal, TeamOwned],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    type: z.enum([
      "service",
      "worker",
      "task",
      "cronjob",
      "website",
      "library",
      "cli",
      "agent",
      "gateway",
      "database",
      "cache",
      "queue",
      "storage",
      "search",
    ]),
    lifecycle: z
      .enum(["incubating", "active", "deprecated", "retired"])
      .optional(),
    description: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "components",
      required: true,
    }),
  },
})

// ---------------------------------------------------------------------------
// Ops namespace
// ---------------------------------------------------------------------------

export const Site = defineEntity("site", {
  namespace: "ops",
  prefix: "site",
  description: "A deployment target — a logical environment where systems run",
  traits: [Reconcilable, Bitemporal],
  reconciliation: true,
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    tenancy: z.enum(["shared", "dedicated"]).optional(),
    product: z.string().optional(),
    updatePolicy: z.enum(["auto", "manual", "canary"]).optional(),
    lifecycle: z.enum(["ephemeral", "persistent"]).optional(),
    ttl: z.string().optional(),
    authMode: z.enum(["none", "basic", "oidc"]).optional(),
  }),
  links: {
    parent: link.manyToOne("site", {
      fk: "parentSiteId",
      inverse: "children",
      description: "Recursive parent for site hierarchy",
    }),
    systemDeployments: link.oneToMany("systemDeployment", {
      targetFk: "siteId",
      inverse: "site",
    }),
  },
})

export const SystemDeployment = defineEntity("systemDeployment", {
  namespace: "ops",
  prefix: "sdp",
  plural: "systemDeployments",
  description:
    "A system deployed to a site — dual lineage from both infra and software",
  traits: [Reconcilable],
  reconciliation: true,
  metadata: "standard",
  spec: z.object({
    trigger: z.enum(["manual", "ci", "gitops", "auto"]).optional(),
    deploymentStrategy: z
      .enum(["rolling", "recreate", "blue-green", "canary"])
      .optional(),
    ttl: z.string().optional(),
    namespace: z.string().optional(),
    runtime: z.string().optional(),
  }),
  links: {
    site: link.manyToOne("site", {
      fk: "siteId",
      inverse: "systemDeployments",
      required: true,
    }),
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "deployments",
      required: true,
    }),
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "systemDeployments",
    }),
    componentDeployments: link.oneToMany("componentDeployment", {
      targetFk: "systemDeploymentId",
      inverse: "systemDeployment",
    }),
  },
})

// TODO: componentDeployment needs a slug column — currently lacks one
export const ComponentDeployment = defineEntity("componentDeployment", {
  namespace: "ops",
  prefix: "cdp",
  plural: "componentDeployments",
  description:
    "A component deployed within a systemDeployment — dual lineage from ops and software",
  metadata: "standard",
  spec: z.object({
    mode: z.enum(["container", "native", "sidecar"]).optional(),
    replicas: z.number().optional(),
    envOverrides: z.record(z.string()).optional(),
    desiredImage: z.string().optional(),
  }),
  links: {
    systemDeployment: link.manyToOne("systemDeployment", {
      fk: "systemDeploymentId",
      inverse: "componentDeployments",
      required: true,
    }),
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "deployments",
      required: true,
    }),
  },
})

export const Workbench = defineEntity("workbench", {
  namespace: "ops",
  prefix: "wbnch",
  plural: "workbenches",
  description: "A developer workspace bound to a site, host, and realm",
  traits: [Reconcilable, Bitemporal],
  reconciliation: true,
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    realmType: z.string().optional(),
    repos: z.array(z.string()).optional(),
    cpu: z.number().optional(),
    memory: z.number().optional(),
    storageGb: z.number().optional(),
    ownerType: z.enum(["principal", "team"]).optional(),
    authMode: z.enum(["none", "basic", "oidc"]).optional(),
  }),
  links: {
    site: link.manyToOne("site", {
      fk: "siteId",
      inverse: "workbenches",
    }),
    host: link.manyToOne("host", {
      fk: "hostId",
      inverse: "workbenches",
    }),
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "workbenches",
    }),
    owner: link.manyToOne("principal", {
      fk: "ownerId",
      inverse: "workbenches",
    }),
  },
})

// ---------------------------------------------------------------------------
// Junction entities — many-to-many relationships as first-class entities
// ---------------------------------------------------------------------------

export const Membership = defineEntity("membership", {
  namespace: "org",
  prefix: "ptm",
  plural: "memberships",
  description: "Links a principal to a team with a role",
  traits: [Junction],
  spec: z.object({
    role: z.enum(["member", "lead", "admin"]).default("member"),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "memberships",
      required: true,
      cascade: "delete",
    }),
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "memberships",
      required: true,
      cascade: "delete",
    }),
  },
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

export const ProductSystem = defineEntity("product-system", {
  namespace: "software",
  prefix: "psys",
  plural: "productSystems",
  description: "Links a product to a system it contains",
  traits: [Junction],
  spec: z.object({}),
  links: {
    product: link.manyToOne("product", {
      fk: "productId",
      inverse: "productSystems",
      required: true,
      cascade: "delete",
    }),
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "productSystems",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ThreadParticipant = defineEntity("thread-participant", {
  namespace: "org",
  prefix: "tprt",
  plural: "threadParticipants",
  description:
    "Links a principal to a thread with a role and join/leave lifecycle",
  traits: [Junction],
  spec: z.object({
    role: z.string(),
    joinedAt: z.string().optional(),
    leftAt: z.string().optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "participants",
      required: true,
      cascade: "delete",
    }),
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "threadParticipations",
      required: true,
      cascade: "delete",
    }),
  },
})

// ---------------------------------------------------------------------------
// Compiled ontology
// ---------------------------------------------------------------------------

export const FactoryOntology = compileOntology(
  [
    Team,
    Principal,
    Estate,
    Host,
    Realm,
    System,
    Component,
    Site,
    SystemDeployment,
    ComponentDeployment,
    Workbench,
    // Junctions
    Membership,
    RealmHost,
    ProductSystem,
    ThreadParticipant,
  ],
  { traits: [Reconcilable, Bitemporal, TeamOwned, Addressable, Junction] }
)
