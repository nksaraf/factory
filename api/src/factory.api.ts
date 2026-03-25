import { cors } from "@elysiajs/cors"
import { openapi } from "@elysiajs/openapi"
import { Elysia } from "elysia"

import { resolveFactorySettings } from "./config/resolve-settings"
import { agentController } from "./modules/agent/index"
import { buildController } from "./modules/build/index"
import { commerceController } from "./modules/commerce/index"
import { fleetController } from "./modules/fleet/index"
import { gatewayController } from "./modules/infra/gateway.controller"
import { healthController } from "./modules/health/index"
import { infraController } from "./modules/infra/index"
import { productController } from "./modules/product/index"
import { sandboxController } from "./modules/infra/sandbox.controller"
import { type Connection, type Database, connection } from "./db/connection"
import { migrate, migrationsDir } from "./db/migrator"
import { logger } from "./logger"
import { authPlugin } from "./plugins/auth.plugin"
import { NoopSandboxAdapter } from "./adapters/sandbox-adapter-noop"
import { NoopObservabilityAdapter } from "./adapters/observability-adapter-noop"
import { NoopGatewayAdapter } from "./adapters/gateway-adapter-noop"
import { observabilityController } from "./modules/observability/index"
import { siteController } from "./modules/site/index"
import { SiteReconciler } from "./modules/site/reconciler"
import { startTtlCleanupLoop } from "./lib/ttl-cleanup"
import { startProxmoxSyncLoop } from "./lib/proxmox/sync-loop"
import { startWorkTrackerSyncLoop } from "./lib/work-tracker/sync-loop"
import { startGitHostSyncLoop } from "./lib/git-host-sync-loop"
import { webhookController } from "./modules/build/webhook.controller"
import { FactoryAuthResourceClient } from "./lib/auth-resource-client"
import { bootstrapResourceTypes } from "./lib/auth-resource-bootstrap"
import { type FactorySettings, getDatabaseUrl, getAuthServiceUrl, getJwksUrl, getMode, getSiteConfig } from "./settings"

export class FactoryAPI {
  readonly db: Connection | null
  readonly settings: FactorySettings
  readonly sandboxAdapter = new NoopSandboxAdapter()
  readonly observabilityAdapter = new NoopObservabilityAdapter()
  readonly authClient: FactoryAuthResourceClient | null
  private stopTtlCleanup?: () => void
  private stopProxmoxSync?: () => void
  private stopWorkTrackerSync?: () => void
  private stopGitHostSync?: () => void

  constructor(settings: FactorySettings) {
    this.settings = settings
    const mode = getMode(settings)
    const url = getDatabaseUrl(settings)
    const authUrl = getAuthServiceUrl(settings)

    this.authClient = authUrl ? new FactoryAuthResourceClient(authUrl) : null

    if (mode === "site") {
      // Site mode does not require a database
      this.db = null
    } else {
      if (!url) {
        throw new Error(
          "FACTORY_DATABASE_URL or DATABASE_URL is required for factory-api"
        )
      }
      this.db = connection(url)
    }
  }

  static async create(): Promise<FactoryAPI> {
    const settings = await resolveFactorySettings()
    return new FactoryAPI(settings)
  }

  private mountFactoryControllers(db: Database, jwksUrl: string | undefined) {
    const infraRoutes = new Elysia({ prefix: "/infra" })
      .use(infraController(db))
      .use(gatewayController(db))
      .use(sandboxController(db))

    const planeRoutes = new Elysia({ prefix: "/api/v1/factory" })
      .decorate("db", db)
      .use(productController(db))
      .use(buildController(db))
      .use(agentController)
      .use(commerceController(db))
      .use(fleetController(db))
      .use(infraRoutes)
      .use(observabilityController(this.observabilityAdapter))

    if (jwksUrl) {
      return new Elysia().use(authPlugin(jwksUrl)).use(planeRoutes)
    }

    logger.warn(
      "No JWKS URL configured — factory-api plane routes are unauthenticated"
    )
    return planeRoutes
  }

  private mountSiteControllers() {
    const siteConfig = getSiteConfig(this.settings)
    const adapter = new NoopGatewayAdapter()
    const reconciler = new SiteReconciler({
      siteName: siteConfig.name,
      factoryUrl: siteConfig.factoryUrl,
      namespace: siteConfig.namespace,
      issuerName: siteConfig.issuerName,
      pollIntervalMs: siteConfig.pollIntervalMs,
    }, adapter)
    return new Elysia({ prefix: "/api/v1/site" }).use(siteController(reconciler))
  }

  createApp() {
    const mode = getMode(this.settings)
    const jwksUrl = getJwksUrl(this.settings)

    const app = new Elysia()
      .use(cors({ credentials: true, origin: true }))
      .use(healthController)

    if (mode === "factory" || mode === "dev") {
      const db: Database = this.db!
      app.use(webhookController(db))
      app.use(this.mountFactoryControllers(db, jwksUrl))
    }

    if (mode === "site" || mode === "dev") {
      app.use(this.mountSiteControllers())
    }

    app.use(
      openapi({
        documentation: {
          info: {
            title: "Factory API",
            version: "0.0.1",
            description: "Software factory control plane",
          },
        },
      })
    )

    return app
  }

  async setupDb() {
    if (!this.db) {
      logger.info("No database connection — skipping migrations")
      return
    }
    const url = getDatabaseUrl(this.settings)
    if (!url) {
      logger.warn("No database URL — skipping migrations")
      return
    }
    logger.info("running factory migrations")
    const start = performance.now()
    await migrate(this.db, {
      migrationsFolder: migrationsDir,
      migrationsSchema: "public",
      migrationsTable: "factory_migrations",
    })
    logger.info(
      { durationMs: Math.round(performance.now() - start) },
      "factory migrations complete"
    )
    this.stopTtlCleanup = startTtlCleanupLoop(this.db, this.sandboxAdapter)
    this.stopProxmoxSync = startProxmoxSyncLoop(this.db)
    this.stopWorkTrackerSync = startWorkTrackerSyncLoop(this.db)
    this.stopGitHostSync = startGitHostSyncLoop(this.db)

    if (this.authClient) {
      bootstrapResourceTypes(this.authClient).catch(err =>
        logger.warn({ err }, "resource type bootstrap failed")
      )
    }
  }

  async close() {
    this.stopTtlCleanup?.()
    this.stopProxmoxSync?.()
    this.stopWorkTrackerSync?.()
    this.stopGitHostSync?.()
    if (this.db) {
      await this.db.$client.end()
    }
  }
}
