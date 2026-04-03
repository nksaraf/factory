import { cors } from "@elysiajs/cors"
import { openapi } from "@elysiajs/openapi"
import { Elysia } from "elysia"

import { and, eq } from "drizzle-orm"
import { createGitHostAdapter } from "./adapters/adapter-registry"
import { NoopGatewayAdapter } from "./adapters/gateway-adapter-noop"
import { NoopObservabilityAdapter } from "./adapters/observability-adapter-noop"
import { NoopSandboxAdapter } from "./adapters/sandbox-adapter-noop"
import { resolveFactorySettings } from "./config/resolve-settings"
import { type Connection, type Database, connection } from "./db/connection"
import { migrate, migrationsDir } from "./db/migrator"
import { gitHostProvider } from "./db/schema/build"
import { parseCredentials } from "./lib/parse-credentials"
import { FactoryAuthzClient } from "./lib/authz-client"
import { startGitHostSyncLoop } from "./lib/git-host-sync-loop"
import { startIdentitySyncLoop } from "./lib/identity-sync-loop"
import { startProxmoxSyncLoop } from "./lib/proxmox/sync-loop"
import { startTtlCleanupLoop } from "./lib/ttl-cleanup"
import { startWorkTrackerSyncLoop } from "./lib/work-tracker/sync-loop"
import { startMessagingSyncLoop } from "./lib/messaging-sync-loop"
import { logger } from "./logger"
import { presenceController } from "./modules/presence/index"
import { agentController } from "./modules/agent/index"
import { memoryController } from "./modules/memory/index"
import { seedPlatformPresets } from "./modules/agent/preset.service"
import { identityController } from "./modules/identity/index"
import { buildController } from "./modules/build/index"
import { webhookController } from "./modules/build/webhook.controller"
import { messagingController, messagingWebhookController } from "./modules/messaging/index"
import { commerceController } from "./modules/commerce/index"
import { fleetController } from "./modules/fleet/index"
import { healthController } from "./modules/health/index"
import { gatewayController } from "./modules/infra/gateway.controller"
import { accessController } from "./modules/infra/access.controller"
import { infraController } from "./modules/infra/index"
import { previewController } from "./modules/infra/preview.controller"
import { previewCiController } from "./modules/infra/preview-ci.controller"
import { sandboxController } from "./modules/infra/sandbox.controller"
import { observabilityController } from "./modules/observability/index"
import { productController } from "./modules/product/index"
import { releaseContentController } from "./modules/release-content/index"
import { siteController } from "./modules/site/index"
import { SiteReconciler } from "./modules/site/reconciler"
import { Reconciler } from "./reconciler/reconciler"
import { KubeClientImpl } from "./lib/kube-client-impl"
import { authPlugin, principalPlugin } from "./plugins/auth.plugin"
import {
  type FactorySettings,
  getAuthServiceUrl,
  getDatabaseUrl,
  getJwksUrl,
  getMode,
  getRedisUrl,
  getSiteConfig,
} from "./settings"

export class FactoryAPI {
  readonly db: Connection | null
  readonly settings: FactorySettings
  readonly sandboxAdapter = new NoopSandboxAdapter()
  readonly observabilityAdapter = new NoopObservabilityAdapter()
  readonly authzClient: FactoryAuthzClient | null
  reconciler: Reconciler | null = null
  private redis?: { publisher: import("ioredis").Redis; subscriber: import("ioredis").Redis }
  private stopTtlCleanup?: () => void
  private stopProxmoxSync?: () => void
  private stopWorkTrackerSync?: () => void
  private stopGitHostSync?: () => void
  private stopIdentitySync?: () => void
  private stopMessagingSync?: () => void
  private stopReconcilerLoop?: NodeJS.Timeout

  constructor(settings: FactorySettings) {
    this.settings = settings
    const mode = getMode(settings)
    const url = getDatabaseUrl(settings)
    const authUrl = getAuthServiceUrl(settings)

    this.authzClient = authUrl ? new FactoryAuthzClient(authUrl) : null

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
      .use(accessController(db))
      .use(gatewayController(db))
      .use(sandboxController(db, this.authzClient, () => this.reconciler))
      .use(previewController(db))

    const planeRoutes = new Elysia({ prefix: "/api/v1/factory" })
      .decorate("db", db)
      .use(productController(db))
      .use(buildController(db))
      .use(agentController(db))
      .use(memoryController(db))
      .use(commerceController(db))
      .use(fleetController(db))
      .use(releaseContentController(db))
      .use(identityController(db))
      .use(infraRoutes)
      .use(observabilityController(this.observabilityAdapter))
      .use(messagingController(db))

    if (jwksUrl) {
      return new Elysia()
        .use(authPlugin(jwksUrl))
        .use(principalPlugin(db))
        .use(planeRoutes)
    }

    logger.warn(
      "No JWKS URL configured — factory-api plane routes are unauthenticated"
    )
    return planeRoutes
  }

  private mountSiteControllers() {
    const siteConfig = getSiteConfig(this.settings)
    const adapter = new NoopGatewayAdapter()
    const reconciler = new SiteReconciler(
      {
        siteName: siteConfig.name,
        factoryUrl: siteConfig.factoryUrl,
        namespace: siteConfig.namespace,
        issuerName: siteConfig.issuerName,
        pollIntervalMs: siteConfig.pollIntervalMs,
      },
      adapter
    )
    return new Elysia({ prefix: "/api/v1/site" }).use(
      siteController(reconciler)
    )
  }

  createApp() {
    const jwksUrl = getJwksUrl(this.settings)
    // All routes are registered unconditionally so the return type captures
    // the full API surface for Eden type-safe clients.  In site-only mode
    // this.db is null, but factory routes won't receive traffic — they exist
    // purely for the Eden type chain.
    const db = this.db as Database

    return new Elysia()
      .use(cors({ credentials: true, origin: true }))
      .onRequest(({ request }) => {
        const url = new URL(request.url)
        // Skip health checks to reduce noise
        if (url.pathname === "/health") return
        logger.info({ method: request.method, path: url.pathname, host: request.headers.get("host") }, "request")
      })
      .onError(({ request, error, code }) => {
        const url = new URL(request.url)
        logger.error({ method: request.method, path: url.pathname, code, err: error }, "request error")
      })
      .use(healthController)
      .use(presenceController(() => this.redis))
      .use(webhookController(db))
      .use(messagingWebhookController(db))
      .use(previewCiController(db))
      .use(this.mountFactoryControllers(db, jwksUrl))
      .use(this.mountSiteControllers())
      .use(
        openapi({
          path: "/api/v1/factory/openapi",
          documentation: {
            info: {
              title: "Factory API",
              version: "0.0.1",
              description: "Software factory control plane",
            },
          },
        })
      )
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
    // Load first active GitHub provider for preview PR comments/deployments/checks
    let gitHost;
    try {
      const [ghProvider] = await this.db.select().from(gitHostProvider)
        .where(and(eq(gitHostProvider.hostType, "github"), eq(gitHostProvider.status, "active")))
        .limit(1);
      if (ghProvider) {
        gitHost = createGitHostAdapter("github", {
          ...parseCredentials(ghProvider.credentialsEnc),
          apiBaseUrl: ghProvider.apiBaseUrl ?? undefined,
        });
        logger.info({ provider: ghProvider.name }, "Loaded GitHub adapter for preview reconciler");
      } else {
        logger.warn("No active GitHub provider found — preview PR comments/checks will be skipped");
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load GitHub adapter — preview PR integration disabled");
    }

    this.reconciler = new Reconciler(this.db, new KubeClientImpl(), gitHost)
    this.stopReconcilerLoop = this.reconciler.startLoop()
    this.stopTtlCleanup = startTtlCleanupLoop(this.db, this.sandboxAdapter)
    this.stopProxmoxSync = startProxmoxSyncLoop(this.db)
    this.stopWorkTrackerSync = startWorkTrackerSyncLoop(this.db)
    this.stopGitHostSync = startGitHostSyncLoop(this.db)
    this.stopIdentitySync = startIdentitySyncLoop(this.db)
    this.stopMessagingSync = startMessagingSyncLoop(this.db)

    seedPlatformPresets(this.db).catch((err) =>
      logger.warn({ err }, "role preset seeding failed")
    )

    // Set up Redis for presence fan-out (optional — degrades gracefully)
    const redisUrl = getRedisUrl(this.settings)
    if (redisUrl) {
      try {
        const { default: IORedis } = await import("ioredis")
        this.redis = {
          publisher: new IORedis(redisUrl),
          subscriber: new IORedis(redisUrl),
        }
        logger.info("Redis connected for presence fan-out")
      } catch (err) {
        logger.warn({ err }, "Redis unavailable — presence limited to single instance")
      }
    }

    // IAM registry bootstrap (resource types, scope types, slot mappings) is
    // owned by auth-service's bootstrapIamRegistry() — no client-side bootstrap needed.
  }

  async close() {
    if (this.stopReconcilerLoop) clearInterval(this.stopReconcilerLoop)
    this.stopTtlCleanup?.()
    this.stopProxmoxSync?.()
    this.stopWorkTrackerSync?.()
    this.stopGitHostSync?.()
    this.stopIdentitySync?.()
    this.stopMessagingSync?.()
    if (this.redis) {
      this.redis.publisher.disconnect()
      this.redis.subscriber.disconnect()
    }
    if (this.db) {
      await this.db.$client.end()
    }
  }
}
