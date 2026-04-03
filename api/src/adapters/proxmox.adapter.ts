import { and, eq } from "drizzle-orm";
import type { Provider } from "@smp/factory-shared/types";
import type { Database } from "../db/connection";
import type {
  VMProviderAdapter,
  SyncResult,
  VmCreateSpec,
  VmCloneSpec,
  VmProvisionResult,
  VmResizeSpec,
  SnapshotResult,
  SnapshotInfo,
} from "./vm-provider-adapter";
import { host, vmCluster, vm, ipAddress } from "../db/schema/infra";
import { createProxmoxClientFromCluster, type ProxmoxClient } from "../lib/proxmox/client";
import { getPrimaryIpFromConfig, getIpFromGuestAgent } from "../lib/proxmox/ip-extraction";
import { getVmContext } from "../lib/proxmox/resolve-vm";
import { allocateSlug } from "../lib/slug";
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

export class ProxmoxAdapter implements VMProviderAdapter {
  readonly type = "proxmox";

  constructor(private db: Database) {}

  async syncInventory(provider: Provider): Promise<SyncResult> {
    const db = this.db;
    const clusters = await db
      .select()
      .from(vmCluster)
      .where(eq(vmCluster.providerId, provider.providerId));

    let totalHosts = 0;
    let totalVms = 0;

    for (const cluster of clusters) {
      try {
        await db
          .update(vmCluster)
          .set({ syncStatus: "syncing", syncError: null })
          .where(eq(vmCluster.vmClusterId, cluster.vmClusterId));

        const client = createProxmoxClientFromCluster({
          host: cluster.apiHost,
          port: cluster.apiPort,
          tokenId: cluster.tokenId,
          tokenSecret: cluster.tokenSecret,
          fingerprint: cluster.sslFingerprint,
        });

        const hostsCount = await this.syncNodes(
          db,
          client,
          cluster,
          provider.providerId
        );
        totalHosts += hostsCount;

        const nodeNameToHostId = await this.getNodeNameToHostIdMap(
          db,
          provider.providerId
        );

        const vmsCount = await this.syncVms(
          db,
          client,
          cluster,
          provider.providerId,
          nodeNameToHostId
        );
        totalVms += vmsCount;

        await db
          .update(vmCluster)
          .set({
            syncStatus: "idle",
            lastSyncAt: new Date(),
            syncError: null,
          })
          .where(eq(vmCluster.vmClusterId, cluster.vmClusterId));
      } catch (error) {
        await db
          .update(vmCluster)
          .set({
            syncStatus: "error",
            syncError:
              error instanceof Error ? error.message : "Sync failed",
          })
          .where(eq(vmCluster.vmClusterId, cluster.vmClusterId));
      }
    }

    return { hostsDiscovered: totalHosts, vmsDiscovered: totalVms };
  }

  private async syncNodes(
    db: Database,
    client: ProxmoxClient,
    cluster: typeof vmCluster.$inferSelect,
    providerId: string
  ): Promise<number> {
    const nodesWithStatus = await client.getNodesWithStatus();

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

      let nodeIpAddress: string | null = existing?.ipAddress || null;
      if (!nodeIpAddress && nodesWithStatus.length === 1 && cluster.apiHost) {
        nodeIpAddress = cluster.apiHost.replace(/^https?:\/\//, "");
      }

      if (existing) {
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
    cluster: typeof vmCluster.$inferSelect,
    providerId: string,
    nodeNameToHostId: Map<string, string>
  ): Promise<number> {
    const allVms = await client.getAllVms();
    const vms = allVms.filter((v) => v.template !== 1);

    const existingVms = await db
      .select()
      .from(vm)
      .where(eq(vm.vmClusterId, cluster.vmClusterId));

    const existingVmByVmid = new Map(
      existingVms
        .filter((v) => v.externalVmid != null)
        .map((v) => [v.externalVmid!, v])
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

      if (!ipAddressValue && pvm.node && pvm.vmid && pvm.status === "running") {
        ipAddressValue = await getIpFromGuestAgent(client, pvm.node, pvm.vmid);
      }

      if (existing) {
        await db
          .update(vm)
          .set({
            cpu: cpuCount,
            memoryMb,
            diskGb,
            status,
            vmType: pvm.type || "qemu",
            hostId: hostId || existing.hostId,
            ipAddress: existing.ipAddress || ipAddressValue,
          })
          .where(eq(vm.vmId, existing.vmId));

        const effectiveIp = existing.ipAddress || ipAddressValue;
        if (effectiveIp) {
          await this.upsertIpAddress(db, effectiveIp, "vm", existing.vmId, existing.name);
        }
      } else {
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
            vmClusterId: cluster.vmClusterId,
            externalVmid: pvm.vmid,
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

        if (ipAddressValue && inserted) {
          await this.upsertIpAddress(db, ipAddressValue, "vm", inserted.vmId, vmName);
        }
      }
      count++;
    }

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
    provider: Provider,
    spec: VmCreateSpec
  ): Promise<VmProvisionResult> {
    // Find a vmCluster for this provider
    const clusters = await this.db
      .select()
      .from(vmCluster)
      .where(
        spec.vmClusterId
          ? eq(vmCluster.vmClusterId, spec.vmClusterId)
          : eq(vmCluster.providerId, provider.providerId)
      );

    const cluster = clusters[0];
    if (!cluster) {
      throw new Error(`No VM cluster found for provider ${provider.providerId}`);
    }

    const client = createProxmoxClientFromCluster({
      host: cluster.apiHost,
      port: cluster.apiPort,
      tokenId: cluster.tokenId,
      tokenSecret: cluster.tokenSecret,
      fingerprint: cluster.sslFingerprint,
    });

    // Find template
    const templates = await client.getTemplates();
    let template = spec.templateId
      ? templates.find((t) => t.vmid === parseInt(spec.templateId!, 10) || t.name === spec.templateId)
      : templates[0];

    if (!template) {
      throw new Error("No VM template found. Create a template first.");
    }

    const nodeName = spec.hostName || template.node || (await client.getNodes())[0]?.node;
    if (!nodeName) {
      throw new Error("No Proxmox node available");
    }

    // Allocate VMID and clone
    const newVmid = await client.getNextVmid();
    const upid = await client.cloneVm(nodeName, template.vmid, {
      newid: newVmid,
      name: spec.name,
      full: 1,
    });
    await client.waitForTask(nodeName, upid);

    // Apply cloud-init config if provided
    if (spec.cloudInit) {
      const ciConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {};
      if (spec.cloudInit.user) ciConfig.ciuser = spec.cloudInit.user;
      if (spec.cloudInit.password) ciConfig.cipassword = spec.cloudInit.password;
      if (spec.cloudInit.sshKeys) ciConfig.sshkeys = encodeURIComponent(spec.cloudInit.sshKeys);
      if (spec.cloudInit.ipConfig) ciConfig.ipconfig0 = spec.cloudInit.ipConfig;
      if (spec.cloudInit.nameserver) ciConfig.nameserver = spec.cloudInit.nameserver;
      if (spec.cloudInit.searchDomain) ciConfig.searchdomain = spec.cloudInit.searchDomain;
      await client.updateVmConfig(nodeName, newVmid, ciConfig);
    }

    // Resize CPU/memory if specs differ from template
    const resizeConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {};
    if (spec.cpu) resizeConfig.cores = spec.cpu;
    if (spec.memoryMb) resizeConfig.memory = spec.memoryMb;
    if (Object.keys(resizeConfig).length > 0) {
      await client.updateVmConfig(nodeName, newVmid, resizeConfig);
    }
    // Resize disk to desired total size (Proxmox rejects shrinks, no-ops on same size)
    if (spec.diskGb) {
      await client.resizeDisk(nodeName, newVmid, "scsi0", `${spec.diskGb}G`);
    }

    // Start the VM
    const startUpid = await client.startVm(nodeName, newVmid);
    await client.waitForTask(nodeName, startUpid);

    // Poll for IP via guest agent (up to 90s)
    let vmIpAddress: string | undefined;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 90000) {
      try {
        const agentUp = await client.checkQemuAgent(nodeName, newVmid);
        if (agentUp) {
          const interfaces = await client.getGuestNetworkInterfaces(nodeName, newVmid);
          for (const iface of interfaces) {
            if (iface.name === "lo") continue;
            for (const addr of iface["ip-addresses"] || []) {
              if (addr["ip-address-type"] === "ipv4" && !addr["ip-address"].startsWith("127.")) {
                vmIpAddress = addr["ip-address"];
                break;
              }
            }
            if (vmIpAddress) break;
          }
          if (vmIpAddress) break;
        }
      } catch {
        // Agent not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return { externalId: String(newVmid), ipAddress: vmIpAddress };
  }

  async cloneVm(
    provider: Provider,
    spec: VmCloneSpec
  ): Promise<VmProvisionResult> {
    const ctx = await getVmContext(this.db, spec.sourceExternalId);

    const newVmid = await ctx.client.getNextVmid();
    const upid = await ctx.client.cloneVm(ctx.nodeName, ctx.vmid, {
      newid: newVmid,
      name: spec.name,
      full: spec.full ? 1 : 0,
    });
    await ctx.client.waitForTask(ctx.nodeName, upid);

    // Apply cloud-init if provided
    if (spec.cloudInit) {
      const ciConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {};
      if (spec.cloudInit.user) ciConfig.ciuser = spec.cloudInit.user;
      if (spec.cloudInit.password) ciConfig.cipassword = spec.cloudInit.password;
      if (spec.cloudInit.sshKeys) ciConfig.sshkeys = encodeURIComponent(spec.cloudInit.sshKeys);
      if (spec.cloudInit.ipConfig) ciConfig.ipconfig0 = spec.cloudInit.ipConfig;
      if (spec.cloudInit.nameserver) ciConfig.nameserver = spec.cloudInit.nameserver;
      if (spec.cloudInit.searchDomain) ciConfig.searchdomain = spec.cloudInit.searchDomain;
      await ctx.client.updateVmConfig(ctx.nodeName, newVmid, ciConfig);
    }

    // Resize if specified
    const resizeConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {};
    if (spec.cpu) resizeConfig.cores = spec.cpu;
    if (spec.memoryMb) resizeConfig.memory = spec.memoryMb;
    if (Object.keys(resizeConfig).length > 0) {
      await ctx.client.updateVmConfig(ctx.nodeName, newVmid, resizeConfig);
    }
    if (spec.diskGb) {
      await ctx.client.resizeDisk(ctx.nodeName, newVmid, "scsi0", `${spec.diskGb}G`);
    }

    // Start the cloned VM
    const startUpid = await ctx.client.startVm(ctx.nodeName, newVmid);
    await ctx.client.waitForTask(ctx.nodeName, startUpid);

    // Poll for IP
    let vmIpAddress: string | undefined;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 90000) {
      try {
        const agentUp = await ctx.client.checkQemuAgent(ctx.nodeName, newVmid);
        if (agentUp) {
          const interfaces = await ctx.client.getGuestNetworkInterfaces(ctx.nodeName, newVmid);
          for (const iface of interfaces) {
            if (iface.name === "lo") continue;
            for (const addr of iface["ip-addresses"] || []) {
              if (addr["ip-address-type"] === "ipv4" && !addr["ip-address"].startsWith("127.")) {
                vmIpAddress = addr["ip-address"];
                break;
              }
            }
            if (vmIpAddress) break;
          }
          if (vmIpAddress) break;
        }
      } catch {
        // Agent not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return { externalId: String(newVmid), ipAddress: vmIpAddress };
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

    // Resolve targetHost — could be a hostId or host name
    const [targetHostRecord] = await this.db
      .select()
      .from(host)
      .where(eq(host.hostId, targetHost))
      .limit(1);

    const targetNodeName = targetHostRecord?.name || targetHost;

    const upid = await ctx.client.migrateVm(
      ctx.nodeName,
      ctx.vmid,
      targetNodeName,
      true // online migration
    );
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async snapshotVm(
    _provider: Provider,
    externalId: string,
    name?: string,
    description?: string
  ): Promise<SnapshotResult> {
    const ctx = await getVmContext(this.db, externalId);
    const snapshotName = name || `snap-${Date.now()}`;
    const upid = await ctx.client.createSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName,
      description
    );
    await ctx.client.waitForTask(ctx.nodeName, upid);

    return {
      snapshotId: snapshotName,
      createdAt: new Date().toISOString(),
    };
  }

  async listSnapshots(
    _provider: Provider,
    externalId: string
  ): Promise<SnapshotInfo[]> {
    const ctx = await getVmContext(this.db, externalId);
    const snapshots = await ctx.client.listSnapshots(ctx.nodeName, ctx.vmid);

    return snapshots
      .filter((s) => s.name !== "current") // Filter out the 'current' pseudo-snapshot
      .map((s) => ({
        name: s.name,
        description: s.description,
        createdAt: s.snaptime ? new Date(s.snaptime * 1000).toISOString() : undefined,
        vmstate: s.vmstate === 1,
        parent: s.parent,
      }));
  }

  async restoreSnapshot(
    _provider: Provider,
    externalId: string,
    snapshotName: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.rollbackSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName
    );
    await ctx.client.waitForTask(ctx.nodeName, upid);
  }

  async deleteSnapshot(
    _provider: Provider,
    externalId: string,
    snapshotName: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId);
    const upid = await ctx.client.deleteSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName
    );
    await ctx.client.waitForTask(ctx.nodeName, upid);
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
