/**
 * VM Resolver — resolves a flexible identifier to a host record (type='vm')
 * Accepts: host id, slug, name, ipAddress (from spec), or externalId (numeric)
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { host, substrate } from "../../db/schema/infra-v2";
import { createProxmoxClientFromCluster } from "./client";
import type { ProxmoxClient } from "./client";

/**
 * Resolve a VM host by any identifier: id, slug, name, ipAddress (from spec), or externalId.
 * All string matches are case-insensitive.
 * Throws if not found or if multiple hosts match (ambiguous).
 */
export async function resolveVmHost(db: Database, identifier: string) {
  const targetLower = identifier.toLowerCase();

  // Query all VM-type hosts
  const allVmHosts = await db
    .select()
    .from(host)
    .where(eq(host.type, "vm"));

  const matches = allVmHosts.filter((h) => {
    const spec = (h.spec ?? {}) as Record<string, unknown>;
    return (
      h.id === identifier ||
      h.slug.toLowerCase() === targetLower ||
      h.name.toLowerCase() === targetLower ||
      (spec.ipAddress as string)?.toLowerCase() === targetLower ||
      (spec.externalId as string) === identifier
    );
  });

  if (matches.length === 0) {
    throw new Error(`VM not found: ${identifier}`);
  }

  if (matches.length > 1) {
    const descriptions = matches.map(
      (h) => {
        const spec = (h.spec ?? {}) as Record<string, unknown>;
        return `  ${h.id} (name=${h.name}, slug=${h.slug}, externalId=${spec.externalId})`;
      }
    );
    throw new Error(
      `Ambiguous VM identifier "${identifier}" matches ${matches.length} hosts:\n${descriptions.join("\n")}`
    );
  }

  return matches[0]!;
}

/**
 * Context needed to perform Proxmox API operations on a VM
 */
export interface VmContext {
  client: ProxmoxClient;
  nodeName: string;
  vmid: number;
  vmType: "qemu" | "lxc";
  vmHost: Awaited<ReturnType<typeof resolveVmHost>>;
}

/**
 * Resolve a VM identifier and build context for Proxmox API calls.
 * Looks up the VM host, finds its bare-metal host (for node name),
 * and the hypervisor substrate (for Proxmox credentials).
 */
export async function getVmContext(
  db: Database,
  identifier: string
): Promise<VmContext> {
  const vmHost = await resolveVmHost(db, identifier);
  const spec = (vmHost.spec ?? {}) as Record<string, unknown>;

  const externalId = spec.externalId as string | undefined;
  if (!externalId) {
    throw new Error(`VM host ${vmHost.id} has no external ID in spec`);
  }

  const vmid = parseInt(externalId, 10);
  if (isNaN(vmid)) {
    throw new Error(`VM host ${vmHost.id} has non-numeric external ID: ${externalId}`);
  }

  // The VM's substrateId points to the hypervisor substrate
  if (!vmHost.substrateId) {
    throw new Error(`VM host ${vmHost.id} is not linked to a substrate`);
  }

  // Find the hypervisor substrate for credentials
  const [hypervisor] = await db
    .select()
    .from(substrate)
    .where(eq(substrate.id, vmHost.substrateId))
    .limit(1);

  if (!hypervisor) {
    throw new Error(`Substrate not found: ${vmHost.substrateId}`);
  }

  const hypervisorSpec = (hypervisor.spec ?? {}) as Record<string, unknown>;

  // Build client from substrate spec
  const client = createProxmoxClientFromCluster({
    host: hypervisorSpec.apiHost as string,
    port: hypervisorSpec.apiPort as number,
    tokenId: hypervisorSpec.tokenId as string,
    tokenSecret: hypervisorSpec.tokenSecret as string,
    fingerprint: hypervisorSpec.sslFingerprint as string | undefined,
  });

  // Determine node name — find a bare-metal host that matches
  // We need to figure out which Proxmox node this VM runs on.
  // In v2, the bare-metal hosts and VMs both link to the same hypervisor substrate.
  // The node name is the bare-metal host's name. We'll use a simple approach:
  // if the VM was synced, the Proxmox node info may be in metadata or we need
  // to query the Proxmox API directly.
  // For now, query the Proxmox API for this VMID's location.
  const allVms = await client.getAllVms();
  const pvmEntry = allVms.find((v) => v.vmid === vmid);

  if (!pvmEntry?.node) {
    throw new Error(`Cannot determine Proxmox node for VMID ${vmid}`);
  }

  const vmType = vmHost.type === "lxc" ? "lxc" : "qemu";

  return {
    client,
    nodeName: pvmEntry.node,
    vmid,
    vmType: vmType as "qemu" | "lxc",
    vmHost,
  };
}
