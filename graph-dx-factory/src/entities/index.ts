import { z } from "zod"
import {
  defineEntity,
  link,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Addressable,
} from "@smp/graph"

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
    members: link.oneToMany("principal", {
      targetFk: "primaryTeamId",
      description: "Team members via primary team assignment",
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
// Commerce namespace
// ---------------------------------------------------------------------------

export const Customer = defineEntity("customer", {
  namespace: "commerce",
  prefix: "cust",
  description: "A billing customer — company or individual with subscriptions",
  traits: [Bitemporal],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    type: z.enum(["direct", "reseller", "partner"]),
    status: z.enum(["trial", "active", "suspended", "terminated"]),
    billingEmail: z.string().optional(),
    companyName: z.string().optional(),
    stripeId: z.string().optional(),
    website: z.string().optional(),
    address: z
      .object({
        line1: z.string().optional(),
        line2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
      })
      .optional(),
  }),
  links: {
    subscriptions: link.oneToMany("subscription", {
      targetFk: "customerId",
      inverse: "customer",
    }),
    entitlementBundles: link.oneToMany("entitlementBundle", {
      targetFk: "customerId",
      inverse: "customer",
    }),
  },
})

export const Plan = defineEntity("plan", {
  namespace: "commerce",
  prefix: "pln",
  description:
    "A billing plan with pricing, interval, and included capabilities",
  metadata: "standard",
  spec: z.object({
    type: z.enum(["base", "add-on", "suite"]),
    description: z.string().optional(),
    price: z.number(),
    billingInterval: z.enum(["monthly", "yearly"]),
    currency: z.string(),
    includedCapabilities: z.array(z.string()).optional(),
    trialDays: z.number().optional(),
    isPublic: z.boolean().optional(),
    stripePriceId: z.string().optional(),
  }),
  links: {
    subscriptions: link.oneToMany("subscription", {
      targetFk: "planId",
      inverse: "plan",
    }),
  },
})

export const Subscription = defineEntity("subscription", {
  namespace: "commerce",
  prefix: "csub",
  description:
    "A customer's subscription to a plan with billing period and status",
  traits: [Bitemporal],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    status: z.enum(["active", "past_due", "cancelled", "trialing", "paused"]),
    currentPeriodStart: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    trialEndsAt: z.string().optional(),
    stripeSubscriptionId: z.string().optional(),
    cancelledAt: z.string().optional(),
    cancelReason: z.string().optional(),
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
    items: link.oneToMany("subscriptionItem", {
      targetFk: "subscriptionId",
      inverse: "subscription",
    }),
  },
})

export const SubscriptionItem = defineEntity("subscriptionItem", {
  namespace: "commerce",
  prefix: "subi",
  plural: "subscriptionItems",
  description: "A line item within a subscription tied to a capability",
  spec: z.object({
    status: z.enum(["active", "suspended", "revoked"]),
    quantity: z.number().optional(),
    usageLimit: z.number().optional(),
    overagePolicy: z.enum(["block", "charge", "notify"]).optional(),
    currentUsage: z.number().optional(),
    lastResetAt: z.string().optional(),
  }),
  links: {
    subscription: link.manyToOne("subscription", {
      fk: "subscriptionId",
      inverse: "items",
      required: true,
    }),
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      description: "The software capability this item grants access to",
    }),
  },
})

export const EntitlementBundle = defineEntity("entitlementBundle", {
  namespace: "commerce",
  prefix: "bndl",
  plural: "entitlementBundles",
  description:
    "A signed capability bundle issued to a customer from their subscriptions",
  spec: z.object({
    signedPayload: z.string(),
    signature: z.string(),
    issuer: z.string(),
    bundleVersion: z.number(),
    expiresAt: z.string(),
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

export const BillableMetric = defineEntity("billableMetric", {
  namespace: "commerce",
  prefix: "bmet",
  plural: "billableMetrics",
  description: "A usage-based metric tied to a capability for metered billing",
  spec: z.object({
    aggregation: z.enum(["sum", "count", "max", "unique", "last"]),
    eventName: z.string(),
    property: z.string().optional(),
    resetInterval: z
      .enum(["billing_period", "daily", "monthly", "never"])
      .optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      description: "The software capability this metric measures usage for",
    }),
  },
})
