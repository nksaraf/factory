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

const fleet: EntityDef[] = [
  { module: "fleet", entity: "sites", label: "Sites" },
  { module: "fleet", entity: "tenants", label: "Tenants" },
  { module: "fleet", entity: "system-deployments", label: "System Deployments" },
  { module: "fleet", entity: "component-deployments", label: "Component Deployments" },
  { module: "fleet", entity: "deployment-sets", label: "Deployment Sets" },
  { module: "fleet", entity: "rollouts", label: "Rollouts" },
  { module: "fleet", entity: "workspaces", label: "Workspaces" },
  { module: "fleet", entity: "workbenches", label: "Workbenches" },
  { module: "fleet", entity: "previews", label: "Previews" },
  { module: "fleet", entity: "interventions", label: "Interventions" },
  { module: "fleet", entity: "databases", label: "Databases" },
  { module: "fleet", entity: "install-manifests", label: "Install Manifests" },
  { module: "fleet", entity: "site-manifests", label: "Site Manifests" },
  { module: "fleet", entity: "anonymization-profiles", label: "Anonymization Profiles" },
  { module: "fleet", entity: "forwarded-ports", label: "Forwarded Ports" },
  { module: "fleet", entity: "connection-audit", label: "Connection Audit" },
]

const infra: EntityDef[] = [
  { module: "infra", entity: "substrates", label: "Substrates" },
  { module: "infra", entity: "hosts", label: "Hosts" },
  { module: "infra", entity: "runtimes", label: "Runtimes" },
  { module: "infra", entity: "routes", label: "Routes" },
  { module: "infra", entity: "dns-domains", label: "DNS Domains" },
  { module: "infra", entity: "tunnels", label: "Tunnels" },
  { module: "infra", entity: "ip-addresses", label: "IP Addresses" },
  { module: "infra", entity: "secrets", label: "Secrets" },
  { module: "infra", entity: "network-links", label: "Network Links" },
]

const org: EntityDef[] = [
  { module: "org", entity: "teams", label: "Teams" },
  { module: "org", entity: "principals", label: "Principals" },
  { module: "org", entity: "scopes", label: "Scopes" },
]

const build: EntityDef[] = [
  { module: "build", entity: "repos", label: "Repos" },
  { module: "build", entity: "git-host-providers", label: "Git Host Providers" },
  { module: "build", entity: "work-tracker-providers", label: "Work Tracker Providers" },
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
  { module: "fleet", label: "Fleet", entities: fleet },
  { module: "infra", label: "Infra", entities: infra },
  { module: "org", label: "Org", entities: org },
  { module: "build", label: "Build", entities: build },
  { module: "product", label: "Product", entities: product },
  { module: "messaging", label: "Messaging", entities: messaging },
  { module: "agent", label: "Agent", entities: agent },
  { module: "commerce", label: "Commerce", entities: commerce },
]

export const ALL_ENTITIES: EntityDef[] = MODULE_GROUPS.flatMap((g) => g.entities)
