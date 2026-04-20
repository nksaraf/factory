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

// ===========================================================================
// Org namespace
// ===========================================================================

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

export const Agent = defineEntity("agent", {
  namespace: "org",
  prefix: "agt",
  plural: "agents",
  description:
    "Persistent AI actor identity with role type and reporting hierarchy",
  metadata: "standard",
  spec: z.object({
    autonomyLevel: z
      .enum(["observer", "advisor", "executor", "operator", "supervisor"])
      .optional(),
    relationship: z.enum(["personal", "team", "org"]).optional(),
    collaborationMode: z.enum(["solo", "pair", "crew", "hierarchy"]).optional(),
    systemPrompt: z.string().optional(),
    model: z.string().optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "agents",
      required: true,
    }),
    reportsTo: link.manyToOne("agent", {
      fk: "reportsToAgentId",
      inverse: "directReports",
    }),
  },
})

export const Scope = defineEntity("scope", {
  namespace: "org",
  prefix: "scope",
  plural: "scopes",
  description: "Authorization scope: team-derived, resource-level, or custom",
  spec: z.object({
    description: z.string().optional(),
    permissions: z.array(z.string()).optional(),
  }),
  links: {
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "scopes",
    }),
  },
})

export const IdentityLink = defineEntity("identityLink", {
  namespace: "org",
  prefix: "idlk",
  plural: "identityLinks",
  description:
    "Links a principal to an external identity provider (GitHub, Slack, etc.)",
  spec: z.object({
    externalUsername: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "identityLinks",
      required: true,
    }),
  },
})

// TODO: channel needs a slug column
export const Channel = defineEntity("channel", {
  namespace: "org",
  prefix: "chan",
  plural: "channels",
  description:
    "Persistent surface where threads live (IDE, Slack, terminal, PR, etc.)",
  spec: z.object({
    description: z.string().optional(),
    defaultAgentId: z.string().optional(),
    messagingProviderId: z.string().optional(),
    isDefault: z.boolean().optional(),
  }),
  links: {},
})

// TODO: thread needs a slug column
export const Thread = defineEntity("thread", {
  namespace: "org",
  prefix: "thrd",
  plural: "threads",
  description:
    "Universal conversation primitive: IDE sessions, chats, terminal sessions, reviews, autonomous work",
  spec: z.object({
    title: z.string().optional(),
    model: z.string().optional(),
    cwd: z.string().optional(),
    gitRemoteUrl: z.string().optional(),
    turnCount: z.number().optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "threads",
    }),
    agent: link.manyToOne("agent", {
      fk: "agentId",
      inverse: "threads",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "threads",
    }),
    parent: link.manyToOne("thread", {
      fk: "parentThreadId",
      inverse: "childThreads",
    }),
  },
})

export const Document = defineEntity("document", {
  namespace: "org",
  prefix: "doc",
  plural: "documents",
  description: "Stored document: plans, PRDs, HLDs, LLDs, ADRs, decks, etc.",
  spec: z.object({
    tags: z.array(z.string()).optional(),
    project: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "documents",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "documents",
    }),
  },
})

// TODO: event needs a slug column
export const Event = defineEntity("event", {
  namespace: "org",
  prefix: "evt",
  plural: "events",
  description:
    "Universal event log — all producers write canonical events here",
  spec: z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    payload: z.record(z.unknown()).optional(),
  }),
  links: {
    parentEvent: link.manyToOne("event", {
      fk: "parentEventId",
      inverse: "childEvents",
    }),
  },
})

export const EventSubscription = defineEntity("eventSubscription", {
  namespace: "org",
  prefix: "esub",
  plural: "eventSubscriptions",
  description:
    "Subscription to events — covers workflow triggers and notification streams",
  spec: z.object({
    muted: z.boolean().optional(),
    timezone: z.string().optional(),
  }),
  links: {},
})

export const ConfigVar = defineEntity("configVar", {
  namespace: "org",
  prefix: "cvar",
  plural: "configVars",
  description: "Plain-text configuration variable, scoped to an entity",
  spec: z.object({
    description: z.string().optional(),
    sensitive: z.boolean().optional(),
  }),
  links: {},
})

export const OrgSecret = defineEntity("orgSecret", {
  namespace: "org",
  prefix: "sec",
  plural: "orgSecrets",
  description: "Encrypted secret stored with envelope encryption",
  spec: z.object({
    description: z.string().optional(),
    rotationPolicy: z.enum(["manual", "30d", "90d", "365d"]).optional(),
  }),
  links: {
    createdBy: link.manyToOne("principal", {
      fk: "createdBy",
      inverse: "createdSecrets",
    }),
  },
})

// ===========================================================================
// Infra namespace
// ===========================================================================

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

// ===========================================================================
// Software namespace
// ===========================================================================

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

export const SoftwareApi = defineEntity("softwareApi", {
  namespace: "software",
  prefix: "api",
  plural: "softwareApis",
  description: "API exposed by a system (OpenAPI, gRPC, GraphQL, etc.)",
  metadata: "standard",
  spec: z.object({
    definitionRef: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "apis",
      required: true,
    }),
    providedByComponent: link.manyToOne("component", {
      fk: "providedByComponentId",
      inverse: "providedApis",
    }),
  },
})

export const Artifact = defineEntity("artifact", {
  namespace: "software",
  prefix: "art",
  plural: "artifacts",
  description: "Build artifact: container image, npm package, binary, etc.",
  spec: z.object({
    imageRef: z.string().optional(),
    imageDigest: z.string().optional(),
    sizeBytes: z.number().optional(),
    arch: z.enum(["amd64", "arm64", "multi"]).optional(),
    registry: z.string().optional(),
  }),
  links: {
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "artifacts",
      required: true,
    }),
  },
})

export const Release = defineEntity("release", {
  namespace: "software",
  prefix: "rel",
  plural: "releases",
  description: "Versioned release of a system",
  spec: z.object({
    version: z.string(),
    status: z
      .enum(["draft", "staging", "production", "superseded", "failed"])
      .optional(),
    releaseNotes: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "releases",
      required: true,
    }),
  },
})

export const Template = defineEntity("template", {
  namespace: "software",
  prefix: "tmpl",
  plural: "templates",
  description: "Workbench/project/component template",
  metadata: "standard",
  spec: z.object({
    kind: z.string(),
    runtime: z.string().optional(),
    framework: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {},
})

export const Product = defineEntity("product", {
  namespace: "software",
  prefix: "prod",
  plural: "products",
  description: "Customer-facing product",
  metadata: "standard",
  spec: z.object({
    description: z.string().optional(),
    brand: z.string().optional(),
    website: z.string().optional(),
    icon: z.string().optional(),
  }),
  links: {},
})

export const Capability = defineEntity("capability", {
  namespace: "software",
  prefix: "cap",
  plural: "capabilities",
  description: "Feature capability that can be metered and entitled",
  traits: [TeamOwned],
  metadata: "standard",
  spec: z.object({
    activation: z.enum(["flag", "config", "deploy", "independent"]).optional(),
    visibility: z.enum(["listed", "unlisted", "internal"]).optional(),
    description: z.string().optional(),
  }),
  links: {
    product: link.manyToOne("product", {
      fk: "productId",
      inverse: "capabilities",
    }),
  },
})

// ===========================================================================
// Ops namespace
// ===========================================================================

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

export const Tenant = defineEntity("tenant", {
  namespace: "ops",
  prefix: "tnt",
  plural: "tenants",
  description: "Multi-tenant isolation unit within a site",
  traits: [Reconcilable, Bitemporal],
  reconciliation: true,
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    environment: z
      .enum(["production", "staging", "development", "preview"])
      .optional(),
    isolation: z.enum(["dedicated", "shared", "siloed"]).optional(),
    status: z
      .enum(["provisioning", "active", "suspended", "decommissioned"])
      .optional(),
  }),
  links: {
    site: link.manyToOne("site", {
      fk: "siteId",
      inverse: "tenants",
      required: true,
    }),
    customer: link.manyToOne("customer", {
      fk: "customerId",
      inverse: "tenants",
      required: true,
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

export const DeploymentSet = defineEntity("deploymentSet", {
  namespace: "ops",
  prefix: "dset",
  plural: "deploymentSets",
  description:
    "Set of component deployments in a system deployment (blue/green, canary)",
  traits: [Reconcilable],
  reconciliation: true,
  spec: z.object({
    role: z
      .enum([
        "active",
        "blue",
        "green",
        "stable",
        "canary",
        "primary",
        "replica",
        "standby",
      ])
      .optional(),
    trafficWeight: z.number().optional(),
    status: z
      .enum(["provisioning", "running", "draining", "stopped", "failed"])
      .optional(),
  }),
  links: {
    systemDeployment: link.manyToOne("systemDeployment", {
      fk: "systemDeploymentId",
      inverse: "deploymentSets",
      required: true,
    }),
    realm: link.manyToOne("realm", {
      fk: "realmId",
      inverse: "deploymentSets",
    }),
  },
})

// TODO: componentDeployment needs a slug column
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

// TODO: rollout needs a slug column
export const Rollout = defineEntity("rollout", {
  namespace: "ops",
  prefix: "rout",
  plural: "rollouts",
  description: "Progressive deployment of a release to a system deployment",
  traits: [Reconcilable],
  reconciliation: true,
  spec: z.object({
    status: z
      .enum(["pending", "in_progress", "succeeded", "failed", "rolled_back"])
      .optional(),
    strategy: z.enum(["rolling", "blue-green", "canary"]).optional(),
    progress: z.number().optional(),
  }),
  links: {
    release: link.manyToOne("release", {
      fk: "releaseId",
      inverse: "rollouts",
    }),
    systemDeployment: link.manyToOne("systemDeployment", {
      fk: "systemDeploymentId",
      inverse: "rollouts",
      required: true,
    }),
  },
})

export const OpsDatabase = defineEntity("opsDatabase", {
  namespace: "ops",
  prefix: "db",
  plural: "opsDatabases",
  description: "Managed database instance for a system deployment",
  spec: z.object({
    engine: z.enum(["postgres", "mysql", "redis", "mongodb"]).optional(),
    version: z.string().optional(),
    provisionMode: z.enum(["sidecar", "managed", "external"]).optional(),
    connectionString: z.string().optional(),
  }),
  links: {
    systemDeployment: link.manyToOne("systemDeployment", {
      fk: "systemDeploymentId",
      inverse: "databases",
    }),
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "databases",
    }),
  },
})

// TODO: workbenchSnapshot needs a slug column
export const WorkbenchSnapshot = defineEntity("workbenchSnapshot", {
  namespace: "ops",
  prefix: "wbsnap",
  plural: "workbenchSnapshots",
  description: "Snapshot of a workbench for backup/restore",
  spec: z.object({
    volumeSnapshotName: z.string().optional(),
    sizeBytes: z.number().optional(),
    status: z.enum(["creating", "ready", "failed", "deleted"]).optional(),
  }),
  links: {
    workbench: link.manyToOne("workbench", {
      fk: "workbenchId",
      inverse: "snapshots",
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

// ===========================================================================
// Build namespace
// ===========================================================================

export const GitHostProvider = defineEntity("gitHostProvider", {
  namespace: "build",
  prefix: "ghp",
  plural: "gitHostProviders",
  description: "Git hosting provider (GitHub, GitLab, Gitea, Bitbucket)",
  spec: z.object({
    apiUrl: z.string().optional(),
    authMode: z.enum(["token", "app", "oauth"]).optional(),
    org: z.string().optional(),
    status: z.enum(["active", "inactive", "error"]).optional(),
  }),
  links: {},
})

export const Repo = defineEntity("repo", {
  namespace: "build",
  prefix: "repo",
  plural: "repos",
  description: "Git repository linked to a system",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    url: z.string(),
    defaultBranch: z.string().optional(),
    kind: z.string().optional(),
    description: z.string().optional(),
    language: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "repos",
    }),
    gitHostProvider: link.manyToOne("gitHostProvider", {
      fk: "gitHostProviderId",
      inverse: "repos",
    }),
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "repos",
    }),
  },
})

// TODO: pipelineRun needs a slug column
export const PipelineRun = defineEntity("pipelineRun", {
  namespace: "build",
  prefix: "prun",
  plural: "pipelineRuns",
  description: "CI/CD pipeline execution triggered by a commit or webhook",
  spec: z.object({
    trigger: z
      .enum(["push", "pull_request", "manual", "schedule", "tag"])
      .optional(),
    branch: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  links: {
    repo: link.manyToOne("repo", {
      fk: "repoId",
      inverse: "pipelineRuns",
      required: true,
    }),
  },
})

export const WorkTrackerProvider = defineEntity("workTrackerProvider", {
  namespace: "build",
  prefix: "wtp",
  plural: "workTrackerProviders",
  description: "Work tracking provider (Jira, Linear)",
  spec: z.object({
    apiUrl: z.string().optional(),
    status: z.enum(["active", "inactive", "error"]).optional(),
    syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  }),
  links: {
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "workTrackerProviders",
    }),
  },
})

export const WorkTrackerProject = defineEntity("workTrackerProject", {
  namespace: "build",
  prefix: "wtpj",
  plural: "workTrackerProjects",
  description: "Project in a work tracker (Jira project, Linear team)",
  spec: z.object({
    key: z.string().optional(),
    url: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    workTrackerProvider: link.manyToOne("workTrackerProvider", {
      fk: "workTrackerProviderId",
      inverse: "projects",
      required: true,
    }),
  },
})

// TODO: workItem needs a slug column
export const WorkItem = defineEntity("workItem", {
  namespace: "build",
  prefix: "wi",
  plural: "workItems",
  description: "Issue or ticket from a work tracker",
  spec: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["critical", "high", "medium", "low", "none"]).optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "workItems",
    }),
    workTrackerProvider: link.manyToOne("workTrackerProvider", {
      fk: "workTrackerProviderId",
      inverse: "workItems",
      required: true,
    }),
  },
})

// TODO: systemVersion needs a slug column
export const SystemVersion = defineEntity("systemVersion", {
  namespace: "build",
  prefix: "sver",
  plural: "systemVersions",
  description: "Versioned release of a system in the build pipeline",
  spec: z.object({
    compatibilityRange: z.string().optional(),
    commitSha: z.string().optional(),
    releaseNotes: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "versions",
      required: true,
    }),
  },
})

// ===========================================================================
// Commerce namespace
// ===========================================================================

export const Customer = defineEntity("customer", {
  namespace: "commerce",
  prefix: "cust",
  plural: "customers",
  description: "Customer account for billing and entitlements",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    type: z.enum(["direct", "reseller", "partner"]).optional(),
    status: z.enum(["trial", "active", "suspended", "terminated"]).optional(),
    billingEmail: z.string().optional(),
    companyName: z.string().optional(),
  }),
  links: {},
})

export const Plan = defineEntity("plan", {
  namespace: "commerce",
  prefix: "pln",
  plural: "plans",
  description: "Pricing/subscription plan",
  spec: z.object({
    description: z.string().optional(),
    price: z.number().optional(),
    billingInterval: z.enum(["monthly", "yearly"]).optional(),
    currency: z.string().optional(),
    trialDays: z.number().optional(),
    isPublic: z.boolean().optional(),
  }),
  links: {},
})

// TODO: subscription needs a slug column
export const Subscription = defineEntity("subscription", {
  namespace: "commerce",
  prefix: "csub",
  plural: "subscriptions",
  description: "Customer subscription to a plan",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    status: z
      .enum(["active", "past_due", "cancelled", "trialing", "paused"])
      .optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
  }),
  links: {
    customer: link.manyToOne("customer", {
      fk: "customerId",
      inverse: "subscriptions",
      required: true,
    }),
    plan: link.manyToOne("plan", {
      fk: "planId",
      inverse: "subscriptions",
      required: true,
    }),
  },
})

export const BillableMetric = defineEntity("billableMetric", {
  namespace: "commerce",
  prefix: "bmet",
  plural: "billableMetrics",
  description: "Usage metric for billing",
  spec: z.object({
    aggregation: z.enum(["sum", "count", "max", "unique", "last"]).optional(),
    eventName: z.string().optional(),
    property: z.string().optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      inverse: "billableMetrics",
    }),
  },
})

// ===========================================================================
// Junction entities — many-to-many relationships as first-class entities
// ===========================================================================

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

export const ThreadChannel = defineEntity("thread-channel", {
  namespace: "org",
  prefix: "tc",
  plural: "threadChannels",
  description: "Links a thread to additional channels (surfaces) for mirroring",
  traits: [Junction],
  spec: z.object({
    role: z.string().optional(),
    status: z.enum(["connected", "detached", "paused"]).optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "threadChannels",
      required: true,
      cascade: "delete",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "threadChannels",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ReleaseArtifactPin = defineEntity("release-artifact-pin", {
  namespace: "software",
  prefix: "rap",
  plural: "releaseArtifactPins",
  description: "Links a release to a specific artifact version",
  traits: [Junction],
  spec: z.object({}),
  links: {
    release: link.manyToOne("release", {
      fk: "releaseId",
      inverse: "artifactPins",
      required: true,
      cascade: "delete",
    }),
    artifact: link.manyToOne("artifact", {
      fk: "artifactId",
      inverse: "releasePins",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ComponentArtifact = defineEntity("component-artifact", {
  namespace: "build",
  prefix: "cart",
  plural: "componentArtifacts",
  description:
    "Links a system version's component to a specific artifact build",
  traits: [Junction],
  spec: z.object({}),
  links: {
    systemVersion: link.manyToOne("systemVersion", {
      fk: "systemVersionId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
    artifact: link.manyToOne("artifact", {
      fk: "artifactId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
  },
})

export const SubscriptionItem = defineEntity("subscription-item", {
  namespace: "commerce",
  prefix: "subi",
  plural: "subscriptionItems",
  description: "Links a subscription to a capability with usage tracking",
  traits: [Junction],
  spec: z.object({
    status: z.enum(["active", "suspended", "revoked"]).optional(),
    quantity: z.number().optional(),
    usageLimit: z.number().optional(),
  }),
  links: {
    subscription: link.manyToOne("subscription", {
      fk: "subscriptionId",
      inverse: "items",
      required: true,
      cascade: "delete",
    }),
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      inverse: "subscriptionItems",
    }),
  },
})

export const EntitlementBundle = defineEntity("entitlement-bundle", {
  namespace: "commerce",
  prefix: "bndl",
  plural: "entitlementBundles",
  description: "Bundle of signed entitlements for a customer",
  spec: z.object({
    issuer: z.string().optional(),
    bundleVersion: z.number().optional(),
    capabilities: z.array(z.string()).optional(),
    maxSites: z.number().optional(),
  }),
  links: {
    customer: link.manyToOne("customer", {
      fk: "customerId",
      inverse: "entitlementBundles",
      required: true,
    }),
  },
})

// ===========================================================================
// Compiled ontology
// ===========================================================================

export const FactoryOntology = compileOntology(
  [
    // Org
    Team,
    Principal,
    Agent,
    Scope,
    IdentityLink,
    Channel,
    Thread,
    Document,
    Event,
    EventSubscription,
    ConfigVar,
    OrgSecret,
    // Infra
    Estate,
    Host,
    Realm,
    Service,
    Route,
    DnsDomain,
    IpAddress,
    NetworkLink,
    // Software
    System,
    Component,
    SoftwareApi,
    Artifact,
    Release,
    Template,
    Product,
    Capability,
    // Ops
    Site,
    Tenant,
    SystemDeployment,
    DeploymentSet,
    ComponentDeployment,
    Rollout,
    OpsDatabase,
    WorkbenchSnapshot,
    Workbench,
    // Build
    GitHostProvider,
    Repo,
    PipelineRun,
    WorkTrackerProvider,
    WorkTrackerProject,
    WorkItem,
    SystemVersion,
    // Commerce
    Customer,
    Plan,
    Subscription,
    BillableMetric,
    // Junctions
    Membership,
    RealmHost,
    ProductSystem,
    ThreadParticipant,
    ThreadChannel,
    ReleaseArtifactPin,
    ComponentArtifact,
    SubscriptionItem,
    EntitlementBundle,
  ],
  { traits: [Reconcilable, Bitemporal, TeamOwned, Addressable, Junction] }
)
