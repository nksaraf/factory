/**
 * Periodic git host provider sync loop
 * Syncs all active git host providers on a timer + on startup
 */

import { eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { gitHostProvider } from "../db/schema/build";
import { GitHostService } from "../modules/build/git-host.service";
import { logger } from "../logger";

const DEFAULT_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function syncAllGitHostProviders(db: Database): Promise<void> {
  const service = new GitHostService(db);
  const providers = await db
    .select()
    .from(gitHostProvider)
    .where(eq(gitHostProvider.status, "active"));

  if (providers.length === 0) return;

  logger.info({ count: providers.length }, "syncing git host providers");

  for (const prov of providers) {
    try {
      const result = await service.triggerFullSync(prov.gitHostProviderId);
      logger.info(
        { providerId: prov.gitHostProviderId, name: prov.name, ...result },
        "git host provider sync complete",
      );
    } catch (err) {
      logger.error(
        { err, providerId: prov.gitHostProviderId, name: prov.name },
        "git host provider sync failed",
      );
    }
  }
}

/**
 * Start the periodic git host sync loop.
 * Runs an initial sync in the background on startup, then repeats on interval.
 * Returns a cleanup function to stop the loop.
 */
export function startGitHostSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): () => void {
  const interval = opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  syncAllGitHostProviders(db).catch((err) => {
    logger.error({ err }, "git host startup sync failed");
  });

  const timer = setInterval(async () => {
    try {
      await syncAllGitHostProviders(db);
    } catch (err) {
      logger.error({ err }, "git host periodic sync failed");
    }
  }, interval);

  return () => clearInterval(timer);
}
