/**
 * Periodic Proxmox inventory sync loop
 * Syncs all active Proxmox hypervisor substrates on a timer + on startup
 */

import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { substrate } from "../../db/schema/infra-v2";
import { getVMProviderAdapter } from "../../adapters/adapter-registry";
import { createOperationRunner, type OperationRunner } from "../operations";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start the periodic Proxmox sync loop.
 * Returns an OperationRunner with DB-tracked runs and manual trigger support.
 */
export function startProxmoxSyncLoop(
  db: Database,
  opts?: { intervalMs?: number },
): OperationRunner {
  return createOperationRunner(db, {
    name: "proxmox",
    intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    async execute(log) {
      const hypervisors = await db
        .select()
        .from(substrate)
        .where(
          and(
            eq(substrate.type, "hypervisor"),
            sql`${substrate.spec}->>'providerKind' = 'proxmox'`,
            sql`${substrate.spec}->>'lifecycle' = 'active'`,
          ),
        );

      if (hypervisors.length === 0) return { hypervisors: 0, hostsDiscovered: 0, vmsDiscovered: 0 };

      const adapter = getVMProviderAdapter("proxmox", db);
      let totalHosts = 0;
      let totalVms = 0;

      for (const hyp of hypervisors) {
        try {
          const result = await adapter.syncInventory(hyp);
          log.info(
            { substrateId: hyp.id, name: hyp.name, hosts: result.hostsDiscovered, vms: result.vmsDiscovered },
            "Proxmox hypervisor sync complete",
          );
          totalHosts += result.hostsDiscovered;
          totalVms += result.vmsDiscovered;
        } catch (err) {
          log.error({ err, substrateId: hyp.id, name: hyp.name }, "Proxmox hypervisor sync failed");
        }
      }

      return { hypervisors: hypervisors.length, hostsDiscovered: totalHosts, vmsDiscovered: totalVms };
    },
  });
}
