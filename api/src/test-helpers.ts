import path from "node:path"

import { cors } from "@elysiajs/cors"
import { Elysia } from "elysia"
import type { PGlite } from "@electric-sql/pglite"

import type { Database } from "./db/connection"
import { agentController } from "./modules/agent/index"
import { buildController } from "./modules/build/index"
import { commerceController } from "./modules/commerce/index"
import { fleetController } from "./modules/fleet/index"
import { gatewayController } from "./modules/infra/gateway.controller"
import { healthController } from "./modules/health/index"
import { infraController } from "./modules/infra/index"
import { productController } from "./modules/product/index"
import { previewController } from "./modules/infra/preview.controller"
import { sandboxController } from "./modules/infra/sandbox.controller"
import { createPgliteDb, migrateWithPglite } from "./factory-core"

export async function createTestContext() {
  const { client, db } = await createPgliteDb()

  await migrateWithPglite(client, path.join(process.cwd(), "drizzle"))

  const database = db as unknown as Database

  const infraRoutes = new Elysia({ prefix: "/infra" })
    .use(infraController(database))
    .use(gatewayController(database))
    .use(sandboxController(database, null))
    .use(previewController(database))

  const factoryRoutes = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", database)
    .use(productController(database))
    .use(buildController(database))
    .use(agentController(database))
    .use(commerceController(database))
    .use(fleetController(database))
    .use(infraRoutes)

  const app = new Elysia()
    .use(cors({ credentials: true, origin: true }))
    .use(healthController)
    .use(factoryRoutes)

  return { app, db, client }
}

export type TestApp = Awaited<ReturnType<typeof createTestContext>>["app"]

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
  `TRUNCATE TABLE factory_fleet.preview RESTART IDENTITY CASCADE`,
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
  `TRUNCATE TABLE factory_build.git_user_sync RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.git_repo_sync RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.pipeline_step_run RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.pipeline_run RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.webhook_event RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.github_app_installation RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.component_artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.artifact RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.module_version RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.repo RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_build.git_host_provider RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_agent.agent_execution RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_agent.agent RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.work_item RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.component_spec RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_product.module RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_org.team RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.ip_address RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.subnet RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.kube_node RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.vm RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.vm_cluster RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.host RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.datacenter RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.cluster RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.region RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE factory_infra.provider RESTART IDENTITY CASCADE`,
]

export async function truncateAllTables(client: PGlite) {
  for (const sql of TRUNCATE_STATEMENTS) {
    await client.query(sql)
  }
}
