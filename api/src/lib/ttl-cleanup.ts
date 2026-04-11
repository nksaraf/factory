/**
 * Periodic TTL cleanup loop.
 * Cleans up expired sandboxes, routes, tunnels, and previews.
 * Also handles retention cleanup for the operation_run table.
 */
import { and, lt } from "drizzle-orm"

import type { Database } from "../db/connection"
import { operationRun } from "../db/schema/ops"
import { cleanupExpiredWorkspaces } from "../modules/fleet/service"
import {
  cleanupExpiredRoutes,
  cleanupStaleTunnels,
} from "../modules/infra/gateway.service"
import { runPreviewCleanup } from "../services/preview/preview.service"
import { type OperationRunner, createOperationRunner } from "./operations"

const RETENTION_DAYS = 30

/**
 * Start the periodic TTL cleanup loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startTtlCleanupLoop(
  db: Database,
  opts?: { intervalMs?: number }
): OperationRunner {
  return createOperationRunner(db, {
    name: "ttl-cleanup",
    intervalMs: opts?.intervalMs ?? 60_000,
    async execute(log) {
      const { cleaned } = await cleanupExpiredWorkspaces(db)
      if (cleaned > 0)
        log.info({ count: cleaned }, "cleaned up expired system deployments")

      const expiredRoutes = await cleanupExpiredRoutes(db)
      if (expiredRoutes > 0)
        log.info({ count: expiredRoutes }, "cleaned up expired routes")

      const staleTunnels = await cleanupStaleTunnels(db)
      if (staleTunnels > 0)
        log.info({ count: staleTunnels }, "cleaned up stale tunnels")

      const previewCleanup = await runPreviewCleanup(db)
      if (
        previewCleanup.expired > 0 ||
        previewCleanup.scaledToWarm > 0 ||
        previewCleanup.scaledToCold > 0 ||
        previewCleanup.deleted > 0
      ) {
        log.info(previewCleanup, "preview cleanup completed")
      }

      // Retention: clean up old operation_run rows
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const deleted = await db
        .delete(operationRun)
        .where(lt(operationRun.startedAt, cutoff))
        .returning()
      const retentionCleaned = deleted.length

      return {
        expiredSandboxes: cleaned,
        expiredRoutes,
        staleTunnels,
        ...previewCleanup,
        retentionCleaned,
      }
    },
  })
}
