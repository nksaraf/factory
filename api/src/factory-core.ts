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
import { provider, cluster } from "./db/schema/infra"
import { KubeClientImpl } from "./lib/kube-client-impl"
import { healthController } from "./modules/health/index"
import { gatewayController } from "./modules/infra/gateway.controller"
import { infraController } from "./modules/infra/index"
import { previewController } from "./modules/infra/preview.controller"
import { sandboxController } from "./modules/infra/sandbox.controller"
import { startGateway } from "./modules/infra/gateway-proxy"
import { secretController } from "./modules/identity/secret.controller"
import { Reconciler } from "./reconciler/reconciler"
import { productController } from "./modules/product/index"
import { buildController } from "./modules/build/index"
import { commerceController } from "./modules/commerce/index"
import { fleetController } from "./modules/fleet/index"
import { observabilityController } from "./modules/observability/index"
import { NoopObservabilityAdapter } from "./adapters/observability-adapter-noop"
import { DemoObservabilityAdapter } from "./adapters/observability-adapter-demo"
import { orgTeam } from "./db/schema/org"
import { productModule } from "./db/schema/product"
import { fleetSite, release, deploymentTarget, sandbox, preview } from "./db/schema/fleet"
import { route, domain } from "./db/schema/gateway"
import { customerAccount } from "./db/schema/commerce"
import { repo, pipelineRun, gitHostProvider } from "./db/schema/build"
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
      await client.query(stmt)
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
  const db = drizzlePglite(client, { schema }) as unknown as Database
  return { client, db }
}

export interface SeedLocalInfraOptions {
  kubeconfigPath?: string
  clusterName?: string
}

/**
 * Seed the local provider and cluster rows if they don't already exist.
 * Used by the local daemon to ensure a "local" provider and k3d cluster
 * are registered in the database.
 */
export async function seedLocalInfra(
  db: Database,
  opts: SeedLocalInfraOptions = {}
) {
  const { kubeconfigPath, clusterName = "dx-local" } = opts

  // Upsert local provider
  const [existing] = await db
    .select({ providerId: provider.providerId })
    .from(provider)
    .where(eq(provider.slug, "local"))
    .limit(1)

  let providerId: string
  if (existing) {
    providerId = existing.providerId
  } else {
    const [row] = await db
      .insert(provider)
      .values({
        name: "Local",
        slug: "local",
        providerType: "local",
        providerKind: "local",
        status: "active",
      })
      .returning({ providerId: provider.providerId })
    providerId = row!.providerId
  }

  // Upsert local cluster
  const [existingCluster] = await db
    .select({ clusterId: cluster.clusterId })
    .from(cluster)
    .where(eq(cluster.slug, clusterName))
    .limit(1)

  if (!existingCluster) {
    await db.insert(cluster).values({
      name: clusterName,
      slug: clusterName,
      providerId,
      status: "ready",
      kubeconfigRef: kubeconfigPath ?? null,
    })
  } else if (kubeconfigPath) {
    // Update kubeconfig if provided
    await db
      .update(cluster)
      .set({ kubeconfigRef: kubeconfigPath })
      .where(eq(cluster.clusterId, existingCluster.clusterId))
  }
}

/**
 * Create a stripped-down Elysia app for local use — infra controllers only,
 * no auth middleware.  Used by the CLI local daemon and potentially test helpers.
 */
export function createLocalApp(db: Database, reconciler: Reconciler | null, opts?: { full?: boolean; demo?: boolean }) {
  const getReconciler = () => reconciler

  const infraRoutes = new Elysia({ prefix: "/infra" })
    .use(infraController(db))
    .use(gatewayController(db))
    .use(sandboxController(db, null, getReconciler))
    .use(previewController(db))

  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", db)
    .use(infraRoutes)
    .use(secretController(db))

  // Full mode: mount all controllers for TUI/dashboard use
  if (opts?.full) {
    factoryRoutes
      .use(productController(db))
      .use(buildController(db))
      .use(commerceController(db))
      .use(fleetController(db))
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
  // Check if already seeded
  const [existing] = await db
    .select({ providerId: provider.providerId })
    .from(provider)
    .where(eq(provider.slug, "proxmox-dc1"))
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

  // ── Phase 2: Providers ──
  const providerRows = [
    { name: "Proxmox DC1", slug: "proxmox-dc1", providerType: "proxmox", providerKind: "internal", status: "active" },
    { name: "Proxmox DC2", slug: "proxmox-dc2", providerType: "proxmox", providerKind: "internal", status: "active" },
    { name: "AWS US-East", slug: "aws-us-east", providerType: "aws", providerKind: "cloud", status: "active" },
  ]
  const insertedProviders = await db.insert(provider).values(providerRows).returning({ providerId: provider.providerId, slug: provider.slug })
  const providerMap: Record<string, string> = {}
  for (const p of insertedProviders) providerMap[p.slug] = p.providerId

  // ── Phase 3: Clusters ──
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

  // ── Phase 9: Deployment targets + Sandboxes ──
  const sandboxDefs = [
    { name: "alice-dev", slug: "sbx-alice-dev", owner: "alice", runtime: "container" as const, cluster: "dev-sandbox", cpu: "2", memory: "4Gi", status: "active" },
    { name: "bob-staging", slug: "sbx-bob-staging", owner: "bob", runtime: "container" as const, cluster: "staging-us", cpu: "4", memory: "8Gi", status: "active" },
    { name: "charlie-debug", slug: "sbx-charlie-debug", owner: "charlie", runtime: "container" as const, cluster: "dev-sandbox", cpu: "2", memory: "4Gi", status: "active" },
    { name: "diana-review", slug: "sbx-diana-review", owner: "diana", runtime: "vm" as const, cluster: "dev-sandbox", cpu: "8", memory: "16Gi", status: "active" },
    { name: "eve-experiment", slug: "sbx-eve-experiment", owner: "eve", runtime: "container" as const, cluster: "dev-sandbox", cpu: "1", memory: "2Gi", status: "provisioning" },
    { name: "frank-ml", slug: "sbx-frank-ml", owner: "frank", runtime: "vm" as const, cluster: "dev-sandbox", cpu: "16", memory: "32Gi", status: "active" },
    { name: "ci-runner-01", slug: "sbx-ci-runner-01", owner: "system", runtime: "container" as const, cluster: "staging-us", cpu: "4", memory: "8Gi", status: "active" },
    { name: "ci-runner-02", slug: "sbx-ci-runner-02", owner: "system", runtime: "container" as const, cluster: "staging-us", cpu: "4", memory: "8Gi", status: "stopped" },
  ]

  for (const s of sandboxDefs) {
    const dtId = newId("dt")
    await db.insert(deploymentTarget).values({
      deploymentTargetId: dtId,
      name: `dt-${s.slug}`,
      slug: `dt-${s.slug}`,
      kind: "sandbox",
      runtime: "kubernetes",
      clusterId: clusterMap[s.cluster],
      namespace: `sandbox-${s.owner}`,
      createdBy: s.owner,
      trigger: "manual",
      status: s.status === "provisioning" ? "provisioning" : "active",
    })
    await db.insert(sandbox).values({
      deploymentTargetId: dtId,
      name: s.name,
      slug: s.slug,
      runtimeType: s.runtime,
      ownerId: s.owner,
      ownerType: s.owner === "system" ? "agent" as const : "user" as const,
      cpu: s.cpu,
      memory: s.memory,
      healthStatus: s.status === "active" ? "healthy" : "unknown",
      ipAddress: s.status === "active" ? `10.42.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` : undefined,
    })
  }

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
  await db.insert(route).values([
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

  // ── Phase 12: Commerce customers ──
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
