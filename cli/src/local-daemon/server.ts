/**
 * Local factory daemon — runs a stripped-down factory API with PGlite.
 *
 * Entry point: `bun cli/src/local-daemon/server.ts`
 *
 * - PGlite with persistent data dir (DX_DATA_DIR/pglite)
 * - Only infra controllers (sandbox, cluster, gateway, preview, health)
 * - Reconciler + KubeClientImpl for real k8s provisioning
 * - Gateway proxy on port 9090
 * - No auth middleware
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// Import directly from api source to avoid pnpm symlink module duplication
// (symlink-resolved modules can get different Drizzle table references)
import {
  KubeClientImpl,
  Reconciler,
  createLocalApp,
  createPgliteDb,
  getTunnelStreamManager,
  migrateWithPglite,
  seedLocalInfra,
  startGateway,
} from "../../../api/src/factory-core"

import { DX_CONFIG_DIR, DX_DATA_DIR as DX_DATA_BASE } from "../lib/host-dirs.js"

const API_PORT = 4100
const GATEWAY_PORT = 9090
const PGLITE_DIR = join(DX_DATA_BASE, "pglite")
const PID_FILE = join(DX_CONFIG_DIR, "daemon.pid")

// Find the drizzle migrations folder — resolve relative to the api package
function findMigrationsDir(): string {
  const candidates = [
    resolve(__dirname, "../../../../api/drizzle"),
    resolve(__dirname, "../../../api/drizzle"),
    resolve(process.cwd(), "api/drizzle"),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, "meta", "_journal.json"))) return dir
  }
  throw new Error(
    "Could not find drizzle migrations directory. Run from the monorepo root or set FACTORY_MIGRATIONS_DIR."
  )
}

async function main() {
  // Default to .localhost for local dev (avoids HSTS issues with .dev TLD)
  if (!process.env.DX_GATEWAY_DOMAIN) {
    process.env.DX_GATEWAY_DOMAIN = "localhost"
  }

  // Tell gateway controller not to start its own gateway — we start it
  // explicitly below so it shares the same db instance.
  process.env.__DX_SKIP_GATEWAY_ONSTART = "1"

  mkdirSync(PGLITE_DIR, { recursive: true })

  const migrationsDir =
    process.env.FACTORY_MIGRATIONS_DIR ?? findMigrationsDir()

  console.log(`[local-factory] PGlite data: ${PGLITE_DIR}`)
  console.log(`[local-factory] Migrations: ${migrationsDir}`)

  // Create PGlite database with persistent storage
  const { client, db } = await createPgliteDb(PGLITE_DIR)
  await migrateWithPglite(client, migrationsDir)

  // Graceful shutdown: close PGlite cleanly to flush WAL and avoid corruption
  function shutdown() {
    console.log("[local-factory] Shutting down...")
    try {
      unlinkSync(PID_FILE)
    } catch {}
    client.close().then(
      () => process.exit(0),
      () => process.exit(1)
    )
    // Force exit after 5s if close hangs
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // Create reconciler for k8s provisioning
  const kubeClient = new KubeClientImpl()
  const reconciler = new Reconciler(db, kubeClient)

  // Seed local estate + anonymous principal (idempotent).
  // NOTE: Realm (cluster) registration is handled by `dx setup --role factory`,
  // NOT by daemon startup. The daemon trusts that setup was run first.
  await seedLocalInfra(db, {})

  // Build Elysia app — use --full to mount all controllers (for TUI dashboard)
  const fullMode = process.argv.includes("--full")

  const app = createLocalApp(db, reconciler, { full: fullMode })
  if (fullMode) {
    console.log("[local-factory] Full mode: all controllers mounted")
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid))

  // Start gateway proxy — must use the same db instance so route lookups
  // see routes created by the reconciler and API.
  try {
    startGateway({ db, port: GATEWAY_PORT, getTunnelStreamManager })
    console.log(
      `[local-factory] Gateway proxy listening on port ${GATEWAY_PORT}`
    )
  } catch (err) {
    console.warn(`[local-factory] Gateway proxy failed to start: ${err}`)
  }

  // Start API server using Elysia's listen() so route handlers share
  // the same db context as the gateway (Bun.serve with app.fetch can
  // isolate PGlite state in some cases).
  app.listen(API_PORT)

  // Start reconciler loop so workbenches transition from provisioning → active
  setInterval(async () => {
    try {
      await reconciler.reconcileAll()
    } catch (err) {
      console.error("[local-factory] Reconciler error:", err)
    }
  }, 15_000)
  console.log("[local-factory] Reconciler loop started (15s interval)")

  console.log(`[local-factory] API listening on http://localhost:${API_PORT}`)
  console.log(`[local-factory] PID: ${process.pid}`)
}

main().catch((err) => {
  console.error("[local-factory] Fatal error:", err)
  process.exit(1)
})
