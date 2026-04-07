/**
 * One-shot identity sync trigger.
 *
 * Full sync (all providers via API):
 *   FACTORY_DATABASE_URL=postgres://... bun run api/src/trigger-identity-sync.ts
 *
 * Import from file (skip provider API call):
 *   FACTORY_DATABASE_URL=postgres://... bun run api/src/trigger-identity-sync.ts --import <provider> <file.json>
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { IdentitySyncService } from "./modules/identity/identity-sync.service";
import { PostgresSecretBackend } from "./lib/secrets/postgres-backend";
import type { IdentityProviderType } from "./adapters/identity-provider-adapter";

const DB_URL = process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("FACTORY_DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL });
await pool.query("SELECT 1");
console.log("✓ Database connected");

const db = drizzle(pool) as any;
const secrets = new PostgresSecretBackend(db);
const service = new IdentitySyncService(db, secrets);

const start = performance.now();

try {
  const importIdx = process.argv.indexOf("--import");
  if (importIdx !== -1) {
    // File-based import mode
    const provider = process.argv[importIdx + 1] as IdentityProviderType;
    const filePath = process.argv[importIdx + 2];
    if (!provider || !filePath) {
      console.error("Usage: --import <provider> <file.json>");
      process.exit(1);
    }

    const raw = await Bun.file(filePath).text();
    const users = JSON.parse(raw);
    console.log(`Importing ${users.length} ${provider} users from ${filePath}...\n`);

    const result = await service.importUsers(provider, users);
    console.log(`  ${result.provider}: linked=${result.linked} created=${result.created} skipped=${result.skipped} deactivated=${result.deactivated} errors=${result.errors}`);

    // Skip profile refresh for the imported provider (its API is likely unreachable)
    const skipProviders = new Set([provider] as import("./adapters/identity-provider-adapter").IdentityProviderType[]);
    console.log("\nRunning cross-provider sync (name merge + profile refresh, skipping " + provider + ")...");
    const crossResults = await service.runCrossProviderSync(skipProviders);
    for (const r of crossResults) {
      console.log(`  ${r.provider}: linked=${r.linked} created=${r.created} skipped=${r.skipped} deactivated=${r.deactivated} errors=${r.errors}`);
    }

    const elapsed = Math.round(performance.now() - start);
    console.log(`\n✓ Import complete in ${elapsed}ms`);
  } else {
    // Full sync mode
    console.log("Starting identity sync...\n");
    const results = await service.syncAllIdentities();
    const elapsed = Math.round(performance.now() - start);

    console.log(`\n✓ Sync complete in ${elapsed}ms\n`);
    for (const r of results) {
      console.log(`  ${r.provider}: linked=${r.linked} created=${r.created} skipped=${r.skipped} deactivated=${r.deactivated} errors=${r.errors}`);
    }
  }
} catch (err) {
  console.error("Sync failed:", err);
} finally {
  await pool.end();
}
