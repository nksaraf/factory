/**
 * Periodic work tracker sync loop
 * Syncs all active work tracker providers on a timer + on startup
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { workTrackerProvider } from "../../db/schema/product";
import { syncWorkTracker } from "../../services/product/work-tracker.service";
import { createOperationRunner, type OperationRunner } from "../operations";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start the periodic work tracker sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startWorkTrackerSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): OperationRunner {
  return createOperationRunner(db, {
    name: "work-tracker",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const syncable = await db
        .select()
        .from(workTrackerProvider)
        .where(
          and(
            eq(workTrackerProvider.status, "active"),
            eq(workTrackerProvider.syncEnabled, true),
          ),
        );

      if (syncable.length === 0) return { providers: 0 };

      let synced = 0;
      let errors = 0;
      for (const prov of syncable) {
        try {
          const result = await syncWorkTracker(db, prov.workTrackerProviderId);
          log.info(
            { providerId: prov.workTrackerProviderId, name: prov.name, ...result },
            "work tracker sync complete",
          );
          synced++;
        } catch (err) {
          log.error(
            { err, providerId: prov.workTrackerProviderId, name: prov.name },
            "work tracker sync failed",
          );
          errors++;
        }
      }

      return { providers: syncable.length, synced, errors };
    },
  });
}
