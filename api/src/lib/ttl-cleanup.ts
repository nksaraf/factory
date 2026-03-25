import type { Database } from "../db/connection"
import type { SandboxAdapter } from "../adapters/sandbox-adapter"
import { cleanupExpiredSandboxes } from "../modules/fleet/service"
import { cleanupExpiredRoutes, cleanupStaleTunnels } from "../modules/infra/gateway.service"
import { logger } from "../logger"

export function startTtlCleanupLoop(
  db: Database,
  adapter: SandboxAdapter,
  opts?: { intervalMs?: number }
) {
  const interval = opts?.intervalMs ?? 60_000

  const timer = setInterval(async () => {
    try {
      const { cleaned } = await cleanupExpiredSandboxes(db, adapter)
      if (cleaned > 0) {
        logger.info({ count: cleaned }, "cleaned up expired deployment targets")
      }

      const expiredRoutes = await cleanupExpiredRoutes(db)
      if (expiredRoutes > 0) {
        logger.info({ count: expiredRoutes }, "cleaned up expired routes")
      }

      const staleTunnels = await cleanupStaleTunnels(db)
      if (staleTunnels > 0) {
        logger.info({ count: staleTunnels }, "cleaned up stale tunnels")
      }
    } catch (err) {
      logger.error({ err }, "TTL cleanup failed")
    }
  }, interval)

  return () => clearInterval(timer)
}
