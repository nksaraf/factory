/**
 * Standalone webhook server for Slack URL verification and testing.
 * Run: FACTORY_DATABASE_URL=postgres://... bun run api/src/standalone-webhook-server.ts
 */
import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import pg from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { messagingWebhookController } from "./modules/messaging/messaging-webhook.controller"
import { webhookController } from "./modules/build/webhook.controller"

const DB_URL = process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL
if (!DB_URL) {
  console.error("FACTORY_DATABASE_URL is required")
  process.exit(1)
}

const PORT = Number(process.env.PORT ?? 4100)

// Use pg.Pool directly so drizzle can query custom schemas (factory_org, etc.)
const pool = new pg.Pool({ connectionString: DB_URL })
await pool.query("SELECT 1")
console.log("✓ Database connected")
const db = drizzle(pool) as any

const app = new Elysia()
  .use(cors({ credentials: true, origin: true }))
  .get("/health", () => ({ status: "ok" }))
  .use(messagingWebhookController(db))
  .use(webhookController(db))
  .listen(PORT)

console.log(`✓ Webhook server running on http://localhost:${PORT}`)
console.log(
  `  Slack webhook: POST http://localhost:${PORT}/webhooks/messaging/{providerId}`
)
console.log(`  Health: GET http://localhost:${PORT}/health`)
