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

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import {
  createPgliteDb,
  migrateWithPglite,
  seedLocalInfra,
  createLocalApp,
  startGateway,
  Reconciler,
  KubeClientImpl,
} from "@smp/factory-api/core"

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
  mkdirSync(PGLITE_DIR, { recursive: true })

  const migrationsDir = process.env.FACTORY_MIGRATIONS_DIR ?? findMigrationsDir()

  console.log(`[local-factory] PGlite data: ${PGLITE_DIR}`)
  console.log(`[local-factory] Migrations: ${migrationsDir}`)

  // Create PGlite database with persistent storage
  const { client, db } = await createPgliteDb(PGLITE_DIR)
  await migrateWithPglite(client, migrationsDir)

  // Create reconciler for k8s provisioning
  const kubeClient = new KubeClientImpl()
  const reconciler = new Reconciler(db, kubeClient)

  // Seed local provider + cluster (idempotent)
  await seedLocalInfra(db)

  // Build stripped-down Elysia app — infra controllers only, no auth
  const app = createLocalApp(db, reconciler)

  // Start gateway proxy
  try {
    startGateway({ db, port: GATEWAY_PORT })
    console.log(`[local-factory] Gateway proxy listening on port ${GATEWAY_PORT}`)
  } catch (err) {
    console.warn(`[local-factory] Gateway proxy failed to start: ${err}`)
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid))

  // Start API server
  Bun.serve({
    port: API_PORT,
    fetch: app.fetch,
  })

  console.log(`[local-factory] API listening on http://localhost:${API_PORT}`)
  console.log(`[local-factory] PID: ${process.pid}`)
}

main().catch((err) => {
  console.error("[local-factory] Fatal error:", err)
  process.exit(1)
})
