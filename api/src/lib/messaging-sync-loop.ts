/**
 * Periodic messaging provider sync loop.
 * Syncs channel metadata for all active messaging providers on a timer + on startup.
 *
 * NOTE: User identity syncing has been unified into the identity sync loop
 * (identity-sync-loop.ts). This loop only handles messaging-specific state.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { messagingProvider } from "../db/schema/org";
import { createOperationRunner, type OperationRunner } from "./operations";

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Start the periodic messaging sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startMessagingSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): OperationRunner {
  return createOperationRunner(db, {
    name: "messaging",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const providers = await db
        .select()
        .from(messagingProvider)
        .where(eq(messagingProvider.status, "active"));

      let synced = 0;
      let errors = 0;
      for (const provider of providers) {
        try {
          await db
            .update(messagingProvider)
            .set({ syncStatus: "syncing" })
            .where(eq(messagingProvider.messagingProviderId, provider.messagingProviderId));

          // User identity syncing is now handled by the identity sync loop.
          // This loop can be extended with channel metadata sync in the future.

          await db
            .update(messagingProvider)
            .set({ syncStatus: "idle", lastSyncAt: new Date(), syncError: null })
            .where(eq(messagingProvider.messagingProviderId, provider.messagingProviderId));

          synced++;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error({ err, providerId: provider.messagingProviderId }, "messaging provider sync failed");
          await db
            .update(messagingProvider)
            .set({ syncStatus: "error", syncError: errorMessage })
            .where(eq(messagingProvider.messagingProviderId, provider.messagingProviderId));
          errors++;
        }
      }

      return { providers: providers.length, synced, errors };
    },
  });
}
