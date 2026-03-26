/**
 * Periodic identity sync loop.
 * Refreshes profile data from linked identity providers on a timer + on startup.
 */

import type { Database } from "../db/connection";
import { IdentitySyncService } from "../modules/identity/identity-sync.service";
import { logger } from "../logger";

const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

async function syncAllIdentities(db: Database): Promise<void> {
  const service = new IdentitySyncService(db);
  await service.syncAllIdentities();
}

/**
 * Start the periodic identity sync loop.
 * Runs an initial sync in the background on startup, then repeats on interval.
 * Returns a cleanup function to stop the loop.
 */
export function startIdentitySyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): () => void {
  const interval = opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  syncAllIdentities(db).catch((err) => {
    logger.error({ err }, "identity startup sync failed");
  });

  const timer = setInterval(async () => {
    try {
      await syncAllIdentities(db);
    } catch (err) {
      logger.error({ err }, "identity periodic sync failed");
    }
  }, interval);

  return () => clearInterval(timer);
}
