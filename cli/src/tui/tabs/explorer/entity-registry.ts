import type { EntityKind } from "@smp/factory-shared/schemas/org"

export interface EntityDef {
  module: string
  entity: string
  label: string
}

export interface ModuleGroup {
  module: string
  label: string
  entities: EntityDef[]
}

const ops: EntityDef[] = [
  { module: "ops", entity: "sites", label: "Sites" },
  { module: "ops", entity: "tenants", label: "Tenants" },
  {
    module: "ops",
    entity: "system-deployments",
    label: "System Deployments",
  },
  {
    module: "ops",
    entity: "component-deployments",
    label: "Component Deployments",
  },
  { module: "ops", entity: "deployment-sets", label: "Deployment Sets" },
  { module: "ops", entity: "rollouts", label: "Rollouts" },
  { module: "ops", entity: "workbenches", label: "Workbenches" },
  { module: "ops", entity: "previews", label: "Previews" },
  { module: "ops", entity: "interventions", label: "Interventions" },
  { module: "ops", entity: "databases", label: "Databases" },
  { module: "ops", entity: "install-manifests", label: "Install Manifests" },
  { module: "ops", entity: "site-manifests", label: "Site Manifests" },
  {
    module: "ops",
    entity: "anonymization-profiles",
    label: "Anonymization Profiles",
  },
  { module: "ops", entity: "forwarded-ports", label: "Forwarded Ports" },
  { module: "ops", entity: "connection-audit", label: "Connection Audit" },
]

const infra: EntityDef[] = [
  { module: "infra", entity: "estates", label: "Estates" },
  { module: "infra", entity: "hosts", label: "Hosts" },
  { module: "infra", entity: "realms", label: "Realms" },
  { module: "infra", entity: "routes", label: "Routes" },
  { module: "infra", entity: "dns-domains", label: "DNS Domains" },
  { module: "infra", entity: "tunnels", label: "Tunnels" },
  { module: "infra", entity: "ip-addresses", label: "IP Addresses" },
  { module: "infra", entity: "secrets", label: "Secrets" },
  { module: "infra", entity: "services", label: "Services" },
  { module: "infra", entity: "network-links", label: "Network Links" },
]

const org: EntityDef[] = [
  { module: "org", entity: "teams", label: "Teams" },
  { module: "org", entity: "principals", label: "Principals" },
  { module: "org", entity: "scopes", label: "Scopes" },
  {
    module: "org",
    entity: "entity-relationships",
    label: "Entity Relationships",
  },
]

const build: EntityDef[] = [
  { module: "build", entity: "repos", label: "Repos" },
  {
    module: "build",
    entity: "git-host-providers",
    label: "Git Host Providers",
  },
  {
    module: "build",
    entity: "work-tracker-providers",
    label: "Work Tracker Providers",
  },
  {
    module: "build",
    entity: "work-tracker-projects",
    label: "Work Tracker Projects",
  },
  { module: "build", entity: "pipeline-runs", label: "Pipeline Runs" },
]

const product: EntityDef[] = [
  { module: "product", entity: "systems", label: "Systems" },
  { module: "product", entity: "components", label: "Components" },
  { module: "product", entity: "apis", label: "APIs" },
  { module: "product", entity: "artifacts", label: "Artifacts" },
  { module: "product", entity: "releases", label: "Releases" },
  { module: "product", entity: "templates", label: "Templates" },
  { module: "product", entity: "products", label: "Products" },
  { module: "product", entity: "capabilities", label: "Capabilities" },
]

const messaging: EntityDef[] = [
  { module: "messaging", entity: "providers", label: "Providers" },
]

const agent: EntityDef[] = [
  { module: "agent", entity: "agents", label: "Agents" },
  { module: "agent", entity: "presets", label: "Role Presets" },
  { module: "agent", entity: "jobs", label: "Jobs" },
  { module: "agent", entity: "memories", label: "Memories" },
]

const commerce: EntityDef[] = [
  { module: "commerce", entity: "customers", label: "Customers" },
  { module: "commerce", entity: "plans", label: "Plans" },
  { module: "commerce", entity: "subscriptions", label: "Subscriptions" },
  { module: "commerce", entity: "billable-metrics", label: "Billable Metrics" },
]

export const MODULE_GROUPS: ModuleGroup[] = [
  { module: "ops", label: "Ops", entities: ops },
  { module: "infra", label: "Infra", entities: infra },
  { module: "org", label: "Org", entities: org },
  { module: "build", label: "Build", entities: build },
  { module: "product", label: "Product", entities: product },
  { module: "messaging", label: "Messaging", entities: messaging },
  { module: "agent", label: "Agent", entities: agent },
  { module: "commerce", label: "Commerce", entities: commerce },
]

export const ALL_ENTITIES: EntityDef[] = MODULE_GROUPS.flatMap(
  (g) => g.entities
)

/**
 * Map ID prefixes (e.g. "est" from "est_xxx") to their entity definition.
 * Used to resolve foreign key references in the explorer.
 */
const PREFIX_TO_ENTITY: Record<string, EntityDef> = {
  // infra
  est: { module: "infra", entity: "estates", label: "Estates" },
  host: { module: "infra", entity: "hosts", label: "Hosts" },
  rlm: { module: "infra", entity: "realms", label: "Realms" },
  rte: { module: "infra", entity: "routes", label: "Routes" },
  dom: { module: "infra", entity: "dns-domains", label: "DNS Domains" },
  tnl: { module: "infra", entity: "tunnels", label: "Tunnels" },
  ipa: { module: "infra", entity: "ip-addresses", label: "IP Addresses" },
  sec: { module: "infra", entity: "secrets", label: "Secrets" },
  svc: { module: "infra", entity: "services", label: "Services" },
  nlnk: { module: "infra", entity: "network-links", label: "Network Links" },
  // org
  team: { module: "org", entity: "teams", label: "Teams" },
  prin: { module: "org", entity: "principals", label: "Principals" },
  scope: { module: "org", entity: "scopes", label: "Scopes" },
  erel: {
    module: "org",
    entity: "entity-relationships",
    label: "Entity Relationships",
  },
  agt: { module: "agent", entity: "agents", label: "Agents" },
  rpre: { module: "agent", entity: "presets", label: "Role Presets" },
  job: { module: "agent", entity: "jobs", label: "Jobs" },
  mem: { module: "agent", entity: "memories", label: "Memories" },
  msgp: { module: "messaging", entity: "providers", label: "Providers" },
  // software / product
  sys: { module: "product", entity: "systems", label: "Systems" },
  cmp: { module: "product", entity: "components", label: "Components" },
  api: { module: "product", entity: "apis", label: "APIs" },
  art: { module: "product", entity: "artifacts", label: "Artifacts" },
  rel: { module: "product", entity: "releases", label: "Releases" },
  tmpl: { module: "product", entity: "templates", label: "Templates" },
  prod: { module: "product", entity: "products", label: "Products" },
  cap: { module: "product", entity: "capabilities", label: "Capabilities" },
  // ops
  site: { module: "ops", entity: "sites", label: "Sites" },
  tnt: { module: "ops", entity: "tenants", label: "Tenants" },
  sdp: {
    module: "ops",
    entity: "system-deployments",
    label: "System Deployments",
  },
  cdp: {
    module: "ops",
    entity: "component-deployments",
    label: "Component Deployments",
  },
  dset: {
    module: "ops",
    entity: "deployment-sets",
    label: "Deployment Sets",
  },
  rout: { module: "ops", entity: "rollouts", label: "Rollouts" },
  wbnch: { module: "ops", entity: "workbenches", label: "Workbenches" },
  prev: { module: "ops", entity: "previews", label: "Previews" },
  intv: { module: "ops", entity: "interventions", label: "Interventions" },
  db: { module: "ops", entity: "databases", label: "Databases" },
  aprf: {
    module: "ops",
    entity: "anonymization-profiles",
    label: "Anonymization Profiles",
  },
  fp: { module: "ops", entity: "forwarded-ports", label: "Forwarded Ports" },
  // build
  repo: { module: "build", entity: "repos", label: "Repos" },
  ghp: {
    module: "build",
    entity: "git-host-providers",
    label: "Git Host Providers",
  },
  wtp: {
    module: "build",
    entity: "work-tracker-providers",
    label: "Work Tracker Providers",
  },
  wtpj: {
    module: "build",
    entity: "work-tracker-projects",
    label: "Work Tracker Projects",
  },
  prun: { module: "build", entity: "pipeline-runs", label: "Pipeline Runs" },
  // commerce
  cust: { module: "commerce", entity: "customers", label: "Customers" },
  pln: { module: "commerce", entity: "plans", label: "Plans" },
  csub: { module: "commerce", entity: "subscriptions", label: "Subscriptions" },
  bmet: {
    module: "commerce",
    entity: "billable-metrics",
    label: "Billable Metrics",
  },
}

/** Extract the prefix from an entity ID like "est_cmnmcgq0f..." → "est" */
export function extractIdPrefix(id: string): string | null {
  const idx = id.indexOf("_")
  return idx > 0 ? id.slice(0, idx) : null
}

/** Resolve an entity ID to its entity definition via prefix */
export function resolveEntityById(id: string): EntityDef | null {
  const prefix = extractIdPrefix(id)
  return prefix ? (PREFIX_TO_ENTITY[prefix] ?? null) : null
}

const ENTITY_KIND_BY_PATH: Record<string, EntityKind> = {
  "product/systems": "system",
  "product/components": "component",
  "product/apis": "api",
  "product/artifacts": "artifact",
  "product/releases": "release",
  "product/products": "product",
  "product/capabilities": "capability",
  "org/teams": "team",
  "agent/agents": "agent",
  "infra/hosts": "host",
  "infra/realms": "realm",
  "infra/routes": "route",
  "build/repos": "repo",
  "build/work-tracker-projects": "work-tracker-project",
  "build/work-items": "work-item",
  "build/git-host-providers": "git-host-provider",
  "build/work-tracker-providers": "work-tracker-provider",
}

export function entityToKind(entity: EntityDef): EntityKind | null {
  return ENTITY_KIND_BY_PATH[`${entity.module}/${entity.entity}`] ?? null
}
