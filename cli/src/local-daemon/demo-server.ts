/**
 * Demo factory daemon — runs a full factory API against an external Postgres.
 *
 * Entry point: `bun cli/src/local-daemon/demo-server.ts`
 *
 * Unlike server.ts (which uses PGlite), this connects to a real Postgres
 * that already has seed data (run `bun api/src/db/seed.ts` first).
 *
 * Env:
 *   FACTORY_DATABASE_URL — Postgres connection string (default: localhost:5432)
 *   DX_DEMO_PORT         — API port (default: 4200)
 */

import { createLocalApp } from "../../../api/src/factory-core"
import { connection } from "../../../api/src/db/connection"

const API_PORT = Number(process.env.DX_DEMO_PORT ?? 4200)
const DB_URL =
  process.env.FACTORY_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/postgres"

async function main() {
  // Tell gateway controller not to start its own gateway listener
  process.env.__DX_SKIP_GATEWAY_ONSTART = "1"

  console.log(`[demo-factory] Connecting to ${DB_URL}`)

  const db = connection(DB_URL)

  // Build full Elysia app with all controllers
  const app = createLocalApp(db, null, { full: true })

  app.listen(API_PORT)
  console.log(`[demo-factory] API listening on http://localhost:${API_PORT}`)
  console.log(
    `[demo-factory] Run: DX_API_URL=http://localhost:${API_PORT} dx tui`
  )
}

main().catch((err) => {
  console.error("[demo-factory] Fatal error:", err)
  process.exit(1)
})
