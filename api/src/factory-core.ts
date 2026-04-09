/**
 * Shared PGlite utilities for local factory daemon and test helpers.
 *
 * This module provides the PGlite-compatible migrator, database creation,
 * and local infrastructure seeding used by both the CLI local daemon and
 * the vitest test context.
 */

import fs from "node:fs"
import path from "node:path"

import { cors } from "@elysiajs/cors"
import { PGlite } from "@electric-sql/pglite"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "./db/connection"
import * as schema from "./db/schema"
import { substrate, runtime } from "./db/schema/infra-v2"
import { principal } from "./db/schema/org-v2"
import type { SubstrateSpec, RuntimeSpec, RouteSpec, DnsDomainSpec } from "@smp/factory-shared/schemas/infra"
import type { SiteSpec, SystemDeploymentSpec, WorkspaceSpec, PreviewSpec, ComponentDeploymentSpec } from "@smp/factory-shared/schemas/ops"
import type { SystemSpec, GenericComponentSpec } from "@smp/factory-shared/schemas/software"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import { provider, cluster } from "./db/schema/infra"
import { KubeClientImpl } from "./lib/kube-client-impl"
import { healthController } from "./modules/health/index"
import { startGateway } from "./modules/infra/gateway-proxy"
import { secretController } from "./modules/identity/secret.controller"
import { configVarController } from "./modules/identity/config-var.controller"
import { Reconciler } from "./reconciler/reconciler"
import { productControllerV2 } from "./modules/product/index.v2"
import { buildControllerV2 } from "./modules/build/index.v2"
import { commerceControllerV2 } from "./modules/commerce/index.v2"
import { fleetControllerV2 } from "./modules/fleet/index.v2"
import { infraControllerV2 } from "./modules/infra/index.v2"
import { agentControllerV2 } from "./modules/agent/index.v2"
import { identityControllerV2 } from "./modules/identity/index.v2"
import { messagingControllerV2 } from "./modules/messaging/index.v2"
import { operationsController } from "./modules/system/operations.controller"
import { workflowController } from "./modules/workflow/triggers/rest"
import { observabilityController } from "./modules/observability/index"
import { NoopObservabilityAdapter } from "./adapters/observability-adapter-noop"
import { DemoObservabilityAdapter } from "./adapters/observability-adapter-demo"
import { orgTeam } from "./db/schema/org"
import { productModule } from "./db/schema/product"
import { fleetSite, release, deploymentTarget, sandbox, preview } from "./db/schema/fleet"
import { route as gwRoute, domain } from "./db/schema/gateway"
import { customerAccount } from "./db/schema/commerce"
import { repo, pipelineRun, gitHostProvider } from "./db/schema/build"
import { site, systemDeployment, workspace, componentDeployment, preview as opsPreview } from "./db/schema/ops"
import { system, component } from "./db/schema/software-v2"
import { route as infraRoute, dnsDomain } from "./db/schema/infra-v2"
import { newId } from "./lib/id"

/**
 * PGlite cannot handle multi-statement SQL in a single prepared statement.
 * This custom migrator reads SQL files from the drizzle folder and executes
 * each statement individually.
 */
export async function migrateWithPglite(
  client: PGlite,
  migrationsFolder: string
) {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json")
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"))

  // Ensure migration tracking table exists
  await client.query(`CREATE SCHEMA IF NOT EXISTS public`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.factory_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `)

  const applied = await client.query<{ hash: string }>(
    `SELECT hash FROM public.factory_migrations`
  )
  const appliedHashes = new Set(applied.rows.map((r) => r.hash))

  for (const entry of journal.entries) {
    if (appliedHashes.has(entry.tag)) continue

    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlFile)) continue

    const content = fs.readFileSync(sqlFile, "utf-8")
    // Drizzle migrations use --> statement-breakpoint as delimiter;
    // some hand-written migrations use plain semicolons instead.
    const hasBreakpoints = content.includes("--> statement-breakpoint")
    const raw = hasBreakpoints
      ? content.split(/-->\s*statement-breakpoint/)
      : content.split(/;\s*\n/)
    const statements = raw
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim()
      )
      .filter((s) => s.length > 0)

    for (const stmt of statements) {
      try {
        await client.query(stmt)
      } catch (err: any) {
        // PGlite doesn't support some extensions (e.g. btree_gist) — skip gracefully
        if (err?.code === "0A000" && stmt.includes("CREATE EXTENSION")) continue
        // PGlite lacks gist operator classes needed for EXCLUDE constraints — skip
        if (err?.code === "42704" && stmt.includes("EXCLUDE USING gist")) continue
        // PGlite may not support materialized views or PL/pgSQL functions — skip gracefully
        if (stmt.includes("MATERIALIZED VIEW") || stmt.includes("LANGUAGE plpgsql")) continue
        throw err
      }
    }

    await client.query(
      `INSERT INTO public.factory_migrations (hash, created_at) VALUES ($1, $2)`,
      [entry.tag, Date.now()]
    )
  }
}

/**
 * Create a PGlite-backed Drizzle database.
 * @param dataDir - Persistent data directory. If omitted, uses in-memory PGlite.
 */
export async function createPgliteDb(dataDir?: string) {
  const client = dataDir ? new PGlite(dataDir) : new PGlite()
  // Filter out ESM namespace re-exports (export * as X) — they have null
  // prototypes which crash drizzle's is() inside extractTablesRelationalConfig.
  const tableSchema = Object.fromEntries(
    Object.entries(schema).filter(
      ([_, v]) => v != null && typeof v === "object" && Object.getPrototypeOf(v) !== null
    )
  )
  const db = drizzlePglite(client, { schema: tableSchema }) as unknown as Database
  return { client, db }
}

export interface SeedLocalInfraOptions {
  kubeconfigPath?: string
  clusterName?: string
}

/**
 * Seed the local substrate and runtime rows if they don't already exist.
 * Used by the local daemon to ensure a "local" substrate and k3d runtime
 * are registered in the database.
 */
export async function seedLocalInfra(
  db: Database,
  opts: SeedLocalInfraOptions = {}
) {
  const { kubeconfigPath, clusterName = "dx-local" } = opts

  // Read kubeconfig content — always store inline YAML, never file paths.
  // This makes kubeconfigRef portable across host, Docker, and remote servers.
  const kubeconfigContent = kubeconfigPath && fs.existsSync(kubeconfigPath)
    ? fs.readFileSync(kubeconfigPath, "utf-8")
    : kubeconfigPath // already inline content or undefined

  // Upsert anonymous principal for local dev (no auth)
  const [existingPrincipal] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(eq(principal.slug, "anonymous"))
    .limit(1)
  if (!existingPrincipal) {
    await db.insert(principal).values({
      id: "anonymous",
      slug: "anonymous",
      name: "Anonymous",
      type: "service-account",
      spec: { status: "active" } satisfies PrincipalSpec,
    })
  }

  // Upsert local substrate (was: provider)
  const [existing] = await db
    .select({ id: substrate.id })
    .from(substrate)
    .where(eq(substrate.slug, "local"))
    .limit(1)

  let substrateId: string
  if (existing) {
    substrateId = existing.id
  } else {
    const [row] = await db
      .insert(substrate)
      .values({
        name: "Local",
        slug: "local",
        type: "datacenter",
        spec: { providerKind: "bare-metal", lifecycle: "active", syncStatus: "idle", metadata: {} } satisfies SubstrateSpec,
      })
      .returning({ id: substrate.id })
    substrateId = row!.id
  }

  // Upsert local runtime (was: cluster)
  const [existingRuntime] = await db
    .select({ id: runtime.id, spec: runtime.spec })
    .from(runtime)
    .where(eq(runtime.slug, clusterName))
    .limit(1)

  if (!existingRuntime) {
    await db.insert(runtime).values({
      name: clusterName,
      slug: clusterName,
      type: "k8s-cluster",
      spec: { status: "ready", isDefault: true, kubeconfigRef: kubeconfigContent ?? undefined },
    })
  } else if (kubeconfigContent) {
    const spec = (existingRuntime.spec ?? {}) as Record<string, unknown>
    await db
      .update(runtime)
      .set({ spec: { ...spec, kubeconfigRef: kubeconfigContent, isDefault: true } as RuntimeSpec })
      .where(eq(runtime.id, existingRuntime.id))
  }
}

/**
 * Create a stripped-down Elysia app for local use — infra controllers only,
 * no auth middleware.  Used by the CLI local daemon and potentially test helpers.
 */
export function createLocalApp(db: Database, reconciler: Reconciler | null, opts?: { full?: boolean; demo?: boolean }) {
  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", db)
    .use(productControllerV2(db))
    .use(buildControllerV2(db))
    .use(commerceControllerV2(db))
    .use(fleetControllerV2(db))
    .use(infraControllerV2(db))
    .use(agentControllerV2(db))
    .use(identityControllerV2(db))
    .use(secretController(db))
    .use(configVarController(db))
    .use(messagingControllerV2(db))
    .use(operationsController())
    .use(workflowController(db))

  if (opts?.full) {
    factoryRoutes
      .use(observabilityController(opts?.demo ? new DemoObservabilityAdapter() : new NoopObservabilityAdapter()))
  }

  return new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes)
}

/**
 * Seed rich demo data for TUI dashboard testing.
 * Idempotent — checks if demo data already exists before inserting.
 */
export async function seedDemoData(db: Database) {
  // Check if already seeded (use v2 substrate table)
  const [existing] = await db
    .select({ id: substrate.id })
    .from(substrate)
    .where(eq(substrate.slug, "proxmox-dc1"))
    .limit(1)
  if (existing) {
    console.log("[seed-demo] Demo data already present, skipping.")
    return
  }

  console.log("[seed-demo] Seeding demo data...")

  // ── Phase 1: Org teams ──
  const teamIds = {
    root: newId("team"),
    engineering: newId("team"),
    platform: newId("team"),
    networkAccess: newId("team"),
    smartInventory: newId("team"),
    smartOps: newId("team"),
    smartSignal: newId("team"),
    smartMarket: newId("team"),
    trafficure: newId("team"),
    neo360: newId("team"),
  }

  await db.insert(orgTeam).values([
    { teamId: teamIds.root, name: "Lepton", slug: "lepton", type: "business-unit", description: "Lepton Technologies" },
    { teamId: teamIds.engineering, name: "Engineering", slug: "engineering", type: "product-area", parentTeamId: teamIds.root, description: "All engineering" },
    { teamId: teamIds.platform, name: "Platform", slug: "platform", type: "product-area", parentTeamId: teamIds.root, description: "Infrastructure & DevEx" },
    { teamId: teamIds.networkAccess, name: "Network Access", slug: "team-network-access", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.smartInventory, name: "Smart Inventory", slug: "team-smart-inventory", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.smartOps, name: "SmartOps", slug: "team-smartops", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.smartSignal, name: "Smart Signal", slug: "team-smart-signal", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.smartMarket, name: "SmartMarket", slug: "team-smartmarket", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.trafficure, name: "Trafficure", slug: "team-trafficure", type: "team", parentTeamId: teamIds.engineering },
    { teamId: teamIds.neo360, name: "Neo360", slug: "team-neo360", type: "team", parentTeamId: teamIds.engineering },
  ])

  // ── Phase 2: Substrates (was: Providers) ──
  const substrateRows: Array<{ name: string; slug: string; type: string; spec: SubstrateSpec }> = [
    { name: "Proxmox DC1", slug: "proxmox-dc1", type: "datacenter", spec: { providerKind: "proxmox", lifecycle: "active", syncStatus: "idle", metadata: {} } },
    { name: "Proxmox DC2", slug: "proxmox-dc2", type: "datacenter", spec: { providerKind: "proxmox", lifecycle: "active", syncStatus: "idle", metadata: {} } },
    { name: "AWS US-East", slug: "aws-us-east", type: "cloud-account", spec: { providerKind: "aws", lifecycle: "active", syncStatus: "idle", metadata: {} } },
  ]
  const insertedSubstrates = await db.insert(substrate).values(substrateRows).returning({ id: substrate.id, slug: substrate.slug })
  const substrateMap: Record<string, string> = {}
  for (const s of insertedSubstrates) substrateMap[s.slug] = s.id

  // ── Phase 3: Runtimes (was: Clusters) ──
  const runtimeRows: Array<{ name: string; slug: string; type: string; spec: RuntimeSpec }> = [
    { name: "prod-us-east", slug: "prod-us-east", type: "k8s-cluster", spec: { status: "ready", endpoint: "10.0.1.10:6443" } },
    { name: "prod-eu-west", slug: "prod-eu-west", type: "k8s-cluster", spec: { status: "ready", endpoint: "10.0.2.10:6443" } },
    { name: "staging-us", slug: "staging-us", type: "k8s-cluster", spec: { status: "ready", endpoint: "10.0.1.20:6443" } },
    { name: "dev-sandbox", slug: "dev-sandbox", type: "k8s-cluster", spec: { status: "ready", endpoint: "10.0.1.30:6443" } },
    { name: "preview-us-east", slug: "preview-us-east", type: "k8s-cluster", spec: { status: "ready", endpoint: "eks-preview.us-east-1.amazonaws.com" } },
    { name: "edge-latam", slug: "edge-latam", type: "k8s-cluster", spec: { status: "provisioning" } },
    { name: "dr-us-west", slug: "dr-us-west", type: "k8s-cluster", spec: { status: "degraded" } },
  ]
  const insertedRuntimes = await db.insert(runtime).values(runtimeRows).returning({ id: runtime.id, slug: runtime.slug })
  const runtimeMap: Record<string, string> = {}
  for (const r of insertedRuntimes) runtimeMap[r.slug] = r.id

  // ── Phase 3b: Legacy provider/cluster rows (needed for v1 fleet FK constraints) ──
  const providerRows = [
    { name: "Proxmox DC1", slug: "proxmox-dc1", providerType: "proxmox", providerKind: "internal", status: "active" },
    { name: "Proxmox DC2", slug: "proxmox-dc2", providerType: "proxmox", providerKind: "internal", status: "active" },
    { name: "AWS US-East", slug: "aws-us-east", providerType: "aws", providerKind: "cloud", status: "active" },
  ]
  const insertedProviders = await db.insert(provider).values(providerRows).returning({ providerId: provider.providerId, slug: provider.slug })
  const providerMap: Record<string, string> = {}
  for (const p of insertedProviders) providerMap[p.slug] = p.providerId

  const clusterRows = [
    { name: "prod-us-east", slug: "prod-us-east", providerId: providerMap["proxmox-dc1"], status: "ready" as const, endpoint: "10.0.1.10:6443" },
    { name: "prod-eu-west", slug: "prod-eu-west", providerId: providerMap["proxmox-dc2"], status: "ready" as const, endpoint: "10.0.2.10:6443" },
    { name: "staging-us", slug: "staging-us", providerId: providerMap["proxmox-dc1"], status: "ready" as const, endpoint: "10.0.1.20:6443" },
    { name: "dev-sandbox", slug: "dev-sandbox", providerId: providerMap["proxmox-dc1"], status: "ready" as const, endpoint: "10.0.1.30:6443" },
    { name: "preview-us-east", slug: "preview-us-east", providerId: providerMap["aws-us-east"], status: "ready" as const, endpoint: "eks-preview.us-east-1.amazonaws.com" },
    { name: "edge-latam", slug: "edge-latam", providerId: providerMap["aws-us-east"], status: "provisioning" as const },
    { name: "dr-us-west", slug: "dr-us-west", providerId: providerMap["aws-us-east"], status: "degraded" as const },
  ]
  const insertedClusters = await db.insert(cluster).values(clusterRows).returning({ clusterId: cluster.clusterId, slug: cluster.slug })
  const clusterMap: Record<string, string> = {}
  for (const c of insertedClusters) clusterMap[c.slug] = c.clusterId

  // ── Phase 4: Product modules ──
  const moduleRows = [
    { name: "Network Access API", slug: "network-access-api", teamId: teamIds.networkAccess, product: "network-access", description: "Core auth & session management" },
    { name: "Network Access Portal", slug: "network-access-portal", teamId: teamIds.networkAccess, product: "network-access", description: "Captive portal frontend" },
    { name: "Smart Inventory Core", slug: "smart-inventory-core", teamId: teamIds.smartInventory, product: "smart-inventory", description: "Inventory tracking engine" },
    { name: "Inventory Worker", slug: "inventory-worker", teamId: teamIds.smartInventory, product: "smart-inventory", description: "Async inventory sync jobs" },
    { name: "SmartOps Collector", slug: "smartops-collector", teamId: teamIds.smartOps, product: "smartops", description: "Telemetry data collector" },
    { name: "SmartOps Dashboard", slug: "smartops-dashboard", teamId: teamIds.smartOps, product: "smartops", description: "Operations dashboard UI" },
    { name: "Smart Signal Processor", slug: "smart-signal-processor", teamId: teamIds.smartSignal, product: "smart-signal", description: "Signal analysis pipeline" },
    { name: "SmartMarket Engine", slug: "smartmarket-engine", teamId: teamIds.smartMarket, product: "smartmarket", description: "Marketplace pricing engine" },
    { name: "SmartMarket Storefront", slug: "smartmarket-storefront", teamId: teamIds.smartMarket, product: "smartmarket", description: "Storefront web app" },
    { name: "Trafficure Gateway", slug: "trafficure-gateway", teamId: teamIds.trafficure, product: "trafficure", description: "Traffic management gateway" },
    { name: "Trafficure Analytics", slug: "trafficure-analytics", teamId: teamIds.trafficure, product: "trafficure", description: "Traffic analytics service" },
    { name: "Neo360 Platform", slug: "neo360-platform", teamId: teamIds.neo360, product: "neo360", description: "Customer 360 platform" },
    { name: "Factory CLI", slug: "factory-cli", teamId: teamIds.platform, product: "platform", description: "Developer CLI tooling" },
    { name: "Factory API", slug: "factory-api", teamId: teamIds.platform, product: "platform", description: "Control plane API" },
  ]
  const insertedModules = await db.insert(productModule).values(moduleRows).returning({ moduleId: productModule.moduleId, slug: productModule.slug })
  const moduleMap: Record<string, string> = {}
  for (const m of insertedModules) moduleMap[m.slug] = m.moduleId

  // ── Phase 5: Git host + Repos ──
  const [ghp] = await db.insert(gitHostProvider).values({
    name: "GitHub (Lepton)", slug: "github-lepton", hostType: "github",
    apiBaseUrl: "https://api.github.com", authMode: "github_app", status: "active",
    teamId: teamIds.root,
  }).returning({ gitHostProviderId: gitHostProvider.gitHostProviderId })

  const repoRows = [
    { name: "lepton/network-access", slug: "network-access", kind: "product-module" as const, moduleId: moduleMap["network-access-api"], teamId: teamIds.networkAccess, gitUrl: "git@github.com:lepton/network-access.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/smart-inventory", slug: "smart-inventory", kind: "product-module" as const, moduleId: moduleMap["smart-inventory-core"], teamId: teamIds.smartInventory, gitUrl: "git@github.com:lepton/smart-inventory.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/smartops", slug: "smartops", kind: "product-module" as const, moduleId: moduleMap["smartops-collector"], teamId: teamIds.smartOps, gitUrl: "git@github.com:lepton/smartops.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/smartmarket", slug: "smartmarket", kind: "product-module" as const, moduleId: moduleMap["smartmarket-engine"], teamId: teamIds.smartMarket, gitUrl: "git@github.com:lepton/smartmarket.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/trafficure", slug: "trafficure", kind: "product-module" as const, moduleId: moduleMap["trafficure-gateway"], teamId: teamIds.trafficure, gitUrl: "git@github.com:lepton/trafficure.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/neo360", slug: "neo360", kind: "product-module" as const, moduleId: moduleMap["neo360-platform"], teamId: teamIds.neo360, gitUrl: "git@github.com:lepton/neo360.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/factory", slug: "factory", kind: "platform-module" as const, moduleId: moduleMap["factory-api"], teamId: teamIds.platform, gitUrl: "git@github.com:lepton/factory.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
    { name: "lepton/infra", slug: "infra", kind: "infra" as const, teamId: teamIds.platform, gitUrl: "git@github.com:lepton/infra.git", defaultBranch: "main", gitHostProviderId: ghp.gitHostProviderId },
  ]
  const insertedRepos = await db.insert(repo).values(repoRows).returning({ repoId: repo.repoId, slug: repo.slug })
  const repoMap: Record<string, string> = {}
  for (const r of insertedRepos) repoMap[r.slug] = r.repoId

  // ── Phase 6: Pipeline runs (CI) ──
  const now = Date.now()
  await db.insert(pipelineRun).values([
    { repoId: repoMap["network-access"], triggerEvent: "push", triggerRef: "refs/heads/main", commitSha: "a1b2c3d", status: "success", triggerActor: "alice", startedAt: new Date(now - 3600_000), completedAt: new Date(now - 3450_000) },
    { repoId: repoMap["smart-inventory"], triggerEvent: "pull_request", triggerRef: "refs/heads/feat/barcode-scan", commitSha: "e4f5a6b", status: "running", triggerActor: "bob", startedAt: new Date(now - 120_000) },
    { repoId: repoMap["smartops"], triggerEvent: "push", triggerRef: "refs/heads/main", commitSha: "c7d8e9f", status: "failure", triggerActor: "charlie", startedAt: new Date(now - 7200_000), completedAt: new Date(now - 7080_000), errorMessage: "Test suite failed: 3 assertions" },
    { repoId: repoMap["trafficure"], triggerEvent: "push", triggerRef: "refs/heads/release/2.14", commitSha: "1a2b3c4", status: "success", triggerActor: "diana", startedAt: new Date(now - 1800_000), completedAt: new Date(now - 1650_000) },
    { repoId: repoMap["factory"], triggerEvent: "push", triggerRef: "refs/heads/main", commitSha: "5d6e7f8", status: "success", triggerActor: "nikhil", startedAt: new Date(now - 900_000), completedAt: new Date(now - 780_000) },
    { repoId: repoMap["smartmarket"], triggerEvent: "manual", triggerRef: "refs/heads/main", commitSha: "9a0b1c2", status: "pending", triggerActor: "eve" },
    { repoId: repoMap["neo360"], triggerEvent: "push", triggerRef: "refs/heads/feat/customer-360", commitSha: "3d4e5f6", status: "running", triggerActor: "frank", startedAt: new Date(now - 60_000) },
    { repoId: repoMap["network-access"], triggerEvent: "pull_request", triggerRef: "refs/heads/fix/session-timeout", commitSha: "7a8b9c0", status: "success", triggerActor: "grace", startedAt: new Date(now - 5400_000), completedAt: new Date(now - 5280_000) },
  ])

  // ── Phase 7: Fleet sites ──
  const siteRows = [
    { name: "Verizon Network Access (US)", slug: "verizon-network-access", product: "network-access", clusterId: clusterMap["prod-us-east"], status: "active" as const, currentManifestVersion: 42, lastCheckinAt: new Date(now - 30_000) },
    { name: "Verizon Network Access (EU)", slug: "verizon-network-access-eu", product: "network-access", clusterId: clusterMap["prod-eu-west"], status: "active" as const, currentManifestVersion: 41, lastCheckinAt: new Date(now - 45_000) },
    { name: "Walmart Smart Inventory", slug: "walmart-smart-inventory", product: "smart-inventory", clusterId: clusterMap["prod-us-east"], status: "active" as const, currentManifestVersion: 38, lastCheckinAt: new Date(now - 60_000) },
    { name: "BMW Trafficure", slug: "bmw-trafficure", product: "trafficure", clusterId: clusterMap["prod-eu-west"], status: "active" as const, currentManifestVersion: 27, lastCheckinAt: new Date(now - 120_000) },
    { name: "Target SmartMarket", slug: "target-smartmarket", product: "smartmarket", clusterId: clusterMap["prod-us-east"], status: "active" as const, currentManifestVersion: 15, lastCheckinAt: new Date(now - 90_000) },
    { name: "Lepton Staging", slug: "lepton-staging", product: "platform", clusterId: clusterMap["staging-us"], status: "active" as const, currentManifestVersion: 156, lastCheckinAt: new Date(now - 15_000) },
    { name: "Lepton Prod (US)", slug: "lepton-prod-us", product: "platform", clusterId: clusterMap["prod-us-east"], status: "active" as const, currentManifestVersion: 144, lastCheckinAt: new Date(now - 20_000) },
    { name: "Deutsche Telekom SmartOps", slug: "dt-smartops", product: "smartops", clusterId: clusterMap["prod-eu-west"], status: "active" as const, currentManifestVersion: 33, lastCheckinAt: new Date(now - 180_000) },
    { name: "Acme Neo360", slug: "acme-neo360", product: "neo360", clusterId: clusterMap["prod-us-east"], status: "provisioning" as const },
    { name: "Sprint Smart Signal", slug: "sprint-smart-signal", product: "smart-signal", clusterId: clusterMap["prod-us-east"], status: "active" as const, currentManifestVersion: 21, lastCheckinAt: new Date(now - 300_000) },
  ]
  const insertedSites = await db.insert(fleetSite).values(siteRows).returning({ siteId: fleetSite.siteId, slug: fleetSite.slug })
  const siteMap: Record<string, string> = {}
  for (const s of insertedSites) siteMap[s.slug] = s.siteId

  // ── Phase 8: Releases ──
  await db.insert(release).values([
    { version: "v2.14.0", status: "production", createdBy: "diana" },
    { version: "v2.13.2", status: "superseded", createdBy: "alice" },
    { version: "v2.15.0-rc.1", status: "staging", createdBy: "bob" },
    { version: "v2.15.0-rc.2", status: "draft", createdBy: "charlie" },
  ])

  // ── Phase 9: Deployment targets + Sandboxes — no seed data (legacy table) ──

  // ── Phase 10: Previews ──
  const previewDefs = [
    { name: "feat-auth-refresh", slug: "prev-feat-auth", branch: "feat/auth-refresh", repo: "lepton/network-access", pr: 142, owner: "alice", site: "verizon-network-access", status: "active" as const },
    { name: "fix-inventory-sync", slug: "prev-fix-inv-sync", branch: "fix/inventory-sync", repo: "lepton/smart-inventory", pr: 87, owner: "bob", site: "walmart-smart-inventory", status: "building" as const },
    { name: "feat-dashboard-v2", slug: "prev-dashboard-v2", branch: "feat/dashboard-v2", repo: "lepton/smartops", pr: 201, owner: "charlie", site: "dt-smartops", status: "active" as const },
    { name: "perf-traffic-routing", slug: "prev-perf-traffic", branch: "perf/traffic-routing", repo: "lepton/trafficure", owner: "diana", site: "bmw-trafficure", status: "deploying" as const },
  ]

  for (const p of previewDefs) {
    const dtId = newId("dt")
    await db.insert(deploymentTarget).values({
      deploymentTargetId: dtId,
      name: `dt-${p.slug}`,
      slug: `dt-${p.slug}`,
      kind: "preview",
      runtime: "kubernetes",
      clusterId: clusterMap["preview-us-east"],
      namespace: `preview-${p.owner}`,
      createdBy: p.owner,
      trigger: "pr",
      status: p.status === "active" ? "active" : "provisioning",
    })
    await db.insert(preview).values({
      deploymentTargetId: dtId,
      siteId: siteMap[p.site],
      name: p.name,
      slug: p.slug,
      sourceBranch: p.branch,
      commitSha: Math.random().toString(16).slice(2, 9),
      repo: p.repo,
      prNumber: p.pr,
      ownerId: p.owner,
      status: p.status,
    })
  }

  // ── Phase 11: Gateway routes + domains ──
  await db.insert(gwRoute).values([
    { siteId: siteMap["verizon-network-access"], clusterId: clusterMap["prod-us-east"], kind: "ingress", domain: "na.verizon.lepton.io", pathPrefix: "/", targetService: "network-access-api", targetPort: 8080, status: "active", createdBy: "system" },
    { siteId: siteMap["walmart-smart-inventory"], clusterId: clusterMap["prod-us-east"], kind: "ingress", domain: "inventory.walmart.lepton.io", pathPrefix: "/", targetService: "smart-inventory-core", targetPort: 8080, status: "active", createdBy: "system" },
    { siteId: siteMap["bmw-trafficure"], clusterId: clusterMap["prod-eu-west"], kind: "ingress", domain: "trafficure.bmw.lepton.io", pathPrefix: "/", targetService: "trafficure-gateway", targetPort: 8080, status: "active", createdBy: "system" },
    { siteId: siteMap["target-smartmarket"], clusterId: clusterMap["prod-us-east"], kind: "ingress", domain: "market.target.lepton.io", pathPrefix: "/", targetService: "smartmarket-engine", targetPort: 8080, status: "active", createdBy: "system" },
    { siteId: siteMap["lepton-staging"], clusterId: clusterMap["staging-us"], kind: "ingress", domain: "staging.lepton.io", pathPrefix: "/api", targetService: "factory-api", targetPort: 4000, status: "active", createdBy: "system" },
    { siteId: siteMap["lepton-prod-us"], clusterId: clusterMap["prod-us-east"], kind: "ingress", domain: "app.lepton.io", pathPrefix: "/", targetService: "factory-api", targetPort: 4000, status: "active", createdBy: "system" },
    { clusterId: clusterMap["dev-sandbox"], kind: "tunnel", domain: "alice-3000.tunnel.lepton.io", pathPrefix: "/", targetService: "localhost", targetPort: 3000, status: "active", createdBy: "alice" },
    { clusterId: clusterMap["dev-sandbox"], kind: "sandbox", domain: "sbx-bob.sandbox.lepton.io", pathPrefix: "/", targetService: "sbx-bob-staging", targetPort: 8080, status: "active", createdBy: "bob" },
  ])

  await db.insert(domain).values([
    { siteId: siteMap["verizon-network-access"], fqdn: "na.verizon.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { siteId: siteMap["verizon-network-access-eu"], fqdn: "na-eu.verizon.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { siteId: siteMap["walmart-smart-inventory"], fqdn: "inventory.walmart.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { siteId: siteMap["bmw-trafficure"], fqdn: "trafficure.bmw.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { siteId: siteMap["target-smartmarket"], fqdn: "market.target.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { fqdn: "staging.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { fqdn: "app.lepton.io", kind: "primary", dnsVerified: true, status: "active", createdBy: "system" },
    { fqdn: "*.sandbox.lepton.io", kind: "wildcard", dnsVerified: true, status: "active", createdBy: "system" },
    { fqdn: "*.tunnel.lepton.io", kind: "wildcard", dnsVerified: true, status: "active", createdBy: "system" },
    { fqdn: "custom.acme-neo360.com", kind: "custom", dnsVerified: false, status: "pending", createdBy: "frank" },
  ])

  // ── Phase 12: v2 ops tables (sites, system-deployments, workspaces, previews) ──
  // These mirror the v1 fleet data above but in v2 schema so v2 endpoints return data.

  // Systems (software-v2) — needed for system-deployment FKs
  const defaultSystemSpec: SystemSpec = { namespace: "default", lifecycle: "experimental", tags: [] }
  const systemRows: Array<{ name: string; slug: string; spec: SystemSpec }> = [
    { name: "Network Access", slug: "network-access", spec: defaultSystemSpec },
    { name: "Smart Inventory", slug: "smart-inventory", spec: defaultSystemSpec },
    { name: "SmartOps", slug: "smartops", spec: defaultSystemSpec },
    { name: "Trafficure", slug: "trafficure", spec: defaultSystemSpec },
    { name: "SmartMarket", slug: "smartmarket", spec: defaultSystemSpec },
    { name: "Neo360", slug: "neo360", spec: defaultSystemSpec },
    { name: "Smart Signal", slug: "smart-signal", spec: defaultSystemSpec },
    { name: "Factory Platform", slug: "factory-platform", spec: defaultSystemSpec },
  ]
  const insertedSystems = await db.insert(system).values(systemRows).returning({ id: system.id, slug: system.slug })
  const systemMap: Record<string, string> = {}
  for (const s of insertedSystems) systemMap[s.slug] = s.id

  // Components (software-v2) — one per system for demo
  const defaultComponentSpec: GenericComponentSpec = { ports: [], defaultCpu: "250m", defaultMemory: "256Mi", defaultReplicas: 1 }
  const componentRows: Array<{ name: string; slug: string; type: string; systemId: string; spec: GenericComponentSpec }> = [
    { name: "Network Access API", slug: "network-access-api", type: "service", systemId: systemMap["network-access"]!, spec: defaultComponentSpec },
    { name: "Smart Inventory Core", slug: "smart-inventory-core", type: "service", systemId: systemMap["smart-inventory"]!, spec: defaultComponentSpec },
    { name: "SmartOps Collector", slug: "smartops-collector", type: "service", systemId: systemMap["smartops"]!, spec: defaultComponentSpec },
    { name: "Trafficure Gateway", slug: "trafficure-gateway", type: "service", systemId: systemMap["trafficure"]!, spec: defaultComponentSpec },
    { name: "SmartMarket Engine", slug: "smartmarket-engine", type: "service", systemId: systemMap["smartmarket"]!, spec: defaultComponentSpec },
    { name: "Neo360 Platform", slug: "neo360-platform", type: "service", systemId: systemMap["neo360"]!, spec: defaultComponentSpec },
    { name: "Factory API", slug: "factory-api-cmp", type: "service", systemId: systemMap["factory-platform"]!, spec: defaultComponentSpec },
  ]
  const insertedComponents = await db.insert(component).values(componentRows).returning({ id: component.id, slug: component.slug })
  const componentMap: Record<string, string> = {}
  for (const c of insertedComponents) componentMap[c.slug] = c.id

  // v2 Sites (ops)
  const v2SiteRows: Array<{ name: string; slug: string; spec: SiteSpec }> = [
    { name: "Verizon Network Access (US)", slug: "verizon-network-access", spec: { type: "dedicated", product: "network-access", status: "active" } },
    { name: "Verizon Network Access (EU)", slug: "verizon-network-access-eu", spec: { type: "dedicated", product: "network-access", status: "active" } },
    { name: "Walmart Smart Inventory", slug: "walmart-smart-inventory", spec: { type: "dedicated", product: "smart-inventory", status: "active" } },
    { name: "BMW Trafficure", slug: "bmw-trafficure", spec: { type: "dedicated", product: "trafficure", status: "active" } },
    { name: "Target SmartMarket", slug: "target-smartmarket", spec: { type: "dedicated", product: "smartmarket", status: "active" } },
    { name: "Lepton Staging", slug: "lepton-staging", spec: { type: "shared", product: "platform", status: "active" } },
    { name: "Lepton Prod (US)", slug: "lepton-prod-us", spec: { type: "shared", product: "platform", status: "active" } },
    { name: "Deutsche Telekom SmartOps", slug: "dt-smartops", spec: { type: "dedicated", product: "smartops", status: "active" } },
    { name: "Acme Neo360", slug: "acme-neo360", spec: { type: "dedicated", product: "neo360", status: "provisioning" } },
    { name: "Sprint Smart Signal", slug: "sprint-smart-signal", spec: { type: "dedicated", product: "smart-signal", status: "active" } },
  ]
  const insertedV2Sites = await db.insert(site).values(v2SiteRows).returning({ id: site.id, slug: site.slug })
  const v2SiteMap: Record<string, string> = {}
  for (const s of insertedV2Sites) v2SiteMap[s.slug] = s.id

  // v2 System Deployments (ops) — one per site+system combo
  const sdRows: Array<{ name: string; slug: string; type: "production" | "staging" | "dev"; systemId: string; siteId: string; runtimeId: string; spec: SystemDeploymentSpec }> = [
    { name: "NA API @ Verizon US", slug: "na-api-verizon-us", type: "production", systemId: systemMap["network-access"]!, siteId: v2SiteMap["verizon-network-access"]!, runtimeId: runtimeMap["prod-us-east"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "NA API @ Verizon EU", slug: "na-api-verizon-eu", type: "production", systemId: systemMap["network-access"]!, siteId: v2SiteMap["verizon-network-access-eu"]!, runtimeId: runtimeMap["prod-eu-west"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "Inventory @ Walmart", slug: "inventory-walmart", type: "production", systemId: systemMap["smart-inventory"]!, siteId: v2SiteMap["walmart-smart-inventory"]!, runtimeId: runtimeMap["prod-us-east"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "Trafficure @ BMW", slug: "trafficure-bmw", type: "production", systemId: systemMap["trafficure"]!, siteId: v2SiteMap["bmw-trafficure"]!, runtimeId: runtimeMap["prod-eu-west"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "SmartMarket @ Target", slug: "smartmarket-target", type: "production", systemId: systemMap["smartmarket"]!, siteId: v2SiteMap["target-smartmarket"]!, runtimeId: runtimeMap["prod-us-east"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "Factory @ Staging", slug: "factory-staging", type: "staging", systemId: systemMap["factory-platform"]!, siteId: v2SiteMap["lepton-staging"]!, runtimeId: runtimeMap["staging-us"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "Factory @ Prod US", slug: "factory-prod-us", type: "production", systemId: systemMap["factory-platform"]!, siteId: v2SiteMap["lepton-prod-us"]!, runtimeId: runtimeMap["prod-us-east"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
    { name: "SmartOps @ DT", slug: "smartops-dt", type: "production", systemId: systemMap["smartops"]!, siteId: v2SiteMap["dt-smartops"]!, runtimeId: runtimeMap["prod-eu-west"]!, spec: { status: "active", runtime: "kubernetes", trigger: "manual", deploymentStrategy: "rolling", labels: {} } },
  ]
  const insertedSDs = await db.insert(systemDeployment).values(sdRows).returning({ id: systemDeployment.id, slug: systemDeployment.slug })
  const sdMap: Record<string, string> = {}
  for (const sd of insertedSDs) sdMap[sd.slug] = sd.id

  // v2 Component Deployments (ops) — one per system-deployment
  await db.insert(componentDeployment).values([
    { systemDeploymentId: sdMap["na-api-verizon-us"]!, componentId: componentMap["network-access-api"]!, spec: { status: "running", replicas: 3, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["na-api-verizon-eu"]!, componentId: componentMap["network-access-api"]!, spec: { status: "running", replicas: 2, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["inventory-walmart"]!, componentId: componentMap["smart-inventory-core"]!, spec: { status: "running", replicas: 4, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["trafficure-bmw"]!, componentId: componentMap["trafficure-gateway"]!, spec: { status: "running", replicas: 2, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["smartmarket-target"]!, componentId: componentMap["smartmarket-engine"]!, spec: { status: "running", replicas: 2, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["factory-staging"]!, componentId: componentMap["factory-api-cmp"]!, spec: { status: "running", replicas: 1, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["factory-prod-us"]!, componentId: componentMap["factory-api-cmp"]!, spec: { status: "running", replicas: 3, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
    { systemDeploymentId: sdMap["smartops-dt"]!, componentId: componentMap["smartops-collector"]!, spec: { status: "running", replicas: 2, envOverrides: {}, resourceOverrides: {}, driftDetected: false } satisfies ComponentDeploymentSpec },
  ])

  // v2 Principals — demo users referenced by workspaces
  await db.insert(principal).values([
    { id: "alice", slug: "alice", name: "Alice", type: "human", spec: { status: "active" } satisfies PrincipalSpec },
    { id: "bob", slug: "bob", name: "Bob", type: "human", spec: { status: "active" } satisfies PrincipalSpec },
    { id: "charlie", slug: "charlie", name: "Charlie", type: "human", spec: { status: "active" } satisfies PrincipalSpec },
    { id: "diana", slug: "diana", name: "Diana", type: "human", spec: { status: "active" } satisfies PrincipalSpec },
    { id: "eve", slug: "eve", name: "Eve", type: "human", spec: { status: "active" } satisfies PrincipalSpec },
    { id: "system", slug: "system", name: "System", type: "service-account", spec: { status: "active" } satisfies PrincipalSpec },
  ])

  // v2 Workspaces — no seed data; created via `dx workspace create`

  // v2 Previews (ops)
  await db.insert(opsPreview).values([
    { siteId: v2SiteMap["verizon-network-access"]!, sourceBranch: "feat/auth-refresh", prNumber: 142, phase: "active", spec: { repo: "lepton/network-access", commitSha: "a1b2c3d", runtimeClass: "warm", authMode: "team" } satisfies PreviewSpec },
    { siteId: v2SiteMap["walmart-smart-inventory"]!, sourceBranch: "fix/inventory-sync", prNumber: 87, phase: "building", spec: { repo: "lepton/smart-inventory", runtimeClass: "warm", authMode: "team" } satisfies PreviewSpec },
    { siteId: v2SiteMap["dt-smartops"]!, sourceBranch: "feat/dashboard-v2", prNumber: 201, phase: "active", spec: { repo: "lepton/smartops", commitSha: "e4f5a6b", runtimeClass: "warm", authMode: "team" } satisfies PreviewSpec },
    { siteId: v2SiteMap["bmw-trafficure"]!, sourceBranch: "perf/traffic-routing", phase: "deploying", spec: { repo: "lepton/trafficure", runtimeClass: "hot", authMode: "team" } satisfies PreviewSpec },
  ])

  // v2 Routes (infra-v2) — corresponding to gateway routes
  await db.insert(infraRoute).values([
    { name: "Verizon NA Ingress", slug: "rte-verizon-na", type: "ingress", domain: "na.verizon.lepton.io", runtimeId: runtimeMap["prod-us-east"]!, spec: { domain: "na.verizon.lepton.io", targets: [{ tenantSlug: "verizon", systemDeploymentSlug: "na-api-verizon-us", port: 8080, weight: 100 }], status: "active", protocol: "http", createdBy: "api", middlewares: [], failoverPolicy: "none" } satisfies RouteSpec },
    { name: "Walmart Inventory Ingress", slug: "rte-walmart-inv", type: "ingress", domain: "inventory.walmart.lepton.io", runtimeId: runtimeMap["prod-us-east"]!, spec: { domain: "inventory.walmart.lepton.io", targets: [{ tenantSlug: "walmart", systemDeploymentSlug: "inventory-walmart", port: 8080, weight: 100 }], status: "active", protocol: "http", createdBy: "api", middlewares: [], failoverPolicy: "none" } satisfies RouteSpec },
    { name: "BMW Trafficure Ingress", slug: "rte-bmw-traffic", type: "ingress", domain: "trafficure.bmw.lepton.io", runtimeId: runtimeMap["prod-eu-west"]!, spec: { domain: "trafficure.bmw.lepton.io", targets: [{ tenantSlug: "bmw", systemDeploymentSlug: "trafficure-bmw", port: 8080, weight: 100 }], status: "active", protocol: "http", createdBy: "api", middlewares: [], failoverPolicy: "none" } satisfies RouteSpec },
    { name: "Staging Ingress", slug: "rte-staging", type: "ingress", domain: "staging.lepton.io", runtimeId: runtimeMap["staging-us"]!, spec: { domain: "staging.lepton.io", targets: [{ tenantSlug: "lepton", systemDeploymentSlug: "factory-staging", port: 4000, weight: 100 }], status: "active", protocol: "http", createdBy: "api", middlewares: [], failoverPolicy: "none" } satisfies RouteSpec },
    { name: "Prod US Ingress", slug: "rte-prod-us", type: "ingress", domain: "app.lepton.io", runtimeId: runtimeMap["prod-us-east"]!, spec: { domain: "app.lepton.io", targets: [{ tenantSlug: "lepton", systemDeploymentSlug: "factory-prod-us", port: 4000, weight: 100 }], status: "active", protocol: "http", createdBy: "api", middlewares: [], failoverPolicy: "none" } satisfies RouteSpec },
  ])

  // v2 DNS Domains (infra-v2)
  await db.insert(dnsDomain).values([
    { name: "na.verizon.lepton.io", slug: "dom-verizon-na", type: "primary", fqdn: "na.verizon.lepton.io", siteId: v2SiteMap["verizon-network-access"]!, spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "inventory.walmart.lepton.io", slug: "dom-walmart-inv", type: "primary", fqdn: "inventory.walmart.lepton.io", siteId: v2SiteMap["walmart-smart-inventory"]!, spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "trafficure.bmw.lepton.io", slug: "dom-bmw-traffic", type: "primary", fqdn: "trafficure.bmw.lepton.io", siteId: v2SiteMap["bmw-trafficure"]!, spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "staging.lepton.io", slug: "dom-staging", type: "primary", fqdn: "staging.lepton.io", spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "app.lepton.io", slug: "dom-app", type: "primary", fqdn: "app.lepton.io", spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "*.sandbox.lepton.io", slug: "dom-sandbox-wildcard", type: "wildcard", fqdn: "*.sandbox.lepton.io", spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
    { name: "*.tunnel.lepton.io", slug: "dom-tunnel-wildcard", type: "wildcard", fqdn: "*.tunnel.lepton.io", spec: { verified: true, verifiedAt: new Date() } satisfies DnsDomainSpec },
  ])

  // ── Phase 13: Commerce customers ──
  await db.insert(customerAccount).values([
    { name: "Verizon Communications", slug: "verizon", status: "active" },
    { name: "Walmart Inc.", slug: "walmart", status: "active" },
    { name: "BMW Group", slug: "bmw", status: "active" },
    { name: "Target Corporation", slug: "target", status: "active" },
    { name: "Deutsche Telekom", slug: "deutsche-telekom", status: "active" },
    { name: "Sprint (T-Mobile)", slug: "sprint", status: "active" },
    { name: "Acme Corp", slug: "acme", status: "trial" },
    { name: "Globex Industries", slug: "globex", status: "trial" },
    { name: "Initech LLC", slug: "initech", status: "suspended" },
    { name: "Umbrella Corp", slug: "umbrella", status: "active" },
    { name: "Stark Industries", slug: "stark", status: "active" },
    { name: "Wayne Enterprises", slug: "wayne", status: "trial" },
  ])

  console.log("[seed-demo] Demo data seeded successfully.")
}

export { startGateway, Reconciler, KubeClientImpl }
export { getTunnelStreamManager } from "./modules/infra/tunnel-broker"
