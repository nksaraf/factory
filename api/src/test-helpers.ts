import type { PGlite } from "@electric-sql/pglite"
import { cors } from "@elysiajs/cors"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Elysia } from "elysia"

import type { Database } from "./db/connection"
import { createPgliteDb, migrateWithPglite } from "./factory-core"
import { agentController } from "./modules/agent/index"
import { buildController } from "./modules/build/index"
import { commerceController } from "./modules/commerce/index"
import { healthController } from "./modules/health/index"
import { identityController } from "./modules/identity/index"
import { infraController } from "./modules/infra/index"
import { messagingController } from "./modules/messaging/index"
import { opsController } from "./modules/ops/index"
import { productController } from "./modules/product/index"
import { errorHandlerPlugin } from "./plugins/error-handler.plugin"

/** Absolute drizzle migrations dir (for tests and ad-hoc PGlite setup). */
export const TEST_DRIZZLE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle"
)

/** In-memory PGlite + migrations (shared path with createTestContext). */
export async function createMigratedTestPglite(): Promise<{
  client: PGlite
  db: Database
}> {
  const { client, db } = await createPgliteDb()
  await migrateWithPglite(client, TEST_DRIZZLE_MIGRATIONS_DIR)
  return { client, db }
}

export async function createTestContext() {
  const { client, db } = await createMigratedTestPglite()

  const database = db as unknown as Database

  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .use(errorHandlerPlugin())
    .decorate("db", database)
    .use(productController(database))
    .use(buildController(database))
    .use(agentController(database))
    .use(commerceController(database))
    .use(opsController(database))
    .use(infraController(database))
    .use(identityController(database))
    .use(messagingController(database))

  const app = new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes)

  return { app, db, client }
}

export type TestApp = Awaited<ReturnType<typeof createTestContext>>["app"]

const TRUNCATE_STATEMENTS = [
  // ops
  `TRUNCATE TABLE ops.forwarded_port RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.connection_audit_event RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.intervention RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.rollout RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.component_deployment RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.preview RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.workbench_snapshot RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.workbench RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.deployment_set RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.system_deployment RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.install_manifest RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.site_manifest RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.site RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.tenant RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.workbench RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.database_operation RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.database RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE ops.anonymization_profile RESTART IDENTITY CASCADE`,
  // commerce
  `TRUNCATE TABLE commerce.subscription_item RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE commerce.subscription RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE commerce.entitlement_bundle RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE commerce.plan RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE commerce.billable_metric RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE commerce.customer RESTART IDENTITY CASCADE`,
  // build
  `TRUNCATE TABLE build.work_tracker_project RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.work_tracker_project_mapping RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.work_tracker_provider RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.work_item RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.git_user_sync RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.git_repo_sync RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.pipeline_step RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.pipeline_run RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.webhook_event RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.github_app_installation RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.component_artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.system_version RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.repo RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE build.git_host_provider RESTART IDENTITY CASCADE`,
  // org (events)
  `TRUNCATE TABLE org.event_outbox RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event RESTART IDENTITY CASCADE`,
  // org
  `TRUNCATE TABLE org.event_alert RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event_delivery RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event_aggregate RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event_subscription_channel RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event_subscription RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.workflow_run RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.tool_usage RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.tool_credential RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.memory RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.job RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.agent RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.role_preset RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.ssh_key RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.identity_link RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.messaging_provider RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.secret RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.config_var RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.entity_relationship RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.membership RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.scope RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.principal RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.team RESTART IDENTITY CASCADE`,
  // software
  `TRUNCATE TABLE software.release_artifact_pin RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.release RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.capability RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.api RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.template RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.product_system RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.component RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.system RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE software.product RESTART IDENTITY CASCADE`,
  // infra
  `TRUNCATE TABLE infra.tunnel RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.route RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.dns_domain RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.network_link RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.ip_address RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.secret RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.host RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.realm RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE infra.estate RESTART IDENTITY CASCADE`,
]

/**
 * Insert seed parent rows that many tests need for FK constraints.
 * Called automatically after truncateAllTables.
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function seedTestParents(client: PGlite) {
  const teamIds = ["t1", "team_1", "platform"]
  const principalIds = ["user_1", "testuser"]
  const repoIds = ["unknown"]

  for (const id of teamIds) {
    try {
      await client.query(
        `INSERT INTO org.team (id, slug, name, type, spec, metadata)
         VALUES ($1, $2, $3, 'team', '{}', '{}')
         ON CONFLICT (id) DO NOTHING`,
        [id, id, `Team ${id}`]
      )
    } catch {
      /* table may not exist */
    }
  }

  for (const id of principalIds) {
    try {
      await client.query(
        `INSERT INTO org.principal (id, slug, name, type, spec, metadata)
         VALUES ($1, $2, $3, 'human', '{}', '{}')
         ON CONFLICT (id) DO NOTHING`,
        [id, id, `User ${id}`]
      )
    } catch {
      /* table may not exist */
    }
  }

  for (const id of repoIds) {
    try {
      await client.query(
        `INSERT INTO build.repo (id, slug, name, spec)
         VALUES ($1, $2, $3, '{}')
         ON CONFLICT (id) DO NOTHING`,
        [id, id, `Repo ${id}`]
      )
    } catch {
      /* table may not exist */
    }
  }

  // Seed a default site for preview/webhook tests
  try {
    await client.query(
      `INSERT INTO ops.site (id, slug, name, spec, metadata)
       VALUES ('site_default', 'default', 'Default Site',
               '{"previewConfig":{"enabled":true,"defaultAuthMode":"team","ttlDays":7}}',
               '{}')
       ON CONFLICT (id) DO NOTHING`
    )
  } catch {
    /* table may not exist */
  }

  // Seed a default realm for workbench creation (workbench beforeCreate hook requires it)
  try {
    await client.query(
      `INSERT INTO infra.realm (id, slug, name, type, spec)
       VALUES ('rt_seed', '_seed-realm', 'Seed Realm', 'k8s-cluster',
               '{"status":"ready","isDefault":true}')
       ON CONFLICT (id) DO NOTHING`
    )
  } catch {
    /* table may not exist */
  }
}

export async function truncateAllTables(client: PGlite) {
  for (const stmt of TRUNCATE_STATEMENTS) {
    try {
      await client.query(stmt)
    } catch (err: any) {
      // Skip tables that don't exist yet (migration may not have created them)
      if (err?.code === "42P01") continue
      throw err
    }
  }
  // Re-seed parent rows that FK constraints commonly reference
  await seedTestParents(client)
}
