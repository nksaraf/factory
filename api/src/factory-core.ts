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
export function createLocalApp(db: Database, reconciler: Reconciler | null) {
  const getReconciler = () => reconciler

  const infraRoutes = new Elysia({ prefix: "/infra" })
    .use(infraController(db))
    .use(gatewayController(db))
    .use(sandboxController(db, getReconciler))
    .use(previewController(db))

  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", db)
    .use(infraRoutes)
    .use(secretController(db))

  return new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes)
}

export { startGateway, Reconciler, KubeClientImpl }
