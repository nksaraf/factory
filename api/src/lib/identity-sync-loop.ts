/**
 * Periodic identity sync loop.
 * Refreshes profile data from linked identity providers on a timer + on startup.
 */

import type { Database } from "../db/connection";
import type { SecretBackend } from "./secrets/secret-backend";
import { IdentitySyncService } from "../modules/identity/identity-sync.service";
import { createOperationRunner, type OperationRunner } from "./operations";

const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Start the periodic identity sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startIdentitySyncLoop(
  db: Database,
  secrets: SecretBackend,
  opts?: { intervalMs?: number },
): OperationRunner {
  return createOperationRunner(db, {
    name: "identity",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const service = new IdentitySyncService(db, secrets);
      const results = await service.syncAllIdentities();
      let totalLinked = 0;
      let totalCreated = 0;
      let totalErrors = 0;
      for (const r of results) {
        log.info(
          { provider: r.provider, linked: r.linked, created: r.created, skipped: r.skipped, deactivated: r.deactivated, errors: r.errors },
          "identity sync result",
        );
        totalLinked += r.linked;
        totalCreated += r.created;
        totalErrors += r.errors;
      }
      return { providers: results.length, totalLinked, totalCreated, totalErrors };
    },
  });
}
