/**
 * Periodic Proxmox inventory sync loop
 * Syncs all active Proxmox providers on a timer + on startup
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { provider } from "../../db/schema/infra";
import { syncProvider } from "../../services/infra/provider.service";
import { logger } from "../../logger";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Run a single sync pass across all active Proxmox providers
 */
async function syncAllProxmoxProviders(db: Database): Promise<void> {
  const providers = await db
    .select()
    .from(provider)
    .where(eq(provider.providerType, "proxmox"));

  const activeProviders = providers.filter((p) => p.status === "active");

  if (activeProviders.length === 0) return;

  logger.info(
    { count: activeProviders.length },
    "syncing Proxmox providers"
  );

  for (const prov of activeProviders) {
    try {
      const result = await syncProvider(db, prov.providerId);
      logger.info(
        {
          providerId: prov.providerId,
          name: prov.name,
          hosts: result.hostsDiscovered,
          vms: result.vmsDiscovered,
        },
        "Proxmox provider sync complete"
      );
    } catch (err) {
      logger.error(
        { err, providerId: prov.providerId, name: prov.name },
        "Proxmox provider sync failed"
      );
    }
  }
}

/**
 * Start the periodic Proxmox sync loop.
 * Runs an initial sync in the background on startup, then repeats on interval.
 * Returns a cleanup function to stop the loop.
 */
export function startProxmoxSyncLoop(
  db: Database,
  opts?: { intervalMs?: number }
): () => void {
  const interval = opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  // Sync on startup (background, don't block)
  syncAllProxmoxProviders(db).catch((err) => {
    logger.error({ err }, "Proxmox startup sync failed");
  });

  // Periodic sync
  const timer = setInterval(async () => {
    try {
      await syncAllProxmoxProviders(db);
    } catch (err) {
      logger.error({ err }, "Proxmox periodic sync failed");
    }
  }, interval);

  return () => clearInterval(timer);
}
