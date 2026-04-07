/**
 * One-shot Proxmox inventory sync trigger.
 * Run: FACTORY_DATABASE_URL=postgres://... bun run api/src/trigger-proxmox-sync.ts
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import { substrate } from "./db/schema/infra-v2";
import { getVMProviderAdapter } from "./adapters/adapter-registry";

const DB_URL = process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("FACTORY_DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL });
await pool.query("SELECT 1");
console.log("✓ Database connected");

const db = drizzle(pool) as any;

const hypervisors = await db
  .select()
  .from(substrate)
  .where(
    and(
      eq(substrate.type, "hypervisor"),
      sql`${substrate.spec}->>'providerKind' = 'proxmox'`,
      sql`${substrate.spec}->>'lifecycle' = 'active'`,
    ),
  );

console.log(`Found ${hypervisors.length} Proxmox hypervisor(s)\n`);

for (const hyp of hypervisors) {
  console.log(`Syncing: ${hyp.name} (${hyp.slug})`);
  const adapter = getVMProviderAdapter("proxmox", db);
  try {
    const result = await adapter.syncInventory(hyp);
    console.log(`  ✓ hosts: ${result.hostsDiscovered}, vms: ${result.vmsDiscovered}`);
  } catch (err: any) {
    console.error(`  ✗ FAILED: ${err.message}`);
  }
}

await pool.end();
