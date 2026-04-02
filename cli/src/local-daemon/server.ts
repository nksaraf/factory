/**
 * Local factory daemon — runs a stripped-down factory API with PGlite.
 *
 * Entry point: `bun cli/src/local-daemon/server.ts`
 *
 * - PGlite with persistent data dir (~/.config/dx/data/pglite)
 * - Only infra controllers (sandbox, cluster, gateway, preview, health)
 * - Reconciler + KubeClientImpl for real k8s provisioning
 * - Gateway proxy on port 9090
 * - No auth middleware
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

// Import directly from api source to avoid pnpm symlink module duplication
// (symlink-resolved modules can get different Drizzle table references)
import {
  createPgliteDb,
  migrateWithPglite,
  seedLocalInfra,
  seedDemoData,
  createLocalApp,
  startGateway,
  Reconciler,
  KubeClientImpl,
} from "../../../api/src/factory-core"

const API_PORT = 4100
const GATEWAY_PORT = 9090
const DX_DATA_DIR = join(homedir(), ".config", "dx", "data")
const PGLITE_DIR = join(DX_DATA_DIR, "pglite")
const PID_FILE = join(homedir(), ".config", "dx", "daemon.pid")

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

  const migrationsDir = process.env.FACTORY_MIGRATIONS_DIR ?? findMigrationsDir()

  console.log(`[local-factory] PGlite data: ${PGLITE_DIR}`)
  console.log(`[local-factory] Migrations: ${migrationsDir}`)

  // Create PGlite database with persistent storage
  const { client, db } = await createPgliteDb(PGLITE_DIR)
  await migrateWithPglite(client, migrationsDir)

  // Graceful shutdown: close PGlite cleanly to flush WAL and avoid corruption
  function shutdown() {
    console.log("[local-factory] Shutting down...")
    try { unlinkSync(PID_FILE) } catch {}
    client.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
    // Force exit after 5s if close hangs
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // Create reconciler for k8s provisioning
  const kubeClient = new KubeClientImpl()
  const reconciler = new Reconciler(db, kubeClient)

  // Seed local provider + cluster (idempotent).
  // Try to get a fresh kubeconfig from k3d to avoid stale TLS certs
  // (k3d generates new server certs on each cluster create).
  let kubeconfigPath = process.env.KUBECONFIG ?? join(homedir(), ".kube", "config")
  try {
    const { getK3dKubeconfig } = await import("../handlers/cluster/k3d")
    kubeconfigPath = await getK3dKubeconfig("dx-local")
  } catch {
    // k3d not installed or no dx-local cluster — use default kubeconfig
  }
  await seedLocalInfra(db, { kubeconfigPath })

  // Build Elysia app — use --full to mount all controllers (for TUI dashboard)
  const fullMode = process.argv.includes("--full")
  const demoMode = process.argv.includes("--seed-demo")

  // Seed demo data if requested (before starting the app)
  if (demoMode) {
    await seedDemoData(db)
  }

  const app = createLocalApp(db, reconciler, { full: fullMode, demo: demoMode })
  if (fullMode) {
    console.log("[local-factory] Full mode: all controllers mounted")
  }
  if (demoMode) {
    console.log("[local-factory] Demo mode: demo data seeded + demo observability")
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid))

  // Start gateway proxy — must use the same db instance so route lookups
  // see routes created by the reconciler and API.
  try {
    startGateway({ db, port: GATEWAY_PORT })
    console.log(`[local-factory] Gateway proxy listening on port ${GATEWAY_PORT}`)
  } catch (err) {
    console.warn(`[local-factory] Gateway proxy failed to start: ${err}`)
  }

  // Start API server using Elysia's listen() so route handlers share
  // the same db context as the gateway (Bun.serve with app.fetch can
  // isolate PGlite state in some cases).
  app.listen(API_PORT)

  console.log(`[local-factory] API listening on http://localhost:${API_PORT}`)
  console.log(`[local-factory] PID: ${process.pid}`)
}

main().catch((err) => {
  console.error("[local-factory] Fatal error:", err)
  process.exit(1)
})
