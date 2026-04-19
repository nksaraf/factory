import { cors } from "@elysiajs/cors"
import { openapi } from "@elysiajs/openapi"
import type { GitHostProviderSpec } from "@smp/factory-shared/schemas/build"
import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"

import { createGitHostAdapter } from "./adapters/adapter-registry"
import { getObservabilityAdapter } from "./adapters/adapter-registry"
import { NoopGatewayAdapter } from "./adapters/gateway-adapter-noop"
import { resolveFactorySettings } from "./config/resolve-settings"
import { type Connection, type Database, connection } from "./db/connection"
import { migrate, migrationsDir } from "./db/migrator"
import { gitHostProvider } from "./db/schema/build"
import { FactoryAuthzClient } from "./lib/authz-client"
import { startGitHostSyncLoop } from "./lib/git-host-sync-loop"
import { startIdentitySyncLoop } from "./lib/identity-sync-loop"
import { startMessagingSyncLoop } from "./lib/messaging-sync-loop"
import { registerRunner, stopAll } from "./lib/operations"
import { startProxmoxSyncLoop } from "./lib/proxmox/sync-loop"
import { PostgresSecretBackend } from "./lib/secrets/postgres-backend"
import { startTtlCleanupLoop } from "./lib/ttl-cleanup"
import { startWorkTrackerSyncLoop } from "./lib/work-tracker/sync-loop"
import { createWorld } from "@workflow/world-postgres"
import { setWorkflowDb } from "./lib/workflow-helpers"
import { logger } from "./logger"
import { agentController } from "./modules/agent/index"
import { seedPlatformPresets } from "./modules/agent/preset.service"
import { deployCiController } from "./modules/build/deploy-ci.controller"
import { resolveGitHostAdapterConfig } from "./modules/build/git-host.service"
import { buildController } from "./modules/build/index"
import { webhookController } from "./modules/build/webhook.controller"
import { catalogController } from "./modules/catalog/catalog.controller"
import { setChatDb } from "./modules/chat/db"
import { commerceController } from "./modules/commerce/index"
import {
  documentsController,
  plansController,
  publicDocumentViewerController,
} from "./modules/documents/index"
import { healthController } from "./modules/health/index"
import { ideHookController } from "./modules/ide-hooks/index"
import { messagesController } from "./modules/messages/index"
import { configVarController } from "./modules/identity/config-var.controller"
import { identityController } from "./modules/identity/index"
import { secretController } from "./modules/identity/secret.controller"
import { infraController } from "./modules/infra/index"
import { installController } from "./modules/install/index"
import {
  messagingController,
  messagingWebhookController,
} from "./modules/messaging/index"
import { observabilityController } from "./modules/observability/index"
import { opsController } from "./modules/ops/index"
import { presenceController } from "./modules/presence/index"
import { productController } from "./modules/product/index"
import { threadSurfacesController } from "./modules/thread-surfaces/thread-surfaces.controller"
import { threadsController } from "./modules/threads/index"
import { jiraWebhookTrigger } from "./modules/workflow/triggers/jira-webhook"
import { workflowController } from "./modules/workflow/triggers/rest"

// Import workflows so they self-register in the workflow registry
import "./modules/workflow/workflows/god-workflow"
import "./modules/workflow/workflows/echo-workflow"
// Import chat module to register Chat SDK bot + handlers before webhooks arrive
import "./modules/chat/index"

import { KubeClientImpl } from "./lib/kube-client-impl"
import { closeNats } from "./lib/nats"
import { startOutboxRelayRunner } from "./lib/outbox-relay"
import { startGateway } from "./modules/infra/gateway-proxy"
import { getTunnelStreamManager } from "./modules/infra/tunnel-broker"
import { siteController } from "./modules/site/index"
import { SiteReconciler } from "./modules/site/reconciler"
import { operationsController } from "./modules/system/operations.controller"
import { authPlugin, principalPlugin } from "./plugins/auth.plugin"
import { errorHandlerPlugin } from "./plugins/error-handler.plugin"
import { Reconciler } from "./reconciler/reconciler"
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
  readonly observabilityAdapter = (() => {
    const lokiUrl = process.env.LOKI_URL
    if (lokiUrl) {
      logger.info({ lokiUrl }, "Using Loki observability adapter")
      return getObservabilityAdapter("loki", { lokiUrl })
    }
    return getObservabilityAdapter("noop")
  })()
  readonly authzClient: FactoryAuthzClient | null
  reconciler: Reconciler | null = null
  private effectRuntime:
    | import("effect/ManagedRuntime").ManagedRuntime<
        import("./effect/runtime").AppLayer,
        never
      >
    | null = null
  private redis?: {
    publisher: import("ioredis").Redis
    subscriber: import("ioredis").Redis
  }
  private workflowWorld?: { stop?(): Promise<void> }

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
    // Split controller registration into batches to reduce type chain depth
    // (tsgo hits "excessively deep" with 38+ chained .use() calls)
    const batch1 = new Elysia()
      .use(productController(db))
      .use(buildController(db))
      .use(commerceController(db))
      .use(opsController(db))

    const batch2 = new Elysia()
      .use(infraController(db))
      .use(agentController(db))
      .use(identityController(db))
      .use(secretController(db))
      .use(configVarController(db))
      .use(messagingController(db))
      .use(observabilityController(this.observabilityAdapter))
      .use(operationsController(db))
      .use(workflowController(db))
      .use(ideHookController(db))
      .use(threadsController(db))
      .use(threadSurfacesController(db))
      .use(messagesController(db))
      .use(documentsController(db))
      .use(plansController(db))
      .use(catalogController(db))

    const planeRoutes = new Elysia({ prefix: "/api/v1/factory" })
      .decorate("db", db)
      .decorate("effectRuntime", this.effectRuntime)
      .use(errorHandlerPlugin())
      .use(batch1)
      .use(batch2)

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

  private workflowHandlers() {
    return new Elysia()
      .post("/.well-known/workflow/v1/flow", async ({ request }) => {
        try {
          const path = "../.well-known/workflow/v1/flow.js"
          const mod = await import(/* @vite-ignore */ path)
          return mod.POST(request)
        } catch {
          return new Response("Workflow handlers not built", { status: 503 })
        }
      })
      .post("/.well-known/workflow/v1/step", async ({ request }) => {
        try {
          const path = "../.well-known/workflow/v1/step.js"
          const mod = await import(/* @vite-ignore */ path)
          return mod.POST(request)
        } catch {
          return new Response("Workflow handlers not built", { status: 503 })
        }
      })
      .post("/.well-known/workflow/v1/webhook/:token", async ({ request }) => {
        try {
          const path = "../.well-known/workflow/v1/webhook.js"
          const mod = await import(/* @vite-ignore */ path)
          return mod.POST(request)
        } catch {
          return new Response("Workflow handlers not built", { status: 503 })
        }
      })
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
        logger.info(
          {
            method: request.method,
            path: url.pathname,
            host: request.headers.get("host"),
          },
          `${request.method} ${url.pathname}`
        )
      })
      .onError(({ request, error, code }) => {
        const url = new URL(request.url)
        logger.error(
          { method: request.method, path: url.pathname, code, err: error },
          `${request.method} ${url.pathname} failed (${code})`
        )
      })
      .use(this.workflowHandlers())
      .use(healthController)
      .use(installController)
      .use(presenceController(() => this.redis))
      .use(webhookController(db))
      .use(messagingWebhookController(db))
      .use(jiraWebhookTrigger(db))
      .use(deployCiController(db))
      .use(publicDocumentViewerController(db))
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
    let gitHost
    try {
      const [ghProvider] = await this.db
        .select()
        .from(gitHostProvider)
        .where(eq(gitHostProvider.type, "github"))
        .limit(1)
      if (ghProvider) {
        const spec = (ghProvider.spec ?? {}) as GitHostProviderSpec
        if (spec.status === "active" || !spec.status) {
          gitHost = createGitHostAdapter(
            "github",
            await resolveGitHostAdapterConfig(this.db, spec)
          )
          logger.info(
            { provider: ghProvider.name },
            "Loaded GitHub adapter for preview reconciler"
          )
        }
      } else {
        logger.warn(
          "No active GitHub provider found — preview PR comments/checks will be skipped"
        )
      }
    } catch (err) {
      logger.warn(
        { err },
        "Failed to load GitHub adapter — preview PR integration disabled"
      )
    }

    this.reconciler = new Reconciler(this.db, new KubeClientImpl(), gitHost)
    registerRunner(this.reconciler.startOperationRunner(this.db))
    registerRunner(startTtlCleanupLoop(this.db))
    registerRunner(startProxmoxSyncLoop(this.db))
    registerRunner(startWorkTrackerSyncLoop(this.db))
    registerRunner(startGitHostSyncLoop(this.db))
    registerRunner(
      startIdentitySyncLoop(this.db, new PostgresSecretBackend(this.db))
    )
    registerRunner(startMessagingSyncLoop(this.db))
    registerRunner(startOutboxRelayRunner(this.db))

    // Start gateway proxy for tunnel routing on port 9090
    try {
      startGateway({ db: this.db, getTunnelStreamManager })
    } catch (err) {
      logger.warn(
        { err },
        "Gateway proxy failed to start — tunnels will not work"
      )
    }

    seedPlatformPresets(this.db).catch((err) =>
      logger.warn({ err }, "role preset seeding failed")
    )

    // Initialize Workflow SDK with Postgres World
    setWorkflowDb(this.db)
    setChatDb(this.db)
    if (url) {
      const world = createWorld({
        connectionString: url,
        jobPrefix: "factory_",
      })
      this.workflowWorld = world as any
      await world.start()
      logger.info("Workflow SDK Postgres World started")
    }

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
        logger.warn(
          { err },
          "Redis unavailable — presence limited to single instance"
        )
      }
    }

    // IAM registry bootstrap (resource types, scope types, slot mappings) is
    // owned by auth-service's bootstrapIamRegistry() — no client-side bootstrap needed.

    // Effect runtime — provides Db + FactoryConfig to Effect programs
    const { ManagedRuntime } = await import("effect")
    const { createAppLayer } = await import("./effect/runtime")
    this.effectRuntime = ManagedRuntime.make(
      createAppLayer(this.db, this.settings)
    )
    logger.info("Effect runtime initialized")
  }

  async close() {
    stopAll()
    await closeNats().catch(() => {})
    if (this.effectRuntime) {
      await this.effectRuntime.dispose().catch(() => {})
    }
    if (this.redis) {
      this.redis.publisher.disconnect()
      this.redis.subscriber.disconnect()
    }
    if (this.workflowWorld?.stop) {
      await this.workflowWorld.stop().catch(() => {})
    }
    if (this.db) {
      await this.db.$client.end()
    }
  }
}
