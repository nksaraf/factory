/**
 * Shared PGlite utilities for local factory daemon and test helpers.
 *
 * This module provides the PGlite-compatible migrator, database creation,
 * and local infrastructure seeding used by both the CLI local daemon and
 * the vitest test context.
 */
import { PGlite } from "@electric-sql/pglite"
import { cors } from "@elysiajs/cors"
import type {
  DnsDomainSpec,
  EstateSpec,
  RealmSpec,
  RouteSpec,
} from "@smp/factory-shared/schemas/infra"
import type {
  ComponentDeploymentSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import type {
  GenericComponentSpec,
  SystemSpec,
} from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { Elysia } from "elysia"
import fs from "node:fs"
import path from "node:path"

import { DemoObservabilityAdapter } from "./adapters/observability-adapter-demo"
import { NoopObservabilityAdapter } from "./adapters/observability-adapter-noop"
import type { Database } from "./db/connection"
import * as schema from "./db/schema"
import { estate, realm } from "./db/schema/infra"
import { principal } from "./db/schema/org"
import { KubeClientImpl } from "./lib/kube-client-impl"
import { agentController } from "./modules/agent/index"
import { buildController } from "./modules/build/index"
import { commerceController } from "./modules/commerce/index"
import { healthController } from "./modules/health/index"
import { configVarController } from "./modules/identity/config-var.controller"
import { identityController } from "./modules/identity/index"
import { secretController } from "./modules/identity/secret.controller"
import { startGateway } from "./modules/infra/gateway-proxy"
import { infraController } from "./modules/infra/index"
import { messagingController } from "./modules/messaging/index"
import { observabilityController } from "./modules/observability/index"
import { opsController } from "./modules/ops/index"
import { productController } from "./modules/product/index"
import { operationsController } from "./modules/system/operations.controller"
import { eventController } from "./modules/events"
import { workflowController } from "./modules/workflow/triggers/rest"
import { Reconciler } from "./reconciler/reconciler"

/** Parsed statements per migration SQL file path (speeds repeated test DB setup). */
const migrationStatementsBySqlPath = new Map<string, string[]>()

type MigrationJournal = { entries: { tag: string }[] }

/** Parsed _journal.json per migrations folder (avoids re-reading during migrate). */
const migrationJournalByFolder = new Map<string, MigrationJournal>()

function parseMigrationStatements(content: string): string[] {
  const hasBreakpoints = content.includes("--> statement-breakpoint")
  const raw = hasBreakpoints
    ? content.split(/-->\s*statement-breakpoint/)
    : content.split(/;\s*\n/)
  return raw
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0)
}

function getCachedMigrationStatements(sqlFile: string, content: string) {
  let statements = migrationStatementsBySqlPath.get(sqlFile)
  if (!statements) {
    statements = parseMigrationStatements(content)
    migrationStatementsBySqlPath.set(sqlFile, statements)
  }
  return statements
}

/**
 * PGlite cannot handle multi-statement SQL in a single prepared statement.
 * This custom migrator reads SQL files from the drizzle folder and executes
 * each statement individually.
 */
export async function migrateWithPglite(
  client: PGlite,
  migrationsFolder: string
) {
  const folderKey = path.resolve(migrationsFolder)
  let journal: MigrationJournal | undefined =
    migrationJournalByFolder.get(folderKey)
  if (!journal) {
    const journalPath = path.join(folderKey, "meta", "_journal.json")
    journal = JSON.parse(
      fs.readFileSync(journalPath, "utf-8")
    ) as MigrationJournal
    migrationJournalByFolder.set(folderKey, journal)
  }

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

  const pending = journal.entries.filter((e) => !appliedHashes.has(e.tag))
  if (pending.length === 0) return

  for (const entry of pending) {
    const sqlFile = path.resolve(folderKey, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlFile)) continue

    const content = fs.readFileSync(sqlFile, "utf-8")
    const statements = getCachedMigrationStatements(sqlFile, content)

    for (const stmt of statements) {
      try {
        await client.query(stmt)
      } catch (err: any) {
        // PGlite doesn't support some extensions (e.g. btree_gist) — skip gracefully
        if (err?.code === "0A000" && stmt.includes("CREATE EXTENSION")) continue
        // PGlite lacks gist operator classes needed for EXCLUDE constraints — skip
        if (err?.code === "42704" && stmt.includes("EXCLUDE USING gist"))
          continue
        // PGlite may not support materialized views or PL/pgSQL functions — skip gracefully
        if (
          (err?.code === "0A000" ||
            err?.code === "42P17" ||
            err?.code === "42883") &&
          (stmt.includes("MATERIALIZED VIEW") ||
            stmt.includes("LANGUAGE plpgsql"))
        ) {
          console.warn(
            `[migrate] Skipping unsupported PGlite statement: ${stmt.slice(0, 80)}…`
          )
          continue
        }
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
      ([_, v]) =>
        v != null && typeof v === "object" && Object.getPrototypeOf(v) !== null
    )
  )
  const db = drizzlePglite(client, {
    schema: tableSchema,
  }) as unknown as Database
  return { client, db }
}

export interface SeedLocalInfraOptions {
  kubeconfigPath?: string
  clusterName?: string
}

/**
 * Seed the local estate and realm rows if they don't already exist.
 * Used by the local daemon to ensure a "local" estate and k3d realm
 * are registered in the database.
 */
export async function seedLocalInfra(
  db: Database,
  opts: SeedLocalInfraOptions = {}
) {
  const { kubeconfigPath, clusterName = "dx-local" } = opts

  // Read kubeconfig content — always store inline YAML, never file paths.
  // This makes kubeconfigRef portable across host, Docker, and remote servers.
  const kubeconfigContent =
    kubeconfigPath && fs.existsSync(kubeconfigPath)
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

  // Upsert local estate
  const [existing] = await db
    .select({ id: estate.id })
    .from(estate)
    .where(eq(estate.slug, "local"))
    .limit(1)

  let estateId: string
  if (existing) {
    estateId = existing.id
  } else {
    const [row] = await db
      .insert(estate)
      .values({
        name: "Local",
        slug: "local",
        type: "datacenter",
        spec: {
          providerKind: "bare-metal",
          lifecycle: "active",
          syncStatus: "idle",
          metadata: {},
        } satisfies EstateSpec,
      })
      .returning({ id: estate.id })
    estateId = row!.id
  }

  // Upsert local realm
  const [existingRealm] = await db
    .select({ id: realm.id, spec: realm.spec })
    .from(realm)
    .where(eq(realm.slug, clusterName))
    .limit(1)

  if (!existingRealm) {
    await db.insert(realm).values({
      name: clusterName,
      slug: clusterName,
      type: "k8s-cluster",
      spec: {
        status: "ready",
        isDefault: true,
        kubeconfigRef: kubeconfigContent ?? undefined,
      },
    })
  } else if (kubeconfigContent) {
    const spec = (existingRealm.spec ?? {}) as Record<string, unknown>
    await db
      .update(realm)
      .set({
        spec: {
          ...spec,
          kubeconfigRef: kubeconfigContent,
          isDefault: true,
        } as RealmSpec,
      })
      .where(eq(realm.id, existingRealm.id))
  }
}

/**
 * Create a stripped-down Elysia app for local use — infra controllers only,
 * no auth middleware.  Used by the CLI local daemon and potentially test helpers.
 */
export function createLocalApp(
  db: Database,
  reconciler: Reconciler | null,
  opts?: { full?: boolean; demo?: boolean }
) {
  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", db)
    .use(productController(db))
    .use(buildController(db))
    .use(commerceController(db))
    .use(opsController(db))
    .use(infraController(db))
    .use(agentController(db))
    .use(identityController(db))
    .use(secretController(db))
    .use(configVarController(db))
    .use(messagingController(db))
    .use(operationsController(db))
    .use(workflowController(db))
    .use(eventController(db))

  if (opts?.full) {
    factoryRoutes.use(
      observabilityController(
        opts?.demo
          ? new DemoObservabilityAdapter()
          : new NoopObservabilityAdapter()
      )
    )
  }

  return new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes)
}

export { startGateway, Reconciler, KubeClientImpl }
export { getTunnelStreamManager } from "./modules/infra/tunnel-broker"
