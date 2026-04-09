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

import type { SubstrateSpec, RuntimeSpec } from "@smp/factory-shared/schemas/infra"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"

import type { Database } from "./db/connection"
import * as schema from "./db/schema"
import { substrate, runtime } from "./db/schema/infra-v2"
import { principal } from "./db/schema/org-v2"
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
import { site } from "./db/schema/ops"

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

export { startGateway, Reconciler, KubeClientImpl }
export { getTunnelStreamManager } from "./modules/infra/tunnel-broker"
