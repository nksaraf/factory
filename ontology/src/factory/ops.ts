import { z } from "zod"
import { defineEntity, link, Reconcilable, Bitemporal } from "../schema/index"

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
