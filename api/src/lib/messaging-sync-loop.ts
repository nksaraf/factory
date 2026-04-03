/**
 * Periodic messaging provider sync loop.
 * Syncs users (email-match identity links) and channel metadata for all
 * active messaging providers on a timer + on startup.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { messagingProvider } from "../db/schema/org";
import { syncProviderUsers } from "../modules/messaging/messaging.service";
import { logger } from "../logger";

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function syncAllMessagingProviders(db: Database): Promise<void> {
  const providers = await db
    .select()
    .from(messagingProvider)
    .where(eq(messagingProvider.status, "active"));

  for (const provider of providers) {
    try {
      await db
        .update(messagingProvider)
        .set({ syncStatus: "syncing" })
        .where(
          eq(
            messagingProvider.messagingProviderId,
            provider.messagingProviderId,
          ),
        );

      await syncProviderUsers(db, provider.messagingProviderId);

      await db
        .update(messagingProvider)
        .set({
          syncStatus: "idle",
          lastSyncAt: new Date(),
          syncError: null,
        })
        .where(
          eq(
            messagingProvider.messagingProviderId,
            provider.messagingProviderId,
          ),
        );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, providerId: provider.messagingProviderId },
        "messaging provider sync failed",
      );
      await db
        .update(messagingProvider)
        .set({ syncStatus: "error", syncError: errorMessage })
        .where(
          eq(
            messagingProvider.messagingProviderId,
            provider.messagingProviderId,
          ),
        );
    }
  }
}

/**
 * Start the periodic messaging sync loop.
 * Runs an initial sync in the background on startup, then repeats on interval.
 * Returns a cleanup function to stop the loop.
 */
export function startMessagingSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): () => void {
  const interval = opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  syncAllMessagingProviders(db).catch((err) => {
    logger.error({ err }, "messaging startup sync failed");
  });

  const timer = setInterval(async () => {
    try {
      await syncAllMessagingProviders(db);
    } catch (err) {
      logger.error({ err }, "messaging periodic sync failed");
    }
  }, interval);

  return () => clearInterval(timer);
}
