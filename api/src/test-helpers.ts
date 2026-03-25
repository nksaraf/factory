import fs from "node:fs";
import path from "node:path";

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";

import type { Database } from "./db/connection";
import * as schema from "./db/schema";
import { agentController } from "./modules/agent/index";
import { buildController } from "./modules/build/index";
import { commerceController } from "./modules/commerce/index";
import { fleetController } from "./modules/fleet/index";
import { gatewayController } from "./modules/infra/gateway.controller";
import { healthController } from "./modules/health/index";
import { infraController } from "./modules/infra/index";
import { productController } from "./modules/product/index";
import { sandboxController } from "./modules/infra/sandbox.controller";

/**
 * PGlite cannot handle multi-statement SQL in a single prepared statement.
 * This custom migrator reads SQL files from the drizzle folder and executes
 * each statement individually.
 */
async function migrateWithPglite(client: PGlite, migrationsFolder: string) {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  // Ensure migration tracking table exists
  await client.query(`CREATE SCHEMA IF NOT EXISTS public`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.factory_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  const applied = await client.query<{ hash: string }>(
    `SELECT hash FROM public.factory_migrations`
  );
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));

  for (const entry of journal.entries) {
    if (appliedHashes.has(entry.tag)) continue;

    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) continue;

    const content = fs.readFileSync(sqlFile, "utf-8");
    // Drizzle migrations use --> statement-breakpoint as delimiter;
    // some hand-written migrations use plain semicolons instead.
    const hasBreakpoints = content.includes("--> statement-breakpoint");
    const raw = hasBreakpoints
      ? content.split(/-->\s*statement-breakpoint/)
      : content.split(/;\s*\n/);
    const statements = raw
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim()
      )
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }

    await client.query(
      `INSERT INTO public.factory_migrations (hash, created_at) VALUES ($1, $2)`,
      [entry.tag, Date.now()]
    );
  }
}

export async function createTestContext() {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });

  await migrateWithPglite(client, path.join(process.cwd(), "drizzle"));

  const database = db as unknown as Database;

  const infraRoutes = new Elysia({ prefix: "/infra" })
    .use(infraController(database))
    .use(gatewayController(database))
    .use(sandboxController(database));

  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", database)
    .use(productController(database))
    .use(buildController(database))
    .use(agentController)
    .use(commerceController(database))
    .use(fleetController(database))
    .use(infraRoutes)

  const app = new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes);

  return { app, db, client };
}

export type TestApp = Awaited<ReturnType<typeof createTestContext>>["app"];

const TRUNCATE_STATEMENTS = [
  `TRUNCATE TABLE factory_fleet.tunnel RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.route RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.domain RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.connection_audit_event RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.workload_override RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.intervention RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.rollout RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.dependency_workload RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.workload RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.sandbox_access RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.sandbox_snapshot RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.sandbox RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.sandbox_template RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.deployment_target RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.release_module_pin RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.release RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.site_manifest RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_fleet.site RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_commerce.entitlement_bundle RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_commerce.entitlement RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_commerce.plan RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_commerce.customer_account RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.component_artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.module_version RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.repo RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_agent.agent_execution RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_agent.agent RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.work_item RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.component_spec RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.module RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.ip_address RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.subnet RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.kube_node RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.vm RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.proxmox_cluster RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.host RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.datacenter RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.cluster RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.region RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.provider RESTART IDENTITY CASCADE`,
];

export async function truncateAllTables(client: PGlite) {
  for (const sql of TRUNCATE_STATEMENTS) {
    await client.query(sql);
  }
}
