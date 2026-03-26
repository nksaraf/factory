import { and, eq } from "drizzle-orm";
import type { Provider } from "@smp/factory-shared/types";
import type { Database } from "../db/connection";
import type {
  ProviderAdapter,
  SyncResult,
  VmCreateSpec,
  VmProvisionResult,
  VmResizeSpec,
  SnapshotResult,
} from "./provider-adapter";
import { host, proxmoxCluster, vm, ipAddress } from "../db/schema/infra";
import { createProxmoxClientFromCluster, type ProxmoxClient } from "../lib/proxmox/client";
import { getPrimaryIpFromConfig, getIpFromGuestAgent } from "../lib/proxmox/ip-extraction";
import { getVmContext } from "../lib/proxmox/resolve-vm";
import { allocateSlug, slugifyFromLabel } from "../lib/slug";
import type { ProxmoxNode, ProxmoxNodeStatus, ProxmoxVmConfig, CloudInitConfig } from "../lib/proxmox/types";

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

function mapNodeStatus(status: string): string {
  if (status === "online") return "active";
  if (status === "offline") return "offline";
  return "offline";
}

function mapVmStatus(status: string): string {
  if (status === "running") return "running";
  if (status === "stopped" || status === "paused") return "stopped";
  return "provisioning";
}

export class ProxmoxAdapter implements ProviderAdapter {
  readonly type = "proxmox";

  constructor(private db: Database) {}

  async syncInventory(provider: Provider, db: Database): Promise<SyncResult> {
    // Find all Proxmox clusters for this provider
    const clusters = await db
      .select()
      .from(proxmoxCluster)
      .where(eq(proxmoxCluster.providerId, provider.providerId));

    let totalHosts = 0;
    let totalVms = 0;

    for (const cluster of clusters) {
      try {
        // Mark sync in progress
        await db
          .update(proxmoxCluster)
          .set({ syncStatus: "syncing", syncError: null })
          .where(eq(proxmoxCluster.proxmoxClusterId, cluster.proxmoxClusterId));

        const client = createProxmoxClientFromCluster({
          host: cluster.apiHost,
          port: cluster.apiPort,
          tokenId: cluster.tokenId,
          tokenSecret: cluster.tokenSecret,
          fingerprint: cluster.sslFingerprint,
        });

        // Sync nodes → hosts
        const hostsCount = await this.syncNodes(
          db,
          client,
          cluster,
          provider.providerId
        );
        totalHosts += hostsCount;

        // Build node name → hostId map for VM sync
        const nodeNameToHostId = await this.getNodeNameToHostIdMap(
          db,
          provider.providerId
        );

        // Sync VMs
        const vmsCount = await this.syncVms(
          db,
          client,
          cluster,
          provider.providerId,
          nodeNameToHostId
        );
        totalVms += vmsCount;

        // Mark sync complete
        await db
          .update(proxmoxCluster)
          .set({
            syncStatus: "idle",
            lastSyncAt: new Date(),
            syncError: null,
          })
          .where(eq(proxmoxCluster.proxmoxClusterId, cluster.proxmoxClusterId));
      } catch (error) {
        // Mark sync error
        await db
          .update(proxmoxCluster)
          .set({
            syncStatus: "error",
            syncError:
              error instanceof Error ? error.message : "Sync failed",
          })
          .where(eq(proxmoxCluster.proxmoxClusterId, cluster.proxmoxClusterId));
      }
    }

    return { hostsDiscovered: totalHosts, vmsDiscovered: totalVms };
  }

  private async syncNodes(
    db: Database,
    client: ProxmoxClient,
    cluster: typeof proxmoxCluster.$inferSelect,
    providerId: string
  ): Promise<number> {
    const nodesWithStatus = await client.getNodesWithStatus();

    // Get existing hosts for this provider
    const existingHosts = await db
      .select()
      .from(host)
      .where(eq(host.providerId, providerId));

    const existingHostByName = new Map(existingHosts.map((h) => [h.name, h]));
    const seenNames = new Set<string>();
    let count = 0;

    for (const node of nodesWithStatus) {
      seenNames.add(node.node);
      const existing = existingHostByName.get(node.node);

      const cpuCores =
        (node as ProxmoxNode & { details?: ProxmoxNodeStatus }).details
          ?.cpuinfo?.cores ||
        node.maxcpu ||
        0;
      const memoryMb = Math.round((node.maxmem || 0) / BYTES_PER_MB);
      const diskGb = Math.round((node.maxdisk || 0) / BYTES_PER_GB);
      const status = mapNodeStatus(node.status);

      // Determine IP for single-node clusters
      let nodeIpAddress: string | null = existing?.ipAddress || null;
      if (!nodeIpAddress && nodesWithStatus.length === 1 && cluster.apiHost) {
        nodeIpAddress = cluster.apiHost.replace(/^https?:\/\//, "");
      }

      if (existing) {
        // Update existing host
        await db
          .update(host)
          .set({
            cpuCores,
            memoryMb,
            diskGb,
            status,
            ipAddress: existing.ipAddress || nodeIpAddress,
          })
          .where(eq(host.hostId, existing.hostId));
      } else {
        // Insert new host
        const slug = await allocateSlug({
          baseLabel: node.node,
          isTaken: async (s) => {
            const [r] = await db
              .select()
              .from(host)
              .where(eq(host.slug, s))
              .limit(1);
            return r != null;
          },
        });

        await db.insert(host).values({
          name: node.node,
          slug,
          hostname: node.node,
          providerId,
          ipAddress: nodeIpAddress,
          status,
          osType: "linux",
          accessMethod: "ssh",
          cpuCores,
          memoryMb,
          diskGb,
        });
      }

      // Upsert IPAM record for host
      if (nodeIpAddress) {
        const existingOrNew = existing || (await db
          .select()
          .from(host)
          .where(and(eq(host.name, node.node), eq(host.providerId, providerId)))
          .limit(1)
          .then((r) => r[0]));

        if (existingOrNew) {
          await this.upsertIpAddress(db, nodeIpAddress, "host", existingOrNew.hostId, node.node);
        }
      }

      count++;
    }

    // Remove stale hosts (nodes no longer in Proxmox)
    for (const [name, existing] of existingHostByName) {
      if (!seenNames.has(name)) {
        await db.delete(host).where(eq(host.hostId, existing.hostId));
      }
    }

    return count;
  }

  private async getNodeNameToHostIdMap(
    db: Database,
    providerId: string
  ): Promise<Map<string, string>> {
    const hosts = await db
      .select({ hostId: host.hostId, name: host.name })
      .from(host)
      .where(eq(host.providerId, providerId));
    return new Map(hosts.map((h) => [h.name, h.hostId]));
  }

  private async syncVms(
    db: Database,
    client: ProxmoxClient,
    cluster: typeof proxmoxCluster.$inferSelect,
    providerId: string,
    nodeNameToHostId: Map<string, string>
  ): Promise<number> {
    const allVms = await client.getAllVms();
    // Filter out templates
    const vms = allVms.filter((v) => v.template !== 1);

    // Get existing VMs for this cluster
    const existingVms = await db
      .select()
      .from(vm)
      .where(eq(vm.proxmoxClusterId, cluster.proxmoxClusterId));

    const existingVmByVmid = new Map(
      existingVms
        .filter((v) => v.proxmoxVmid != null)
        .map((v) => [v.proxmoxVmid!, v])
    );
    const seenVmIds = new Set<string>();
    let count = 0;

    for (const pvm of vms) {
      const existing = existingVmByVmid.get(pvm.vmid);
      if (existing) seenVmIds.add(existing.vmId);

      const cpuCount = pvm.cpus || 1;
      const memoryMb = Math.round((pvm.maxmem || 0) / BYTES_PER_MB);
      const diskGb = Math.round((pvm.maxdisk || 0) / BYTES_PER_GB);
      const status = mapVmStatus(pvm.status || "stopped");
      const hostId = pvm.node ? nodeNameToHostId.get(pvm.node) : undefined;

      // Extract IP from VM config
      let ipAddressValue: string | null = null;
      try {
        if (pvm.node && pvm.vmid) {
          const vmConfig = await client.getVmConfig(
            pvm.node,
            pvm.vmid,
            pvm.type || "qemu"
          );
          ipAddressValue = getPrimaryIpFromConfig(vmConfig);
        }
      } catch {
        // Config fetch failed, continue
      }

      // Fallback: guest agent via Proxmox API
      if (!ipAddressValue && pvm.node && pvm.vmid && pvm.status === "running") {
        ipAddressValue = await getIpFromGuestAgent(client, pvm.node, pvm.vmid);
      }

      if (existing) {
        // Update existing VM
        await db
          .update(vm)
          .set({
            cpu: cpuCount,
            memoryMb,
            diskGb,
            status,
            vmType: pvm.type || "qemu",
            hostId: hostId || existing.hostId,
            // Only update IP if we found one and it wasn't manually set
            ipAddress: existing.ipAddress || ipAddressValue,
          })
          .where(eq(vm.vmId, existing.vmId));

        // Upsert IPAM
        const effectiveIp = existing.ipAddress || ipAddressValue;
        if (effectiveIp) {
          await this.upsertIpAddress(db, effectiveIp, "vm", existing.vmId, existing.name);
        }
      } else {
        // Insert new VM
        const vmName = pvm.name || `vm-${pvm.vmid}`;
        const slug = await allocateSlug({
          baseLabel: vmName,
          isTaken: async (s) => {
            const [r] = await db
              .select()
              .from(vm)
              .where(eq(vm.slug, s))
              .limit(1);
            return r != null;
          },
        });

        const [inserted] = await db
          .insert(vm)
          .values({
            name: vmName,
            slug,
            providerId,
            proxmoxClusterId: cluster.proxmoxClusterId,
            proxmoxVmid: pvm.vmid,
            vmType: pvm.type || "qemu",
            cpu: cpuCount,
            memoryMb,
            diskGb,
            status,
            osType: "linux",
            accessMethod: "ssh",
            hostId: hostId || null,
            ipAddress: ipAddressValue,
          })
          .returning();

        // Upsert IPAM
        if (ipAddressValue && inserted) {
          await this.upsertIpAddress(db, ipAddressValue, "vm", inserted.vmId, vmName);
        }
      }
      count++;
    }

    // Remove stale VMs (no longer in Proxmox)
    for (const existing of existingVms) {
      if (!seenVmIds.has(existing.vmId)) {
        await db.delete(vm).where(eq(vm.vmId, existing.vmId));
      }
    }

    return count;
  }

  private async upsertIpAddress(
    db: Database,
    address: string,
    assignedToType: string,
    assignedToId: string,
    hostname: string | null
  ): Promise<void> {
    try {
      const [existing] = await db
        .select()
        .from(ipAddress)
        .where(eq(ipAddress.address, address))
        .limit(1);

      if (existing) {
        await db
          .update(ipAddress)
          .set({ assignedToType, assignedToId, status: "assigned", hostname })
          .where(eq(ipAddress.ipAddressId, existing.ipAddressId));
      } else {
        await db.insert(ipAddress).values({
          address,
          assignedToType,
          assignedToId,
          status: "assigned",
          hostname,
        });
      }
    } catch {
      // IPAM upsert is best-effort
    }
  }

  // --- VM Lifecycle Methods ---

  async createVm(
    _provider: Provider,
    spec: VmCreateSpec
  ): Promise<VmProvisionResult> {
    // TODO: implement template clone + cloud-init via getVmContext pattern
    return { externalId: `pve-${Date.now()}` };
  }

  async startVm(_provider: Provider, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.startVm(ctx.nodeName, ctx.vmid, ctx.vmType);
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async stopVm(_provider: Provider, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.stopVm(ctx.nodeName, ctx.vmid, ctx.vmType);
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async restartVm(_provider: Provider, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.rebootVm(ctx.nodeName, ctx.vmid, ctx.vmType);
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async resizeVm(
    _provider: Provider,
    externalId: string,
    spec: VmResizeSpec
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);

    // Update CPU/memory via config
    const configUpdate: Partial<ProxmoxVmConfig> & CloudInitConfig = {};
    if (spec.cpu != null) configUpdate.cores = spec.cpu;
    if (spec.memoryMb != null) configUpdate.memory = spec.memoryMb;

    if (Object.keys(configUpdate).length > 0) {
      await ctx.client.updateVmConfig(
        ctx.nodeName,
        ctx.vmid,
        configUpdate,
        ctx.vmType
      );
    }

    // Resize disk if requested
    if (spec.diskGb != null) {
      await ctx.client.resizeDisk(
        ctx.nodeName,
        ctx.vmid,
        "scsi0",
        `${spec.diskGb}G`
      );
    }
  }

  async migrateVm(
    _provider: Provider,
    externalId: string,
    targetHost: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    // Proxmox migration uses node name as target
    // The targetHost here is a factory hostId — resolve to node name
    const [targetHostRecord] = await this.db
      .select()
      .from(host)
      .where(eq(host.hostId, targetHost))
      .limit(1);

    if (!targetHostRecord) {
      throw new Error(`Target host not found: ${targetHost}`);
    }

    // Use the PveClient's migrate endpoint
    // POST /api2/json/nodes/{node}/qemu/{vmid}/migrate
    const upid = await ctx.client.startVm(ctx.nodeName, ctx.vmid, ctx.vmType);
    // TODO: replace with actual migrate call once available in client
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async snapshotVm(
    _provider: Provider,
    externalId: string
  ): Promise<SnapshotResult> {
    const ctx = await getVmContext(this.db, externalId);
    const snapshotName = `snap-${Date.now()}`;
    // TODO: implement via client snapshot API
    return {
      snapshotId: snapshotName,
      createdAt: new Date().toISOString(),
    };
  }

  async destroyVm(_provider: Provider, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.deleteVm(
      ctx.nodeName,
      ctx.vmid,
      ctx.vmType
    );
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }
}
