/**
 * Periodic work tracker sync loop
 * Syncs all active work tracker providers on a timer + on startup
 */
import type { WorkTrackerProviderSpec } from "@smp/factory-shared/schemas/build"

import type { Database } from "../../db/connection"
import { workTrackerProvider } from "../../db/schema/build-v2"
import { syncWorkTracker } from "../../modules/build/work-tracker.service"
import { type OperationRunner, createOperationRunner } from "../operations"

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Start the periodic work tracker sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startWorkTrackerSyncLoop(
  db: Database,
  opts?: { intervalMs?: number }
): OperationRunner {
  return createOperationRunner(db, {
    name: "work-tracker",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const allProviders = await db.select().from(workTrackerProvider)
      const providers = allProviders.filter((provider) => {
        const spec = (provider.spec ?? {}) as WorkTrackerProviderSpec
        return spec.status === "active" || !spec.status
      })

      if (providers.length === 0) return { providers: 0 }

      let synced = 0
      let errors = 0
      for (const prov of providers) {
        try {
          const result = await syncWorkTracker(db, prov.id)
          log.info(
            { providerId: prov.id, name: prov.name, ...result },
            "work tracker sync complete"
          )
          synced++
        } catch (err) {
          log.error(
            { err, providerId: prov.id, name: prov.name },
            "work tracker sync failed"
          )
          errors++
        }
      }

      return { providers: providers.length, synced, errors }
    },
  })
}
