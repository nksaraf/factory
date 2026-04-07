/**
 * Periodic git host provider sync loop
 * Syncs all active git host providers on a timer + on startup
 */

import type { Database } from "../db/connection";
import { gitHostProvider } from "../db/schema/build-v2";
import type { GitHostProviderSpec } from "@smp/factory-shared/schemas/build";
import { GitHostService } from "../modules/build/git-host.service";
import { createOperationRunner, type OperationRunner } from "./operations";

const DEFAULT_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Start the periodic git host sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startGitHostSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): OperationRunner {
  return createOperationRunner(db, {
    name: "git-host",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const service = new GitHostService(db);
      const allProviders = await db
        .select()
        .from(gitHostProvider);

      // v2: status is in spec JSONB
      const providers = allProviders.filter((p) => {
        const spec = (p.spec ?? {}) as GitHostProviderSpec;
        return spec.status === "active" || !spec.status;
      });

      if (providers.length === 0) return { providers: 0 };

      let synced = 0;
      let errors = 0;
      for (const prov of providers) {
        try {
          const result = await service.triggerFullSync(prov.id);
          log.info(
            { providerId: prov.id, name: prov.name, ...result },
            "git host provider sync complete",
          );
          synced++;
        } catch (err) {
          log.error(
            { err, providerId: prov.id, name: prov.name },
            "git host provider sync failed",
          );
          errors++;
        }
      }

      return { providers: providers.length, synced, errors };
    },
  });
}
