/**
 * Periodic messaging provider sync loop.
 * Syncs channel metadata for all active messaging providers on a timer + on startup.
 *
 * NOTE: User identity syncing has been unified into the identity sync loop
 * (identity-sync-loop.ts). This loop only handles messaging-specific state.
 */

import { eq, sql } from "drizzle-orm"
import type { Database } from "../db/connection"
import { messagingProvider } from "../db/schema/org"
import type { MessagingProviderSpec } from "@smp/factory-shared/schemas/org"
import { createOperationRunner, type OperationRunner } from "./operations"

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Start the periodic messaging sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 *
 * Currently a lightweight heartbeat — user identity syncing is handled by the
 * identity sync loop. This loop updates lastSyncAt in the provider spec and
 * can be extended with channel metadata sync in the future.
 */
export function startMessagingSyncLoop(
  db: Database,
  opts?: { intervalMs?: number }
): OperationRunner {
  return createOperationRunner(db, {
    name: "messaging",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      // Query providers where spec.status = 'active'
      const providers = await db
        .select()
        .from(messagingProvider)
        .where(sql`${messagingProvider.spec}->>'status' = 'active'`)

      let synced = 0
      let errors = 0
      for (const provider of providers) {
        try {
          // User identity syncing is now handled by the identity sync loop.
          // This loop can be extended with channel metadata sync in the future.

          // Update lastSyncAt in spec
          const spec = (provider.spec ?? {}) as MessagingProviderSpec
          await db
            .update(messagingProvider)
            .set({
              spec: {
                ...spec,
                lastSyncAt: new Date().toISOString(),
              } satisfies MessagingProviderSpec,
              updatedAt: new Date(),
            })
            .where(eq(messagingProvider.id, provider.id))
          synced++
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          log.error(
            { err, providerId: provider.id },
            "messaging provider sync failed"
          )

          // Record sync error in spec
          const spec = (provider.spec ?? {}) as MessagingProviderSpec
          await db
            .update(messagingProvider)
            .set({
              spec: {
                ...spec,
                syncError: errorMessage,
                lastSyncAt: new Date().toISOString(),
              } satisfies MessagingProviderSpec,
              updatedAt: new Date(),
            })
            .where(eq(messagingProvider.id, provider.id))
          errors++
        }
      }

      return { providers: providers.length, synced, errors }
    },
  })
}
