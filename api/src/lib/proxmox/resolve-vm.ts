/**
 * VM Resolver — resolves a flexible identifier to a VM record
 * Ported from lepton-cloud's resolveVmId() pattern
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { vm, host, proxmoxCluster } from "../../db/schema/infra";
import { createProxmoxClientFromCluster } from "./client";
import type { ProxmoxClient } from "./client";

/**
 * Resolve a VM by any identifier: vmId, slug, name, ipAddress, or proxmoxVmid.
 * All string matches are case-insensitive.
 * Throws if not found or if multiple VMs match (ambiguous).
 */
export async function resolveVm(db: Database, identifier: string) {
  const targetLower = identifier.toLowerCase();
  const vmid = parseInt(identifier, 10);

  const allVms = await db.select().from(vm);

  const matches = allVms.filter(
    (v) =>
      v.vmId === identifier ||
      v.slug.toLowerCase() === targetLower ||
      v.name.toLowerCase() === targetLower ||
      v.ipAddress?.toLowerCase() === targetLower ||
      (!isNaN(vmid) && v.proxmoxVmid === vmid)
  );

  if (matches.length === 0) {
    throw new Error(`VM not found: ${identifier}`);
  }

  if (matches.length > 1) {
    const descriptions = matches.map(
      (v) => `  ${v.vmId} (name=${v.name}, slug=${v.slug}, vmid=${v.proxmoxVmid})`
    );
    throw new Error(
      `Ambiguous VM identifier "${identifier}" matches ${matches.length} VMs:\n${descriptions.join("\n")}`
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
  vm: Awaited<ReturnType<typeof resolveVm>>;
}

/**
 * Resolve a VM identifier and build context for Proxmox API calls.
 * Looks up the VM, its host (for node name), and proxmoxCluster (for credentials).
 */
export async function getVmContext(
  db: Database,
  identifier: string
): Promise<VmContext> {
  const vmRecord = await resolveVm(db, identifier);

  if (!vmRecord.proxmoxClusterId) {
    throw new Error(`VM ${vmRecord.vmId} is not linked to a Proxmox cluster`);
  }
  if (vmRecord.proxmoxVmid == null) {
    throw new Error(`VM ${vmRecord.vmId} has no Proxmox VMID`);
  }

  // Get the host to determine the Proxmox node name
  let nodeName: string | undefined;
  if (vmRecord.hostId) {
    const [hostRecord] = await db
      .select()
      .from(host)
      .where(eq(host.hostId, vmRecord.hostId))
      .limit(1);
    nodeName = hostRecord?.name;
  }
  if (!nodeName) {
    throw new Error(`Cannot determine Proxmox node for VM ${vmRecord.vmId}`);
  }

  // Get the proxmoxCluster for credentials
  const [clusterRecord] = await db
    .select()
    .from(proxmoxCluster)
    .where(eq(proxmoxCluster.proxmoxClusterId, vmRecord.proxmoxClusterId))
    .limit(1);

  if (!clusterRecord) {
    throw new Error(`Proxmox cluster not found: ${vmRecord.proxmoxClusterId}`);
  }

  const client = createProxmoxClientFromCluster({
    host: clusterRecord.apiHost,
    port: clusterRecord.apiPort,
    tokenId: clusterRecord.tokenId,
    tokenSecret: clusterRecord.tokenSecret,
    fingerprint: clusterRecord.sslFingerprint,
  });

  return {
    client,
    nodeName,
    vmid: vmRecord.proxmoxVmid,
    vmType: (vmRecord.vmType === "lxc" ? "lxc" : "qemu") as "qemu" | "lxc",
    vm: vmRecord,
  };
}
