/**
 * Periodic work tracker sync loop
 * Syncs all active work tracker providers on a timer + on startup
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { workTrackerProvider } from "../../db/schema/product";
import { syncWorkTracker } from "../../services/product/work-tracker.service";
import { logger } from "../../logger";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Run a single sync pass across all active, sync-enabled work tracker providers
 */
async function syncAllWorkTrackerProviders(db: Database): Promise<void> {
  const syncable = await db
    .select()
    .from(workTrackerProvider)
    .where(
      and(
        eq(workTrackerProvider.status, "active"),
        eq(workTrackerProvider.syncEnabled, true)
      )
    );

  if (syncable.length === 0) return;

  logger.info(
    { count: syncable.length },
    "syncing work tracker providers"
  );

  for (const prov of syncable) {
    try {
      const result = await syncWorkTracker(db, prov.workTrackerProviderId);
      logger.info(
        {
          providerId: prov.workTrackerProviderId,
          name: prov.name,
          ...result,
        },
        "work tracker sync complete"
      );
    } catch (err) {
      logger.error(
        { err, providerId: prov.workTrackerProviderId, name: prov.name },
        "work tracker sync failed"
      );
    }
  }
}

/**
 * Start the periodic work tracker sync loop.
 * Runs an initial sync in the background on startup, then repeats on interval.
 * Returns a cleanup function to stop the loop.
 */
export function startWorkTrackerSyncLoop(
  db: Database,
  opts?: { intervalMs?: number }
): () => void {
  const interval = opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  // Sync on startup (background, don't block)
  syncAllWorkTrackerProviders(db).catch((err) => {
    logger.error({ err }, "work tracker startup sync failed");
  });

  // Periodic sync
  const timer = setInterval(async () => {
    try {
      await syncAllWorkTrackerProviders(db);
    } catch (err) {
      logger.error({ err }, "work tracker periodic sync failed");
    }
  }, interval);

  return () => clearInterval(timer);
}
