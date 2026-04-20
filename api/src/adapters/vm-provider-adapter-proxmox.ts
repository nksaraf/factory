import { and, eq, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { estate, host, ipAddress } from "../db/schema/infra"
import {
  type ProxmoxClient,
  createProxmoxClientFromCluster,
} from "../lib/proxmox/client"
import {
  getIpFromGuestAgent,
  getPrimaryIpFromConfig,
} from "../lib/proxmox/ip-extraction"
import { getVmContext } from "../lib/proxmox/resolve-vm"
import type {
  CloudInitConfig,
  ProxmoxNode,
  ProxmoxNodeStatus,
  ProxmoxVmConfig,
} from "../lib/proxmox/types"
import { PostgresSecretBackend } from "../lib/secrets/postgres-backend"
import { createSpecRefResolver } from "../lib/spec-ref-resolver"
import { allocateSlug } from "../lib/slug"
import type {
  InfraEstate,
  SnapshotInfo,
  SnapshotResult,
  SyncResult,
  VMProviderAdapter,
  VmCloneSpec,
  VmCreateSpec,
  VmProvisionResult,
  VmResizeSpec,
} from "./vm-provider-adapter"

const BYTES_PER_MB = 1024 * 1024
const BYTES_PER_GB = 1024 * 1024 * 1024

type HostLifecycle = "active" | "maintenance" | "offline" | "decommissioned"

function mapNodeLifecycle(status: string): HostLifecycle {
  if (status === "online") return "active"
  return "offline"
}

function mapVmLifecycle(status: string): HostLifecycle {
  if (status === "running") return "active"
  if (status === "stopped" || status === "paused") return "offline"
  return "maintenance"
}

/**
 * Extract Proxmox connection info from a hypervisor estate spec,
 * resolving `$secret()` / `$var()` references.
 */
async function getClusterConfig(db: Database, hypervisor: InfraEstate) {
  const spec = (hypervisor.spec ?? {}) as Record<string, unknown>
  const resolver = createSpecRefResolver(db, new PostgresSecretBackend(db))
  const resolved = await resolver.resolve(spec)
  return {
    host: resolved.apiHost as string,
    port: resolved.apiPort as number,
    tokenId: resolved.tokenId as string,
    tokenSecret: resolved.tokenSecret as string,
    fingerprint: resolved.sslFingerprint as string | undefined,
  }
}

export class ProxmoxVmProviderAdapter implements VMProviderAdapter {
  readonly type = "proxmox"

  constructor(private db: Database) {}

  async syncInventory(hypervisor: InfraEstate): Promise<SyncResult> {
    const db = this.db

    try {
      // Mark syncing
      await db
        .update(estate)
        .set({
          spec: sql`${estate.spec} || '{"syncStatus":"syncing","syncError":null}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(estate.id, hypervisor.id))

      const client = createProxmoxClientFromCluster(
        await getClusterConfig(db, hypervisor)
      )

      const totalHosts = await this.syncNodes(db, client, hypervisor)
      const totalVms = await this.syncVms(db, client, hypervisor)

      // Mark complete
      await db
        .update(estate)
        .set({
          spec: sql`${estate.spec} || ${JSON.stringify({
            syncStatus: "idle",
            lastSyncAt: new Date().toISOString(),
            syncError: null,
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(estate.id, hypervisor.id))

      return { hostsDiscovered: totalHosts, vmsDiscovered: totalVms }
    } catch (error) {
      await db
        .update(estate)
        .set({
          spec: sql`${estate.spec} || ${JSON.stringify({
            syncStatus: "error",
            syncError: error instanceof Error ? error.message : "Sync failed",
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(estate.id, hypervisor.id))

      throw error
    }
  }

  private async syncNodes(
    db: Database,
    client: ProxmoxClient,
    hypervisor: InfraEstate
  ): Promise<number> {
    const nodesWithStatus = await client.getNodesWithStatus()
    const hypervisorSpec = (hypervisor.spec ?? {}) as Record<string, unknown>

    // Get existing bare-metal hosts under this hypervisor
    const existingHosts = await db
      .select()
      .from(host)
      .where(and(eq(host.estateId, hypervisor.id), eq(host.type, "bare-metal")))

    const existingHostByName = new Map(existingHosts.map((h) => [h.name, h]))
    const seenNames = new Set<string>()
    let count = 0

    for (const node of nodesWithStatus) {
      seenNames.add(node.node)
      const existing = existingHostByName.get(node.node)

      const cpuCores =
        (node as ProxmoxNode & { details?: ProxmoxNodeStatus }).details?.cpuinfo
          ?.cores ||
        node.maxcpu ||
        0
      const memoryMb = Math.round((node.maxmem || 0) / BYTES_PER_MB)
      const diskGb = Math.round((node.maxdisk || 0) / BYTES_PER_GB)
      const lifecycle = mapNodeLifecycle(node.status)

      let nodeIpAddress: string | null =
        ((existing?.spec as Record<string, unknown>)?.ipAddress as
          | string
          | null) || null
      if (
        !nodeIpAddress &&
        nodesWithStatus.length === 1 &&
        hypervisorSpec.apiHost
      ) {
        nodeIpAddress = (hypervisorSpec.apiHost as string).replace(
          /^https?:\/\//,
          ""
        )
      }

      const hostSpec = {
        hostname: node.node,
        os: "linux" as const,
        arch: "amd64" as const,
        cpu: cpuCores,
        memoryMb,
        diskGb,
        accessMethod: "ssh" as const,
        accessUser: "root",
        sshPort: 22,
        lifecycle,
        ipAddress: nodeIpAddress ?? undefined,
      }

      if (existing) {
        await db
          .update(host)
          .set({ spec: hostSpec, updatedAt: new Date() })
          .where(eq(host.id, existing.id))
      } else {
        const slug = await allocateSlug({
          baseLabel: node.node,
          isTaken: async (s) => {
            const [r] = await db
              .select()
              .from(host)
              .where(eq(host.slug, s))
              .limit(1)
            return r != null
          },
        })

        await db.insert(host).values({
          name: node.node,
          slug,
          type: "bare-metal",
          estateId: hypervisor.id,
          spec: hostSpec,
        })
      }

      // Upsert IP address
      if (nodeIpAddress) {
        const hostRecord =
          existing ||
          (await db
            .select()
            .from(host)
            .where(
              and(eq(host.name, node.node), eq(host.estateId, hypervisor.id))
            )
            .limit(1)
            .then((r) => r[0]))

        if (hostRecord) {
          await this.upsertIpAddress(db, nodeIpAddress, "host", hostRecord.id)
        }
      }

      count++
    }

    // Remove hosts that no longer exist in Proxmox
    for (const [name, existing] of existingHostByName) {
      if (!seenNames.has(name)) {
        await db.delete(host).where(eq(host.id, existing.id))
      }
    }

    return count
  }

  private async syncVms(
    db: Database,
    client: ProxmoxClient,
    hypervisor: InfraEstate
  ): Promise<number> {
    const allVms = await client.getAllVms()
    const vms = allVms.filter((v) => v.template !== 1)

    // Get existing VM hosts under this hypervisor
    const existingVmHosts = await db
      .select()
      .from(host)
      .where(and(eq(host.estateId, hypervisor.id), eq(host.type, "vm")))

    const existingByExternalId = new Map(
      existingVmHosts
        .filter((h) => {
          const spec = (h.spec ?? {}) as Record<string, unknown>
          return spec.externalId != null
        })
        .map((h) => {
          const spec = (h.spec ?? {}) as Record<string, unknown>
          return [String(spec.externalId), h]
        })
    )
    const seenIds = new Set<string>()
    let count = 0

    // Build node→hostId map for bare-metal hosts
    const bareMetalHosts = await db
      .select()
      .from(host)
      .where(and(eq(host.estateId, hypervisor.id), eq(host.type, "bare-metal")))
    const nodeNameToHostId = new Map(bareMetalHosts.map((h) => [h.name, h.id]))

    for (const pvm of vms) {
      const existing = existingByExternalId.get(String(pvm.vmid))
      if (existing) seenIds.add(existing.id)

      const cpuCount = pvm.cpus || 1
      const memoryMb = Math.round((pvm.maxmem || 0) / BYTES_PER_MB)
      const diskGb = Math.round((pvm.maxdisk || 0) / BYTES_PER_GB)
      const lifecycle = mapVmLifecycle(pvm.status || "stopped")

      let ipAddressValue: string | null = null
      // For running VMs, prefer guest-agent (runtime truth) over cloud-init
      // ipconfig0 (often stale after clone/reconfigure).
      if (pvm.node && pvm.vmid && pvm.status === "running") {
        ipAddressValue = await getIpFromGuestAgent(client, pvm.node, pvm.vmid)
      }
      if (!ipAddressValue) {
        try {
          if (pvm.node && pvm.vmid) {
            const vmConfig = await client.getVmConfig(
              pvm.node,
              pvm.vmid,
              pvm.type || "qemu"
            )
            ipAddressValue = getPrimaryIpFromConfig(vmConfig)
          }
        } catch {
          // Config fetch failed, continue
        }
      }

      const vmName = pvm.name || `vm-${pvm.vmid}`
      const vmType = pvm.type === "lxc" ? ("lxc" as const) : ("vm" as const)

      const hostSpec = {
        hostname: vmName,
        os: "linux" as const,
        arch: "amd64" as const,
        cpu: cpuCount,
        memoryMb,
        diskGb,
        accessMethod: "ssh" as const,
        accessUser: "root",
        sshPort: 22,
        lifecycle,
        externalId: String(pvm.vmid),
        ipAddress:
          ipAddressValue ??
          ((existing?.spec as Record<string, unknown>)?.ipAddress as
            | string
            | undefined) ??
          undefined,
      }

      if (existing) {
        const updates: Record<string, unknown> = {
          spec: hostSpec,
          type: vmType,
          updatedAt: new Date(),
        }
        if (existing.name !== vmName) {
          updates.name = vmName
          updates.slug = await allocateSlug({
            baseLabel: vmName,
            isTaken: async (s) => {
              if (s === existing.slug) return false
              const [r] = await db
                .select()
                .from(host)
                .where(eq(host.slug, s))
                .limit(1)
              return r != null
            },
          })
        }
        await db.update(host).set(updates).where(eq(host.id, existing.id))

        const effectiveIp = hostSpec.ipAddress
        if (effectiveIp) {
          await this.upsertIpAddress(db, effectiveIp, "host", existing.id)
        }
      } else {
        const slug = await allocateSlug({
          baseLabel: vmName,
          isTaken: async (s) => {
            const [r] = await db
              .select()
              .from(host)
              .where(eq(host.slug, s))
              .limit(1)
            return r != null
          },
        })

        const [inserted] = await db
          .insert(host)
          .values({
            name: vmName,
            slug,
            type: vmType,
            estateId: hypervisor.id,
            spec: hostSpec,
          })
          .returning()

        if (ipAddressValue && inserted) {
          await this.upsertIpAddress(db, ipAddressValue, "host", inserted.id)
        }
      }
      count++
    }

    // Remove VMs that no longer exist in Proxmox
    for (const existing of existingVmHosts) {
      if (!seenIds.has(existing.id)) {
        await db.delete(host).where(eq(host.id, existing.id))
      }
    }

    return count
  }

  private async upsertIpAddress(
    db: Database,
    address: string,
    assignedToKind: string,
    assignedToId: string
  ): Promise<void> {
    try {
      const [existing] = await db
        .select()
        .from(ipAddress)
        .where(eq(ipAddress.address, address))
        .limit(1)

      const ipSpec = {
        version: "v4" as const,
        status: "assigned" as const,
      }

      if (existing) {
        await db
          .update(ipAddress)
          .set({
            spec: ipSpec,
            assignedToKind,
            assignedToId,
            updatedAt: new Date(),
          })
          .where(eq(ipAddress.id, existing.id))
      } else {
        await db.insert(ipAddress).values({
          address,
          assignedToKind,
          assignedToId,
          spec: ipSpec,
        })
      }
    } catch {
      // IPAM upsert is best-effort
    }
  }

  // --- VM Lifecycle Methods ---

  async createVm(
    hypervisor: InfraEstate,
    spec: VmCreateSpec
  ): Promise<VmProvisionResult> {
    const client = createProxmoxClientFromCluster(
      await getClusterConfig(this.db, hypervisor)
    )

    // Find template
    const templates = await client.getTemplates()
    let template = spec.templateId
      ? templates.find(
          (t) =>
            t.vmid === parseInt(spec.templateId!, 10) ||
            t.name === spec.templateId
        )
      : templates[0]

    if (!template) {
      throw new Error("No VM template found. Create a template first.")
    }

    const nodeName =
      spec.hostName || template.node || (await client.getNodes())[0]?.node
    if (!nodeName) {
      throw new Error("No Proxmox node available")
    }

    // Allocate VMID and clone
    const newVmid = await client.getNextVmid()
    const upid = await client.cloneVm(nodeName, template.vmid, {
      newid: newVmid,
      name: spec.name,
      full: 1,
    })
    await client.waitForTask(nodeName, upid)

    // Apply cloud-init config if provided
    if (spec.cloudInit) {
      const ciConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {}
      if (spec.cloudInit.user) ciConfig.ciuser = spec.cloudInit.user
      if (spec.cloudInit.password) ciConfig.cipassword = spec.cloudInit.password
      if (spec.cloudInit.sshKeys)
        ciConfig.sshkeys = encodeURIComponent(spec.cloudInit.sshKeys)
      if (spec.cloudInit.ipConfig) ciConfig.ipconfig0 = spec.cloudInit.ipConfig
      if (spec.cloudInit.nameserver)
        ciConfig.nameserver = spec.cloudInit.nameserver
      if (spec.cloudInit.searchDomain)
        ciConfig.searchdomain = spec.cloudInit.searchDomain
      await client.updateVmConfig(nodeName, newVmid, ciConfig)
    }

    // Resize CPU/memory
    const resizeConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {}
    if (spec.cpu) resizeConfig.cores = spec.cpu
    if (spec.memoryMb) resizeConfig.memory = spec.memoryMb
    if (Object.keys(resizeConfig).length > 0) {
      await client.updateVmConfig(nodeName, newVmid, resizeConfig)
    }
    if (spec.diskGb) {
      await client.resizeDisk(nodeName, newVmid, "scsi0", `${spec.diskGb}G`)
    }

    // Start the VM
    const startUpid = await client.startVm(nodeName, newVmid)
    await client.waitForTask(nodeName, startUpid)

    // Poll for IP via guest agent
    let vmIpAddress: string | undefined
    const pollStart = Date.now()
    while (Date.now() - pollStart < 90000) {
      try {
        const agentUp = await client.checkQemuAgent(nodeName, newVmid)
        if (agentUp) {
          const interfaces = await client.getGuestNetworkInterfaces(
            nodeName,
            newVmid
          )
          for (const iface of interfaces) {
            if (iface.name === "lo") continue
            for (const addr of iface["ip-addresses"] || []) {
              if (
                addr["ip-address-type"] === "ipv4" &&
                !addr["ip-address"].startsWith("127.")
              ) {
                vmIpAddress = addr["ip-address"]
                break
              }
            }
            if (vmIpAddress) break
          }
          if (vmIpAddress) break
        }
      } catch {
        // Agent not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return { externalId: String(newVmid), ipAddress: vmIpAddress }
  }

  async cloneVm(
    _hypervisor: InfraEstate,
    spec: VmCloneSpec
  ): Promise<VmProvisionResult> {
    const ctx = await getVmContext(this.db, spec.sourceVmId)

    const newVmid = await ctx.client.getNextVmid()
    const upid = await ctx.client.cloneVm(ctx.nodeName, ctx.vmid, {
      newid: newVmid,
      name: spec.name,
      full: spec.full ? 1 : 0,
    })
    await ctx.client.waitForTask(ctx.nodeName, upid)

    if (spec.cloudInit) {
      const ciConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {}
      if (spec.cloudInit.user) ciConfig.ciuser = spec.cloudInit.user
      if (spec.cloudInit.password) ciConfig.cipassword = spec.cloudInit.password
      if (spec.cloudInit.sshKeys)
        ciConfig.sshkeys = encodeURIComponent(spec.cloudInit.sshKeys)
      if (spec.cloudInit.ipConfig) ciConfig.ipconfig0 = spec.cloudInit.ipConfig
      if (spec.cloudInit.nameserver)
        ciConfig.nameserver = spec.cloudInit.nameserver
      if (spec.cloudInit.searchDomain)
        ciConfig.searchdomain = spec.cloudInit.searchDomain
      await ctx.client.updateVmConfig(ctx.nodeName, newVmid, ciConfig)
    }

    const resizeConfig: Partial<ProxmoxVmConfig> & CloudInitConfig = {}
    if (spec.cpu) resizeConfig.cores = spec.cpu
    if (spec.memoryMb) resizeConfig.memory = spec.memoryMb
    if (Object.keys(resizeConfig).length > 0) {
      await ctx.client.updateVmConfig(ctx.nodeName, newVmid, resizeConfig)
    }
    if (spec.diskGb) {
      await ctx.client.resizeDisk(
        ctx.nodeName,
        newVmid,
        "scsi0",
        `${spec.diskGb}G`
      )
    }

    const startUpid = await ctx.client.startVm(ctx.nodeName, newVmid)
    await ctx.client.waitForTask(ctx.nodeName, startUpid)

    let vmIpAddress: string | undefined
    const pollStart = Date.now()
    while (Date.now() - pollStart < 90000) {
      try {
        const agentUp = await ctx.client.checkQemuAgent(ctx.nodeName, newVmid)
        if (agentUp) {
          const interfaces = await ctx.client.getGuestNetworkInterfaces(
            ctx.nodeName,
            newVmid
          )
          for (const iface of interfaces) {
            if (iface.name === "lo") continue
            for (const addr of iface["ip-addresses"] || []) {
              if (
                addr["ip-address-type"] === "ipv4" &&
                !addr["ip-address"].startsWith("127.")
              ) {
                vmIpAddress = addr["ip-address"]
                break
              }
            }
            if (vmIpAddress) break
          }
          if (vmIpAddress) break
        }
      } catch {
        // Agent not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return { externalId: String(newVmid), ipAddress: vmIpAddress }
  }

  async startVm(_hypervisor: InfraEstate, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.startVm(ctx.nodeName, ctx.vmid, ctx.vmType)
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async stopVm(_hypervisor: InfraEstate, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.stopVm(ctx.nodeName, ctx.vmid, ctx.vmType)
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async restartVm(_hypervisor: InfraEstate, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.rebootVm(ctx.nodeName, ctx.vmid, ctx.vmType)
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async resizeVm(
    _hypervisor: InfraEstate,
    externalId: string,
    spec: VmResizeSpec
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)

    const configUpdate: Partial<ProxmoxVmConfig> & CloudInitConfig = {}
    if (spec.cpu != null) configUpdate.cores = spec.cpu
    if (spec.memoryMb != null) configUpdate.memory = spec.memoryMb

    if (Object.keys(configUpdate).length > 0) {
      await ctx.client.updateVmConfig(
        ctx.nodeName,
        ctx.vmid,
        configUpdate,
        ctx.vmType
      )
    }

    if (spec.diskGb != null) {
      await ctx.client.resizeDisk(
        ctx.nodeName,
        ctx.vmid,
        "scsi0",
        `${spec.diskGb}G`
      )
    }
  }

  async migrateVm(
    _hypervisor: InfraEstate,
    externalId: string,
    targetHost: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)

    // Resolve targetHost — could be a host id, slug, or node name
    const [targetHostRecord] = await this.db
      .select()
      .from(host)
      .where(eq(host.id, targetHost))
      .limit(1)

    const targetNodeName = targetHostRecord?.name || targetHost

    const upid = await ctx.client.migrateVm(
      ctx.nodeName,
      ctx.vmid,
      targetNodeName,
      true
    )
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async snapshotVm(
    _hypervisor: InfraEstate,
    externalId: string,
    name?: string,
    description?: string
  ): Promise<SnapshotResult> {
    const ctx = await getVmContext(this.db, externalId)
    const snapshotName = name || `snap-${Date.now()}`
    const upid = await ctx.client.createSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName,
      description
    )
    await ctx.client.waitForTask(ctx.nodeName, upid)

    return { snapshotId: snapshotName, createdAt: new Date().toISOString() }
  }

  async listSnapshots(
    _hypervisor: InfraEstate,
    externalId: string
  ): Promise<SnapshotInfo[]> {
    const ctx = await getVmContext(this.db, externalId)
    const snapshots = await ctx.client.listSnapshots(ctx.nodeName, ctx.vmid)

    return snapshots
      .filter((s) => s.name !== "current")
      .map((s) => ({
        name: s.name,
        description: s.description,
        createdAt: s.snaptime
          ? new Date(s.snaptime * 1000).toISOString()
          : undefined,
        vmstate: s.vmstate === 1,
        parent: s.parent,
      }))
  }

  async restoreSnapshot(
    _hypervisor: InfraEstate,
    externalId: string,
    snapshotName: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.rollbackSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName
    )
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async deleteSnapshot(
    _hypervisor: InfraEstate,
    externalId: string,
    snapshotName: string
  ): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.deleteSnapshot(
      ctx.nodeName,
      ctx.vmid,
      snapshotName
    )
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }

  async destroyVm(_hypervisor: InfraEstate, externalId: string): Promise<void> {
    const ctx = await getVmContext(this.db, externalId)
    const upid = await ctx.client.deleteVm(ctx.nodeName, ctx.vmid, ctx.vmType)
    await ctx.client.waitForTask(ctx.nodeName, upid)
  }
}
