/**
 * One-shot Proxmox inventory sync trigger.
 * Run: FACTORY_DATABASE_URL=postgres://... ./node_modules/.bin/tsx src/trigger-proxmox-sync.ts
 */
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { getVMProviderAdapter } from "./adapters/adapter-registry"
import { estate } from "./db/schema/infra"

const DB_URL = process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL
if (!DB_URL) {
  console.error("FACTORY_DATABASE_URL is required")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: DB_URL })
await pool.query("SELECT 1")
console.log("✓ Database connected")

const db = drizzle(pool) as any

const hypervisors = await db
  .select()
  .from(estate)
  .where(
    and(
      eq(estate.type, "hypervisor"),
      sql`${estate.spec}->>'providerKind' = 'proxmox'`,
      sql`${estate.spec}->>'lifecycle' = 'active'`
    )
  )

console.log(`Found ${hypervisors.length} Proxmox hypervisor(s)\n`)

for (const hyp of hypervisors) {
  console.log(`Syncing: ${hyp.name} (${hyp.slug})`)
  const adapter = getVMProviderAdapter("proxmox", db)
  try {
    const result = await adapter.syncInventory(hyp)
    console.log(
      `  ✓ hosts: ${result.hostsDiscovered}, vms: ${result.vmsDiscovered}`
    )
  } catch (err: any) {
    console.error(`  ✗ FAILED: ${err.message}`)
    console.error(`  cause:`, err.cause)
    console.error(err.stack)
  }
}

await pool.end()
