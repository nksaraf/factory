/**
 * Proxmox API Client
 * Wrapper around @corsinvest/cv4pve-api-javascript for multi-cluster management
 */

// The @corsinvest/cv4pve-api-javascript library has unreliable type signatures
// (strict: false in the original repo). We use `any` for the client internally.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { PveClient } from "@corsinvest/cv4pve-api-javascript"

import type {
  CloudInitConfig,
  ConnectionTestResult,
  GuestNetworkInterface,
  ProxmoxCloneOptions,
  ProxmoxCredentials,
  ProxmoxNode,
  ProxmoxNodeStatus,
  ProxmoxSnapshot,
  ProxmoxStorage,
  ProxmoxTask,
  ProxmoxTaskLogLine,
  ProxmoxVmConfig,
  ProxmoxVmInfo,
} from "./types"

/**
 * Extended PveClient with helper methods for our use cases
 */
export class ProxmoxClient {
  // Use `any` because the library's TS types have incorrect argument counts
  private client: any
  private credentials: ProxmoxCredentials

  constructor(credentials: ProxmoxCredentials) {
    this.credentials = credentials
    // Remove protocol if present, PveClient adds https://
    const host = credentials.host.replace(/^https?:\/\//, "")
    const port = credentials.port || 8006
    this.client = new PveClient(host, port)

    // Configure API token authentication (recommended for automation)
    this.client.apiToken = `${credentials.tokenId}=${credentials.tokenSecret}`

    // Set reasonable timeout
    this.client.timeout = 60000 // 60 seconds
  }

  /**
   * Test connection to the Proxmox server
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.client.version.version()

      if (!result.isSuccessStatusCode) {
        return {
          success: false,
          error: `API error: ${result.statusCode} - ${result.reasonPhrase}`,
        }
      }

      // Also get nodes to verify full access
      const nodesResult = await this.client.nodes.index()
      const nodes = nodesResult.isSuccessStatusCode
        ? nodesResult.response.data.map((n: any) => n.node)
        : []

      return {
        success: true,
        version: result.response.data.version,
        nodes,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      }
    }
  }

  /**
   * Get all nodes in the cluster
   */
  async getNodes(): Promise<ProxmoxNode[]> {
    const result = await this.client.nodes.index()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get nodes: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxNode[]
  }

  /**
   * Get detailed node status
   */
  async getNodeStatus(nodeName: string): Promise<ProxmoxNodeStatus> {
    const result = await this.client.nodes.get(nodeName).status.status()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get node status: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxNodeStatus
  }

  /**
   * Get all nodes with detailed status
   */
  async getNodesWithStatus(): Promise<(ProxmoxNode & { details?: ProxmoxNodeStatus })[]> {
    const nodes = await this.getNodes()

    const results: (ProxmoxNode & { details?: ProxmoxNodeStatus })[] = []
    for (const node of nodes) {
      try {
        if (node.status === "online") {
          const details = await this.getNodeStatus(node.node)
          results.push({ ...node, details })
        } else {
          results.push(node)
        }
      } catch {
        // If we can't get details, just return the basic node info
        results.push(node)
      }
    }

    return results
  }

  /**
   * Get Proxmox version
   */
  async getVersion(): Promise<{ version: string; release: string; repoid: string }> {
    const result = await this.client.version.version()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get version: ${result.reasonPhrase}`)
    }

    return result.response.data
  }

  /**
   * Get all VMs across all nodes
   */
  async getAllVms(): Promise<ProxmoxVmInfo[]> {
    const nodes = await this.getNodes()
    const allVms: ProxmoxVmInfo[] = []

    for (const node of nodes) {
      // Get QEMU VMs
      const qemuResult = await this.client.nodes.get(node.node).qemu.vmlist(true)
      if (qemuResult.isSuccessStatusCode) {
        const vms = qemuResult.response.data.map((vm: any) => ({
          ...vm,
          node: node.node,
          type: "qemu" as const,
        }))
        allVms.push(...vms)
      }

      // Get LXC containers
      const lxcResult = await this.client.nodes.get(node.node).lxc.vmlist()
      if (lxcResult.isSuccessStatusCode) {
        const containers = lxcResult.response.data.map((ct: any) => ({
          ...ct,
          node: node.node,
          type: "lxc" as const,
        }))
        allVms.push(...containers)
      }
    }

    return allVms
  }

  /**
   * Get VMs on a specific node
   */
  async getNodeVms(nodeName: string): Promise<ProxmoxVmInfo[]> {
    const vms: ProxmoxVmInfo[] = []

    const qemuResult = await this.client.nodes.get(nodeName).qemu.vmlist()
    if (qemuResult.isSuccessStatusCode) {
      vms.push(
        ...qemuResult.response.data.map((vm: any) => ({
          ...vm,
          node: nodeName,
          type: "qemu" as const,
        }))
      )
    }

    const lxcResult = await this.client.nodes.get(nodeName).lxc.vmlist()
    if (lxcResult.isSuccessStatusCode) {
      vms.push(
        ...lxcResult.response.data.map((ct: any) => ({
          ...ct,
          node: nodeName,
          type: "lxc" as const,
        }))
      )
    }

    return vms
  }

  /**
   * Get VM configuration
   */
  async getVmConfig(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<ProxmoxVmConfig> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.config.vmConfig()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get VM config: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxVmConfig
  }

  /**
   * Get VM current status
   */
  async getVmStatus(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<ProxmoxVmInfo> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.status.current.vmStatus()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get VM status: ${result.reasonPhrase}`)
    }

    return {
      ...result.response.data,
      vmid,
      node: nodeName,
      type,
    } as ProxmoxVmInfo
  }

  /**
   * Get all templates (VMs marked as templates)
   */
  async getTemplates(): Promise<ProxmoxVmInfo[]> {
    const allVms = await this.getAllVms()
    return allVms.filter((vm) => vm.template === 1)
  }

  /**
   * Start a VM
   */
  async startVm(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.status.start.vmStart()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to start VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Stop a VM
   */
  async stopVm(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.status.stop.vmStop()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to stop VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Shutdown a VM gracefully
   */
  async shutdownVm(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.status.shutdown.vmShutdown()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to shutdown VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Reboot a VM
   */
  async rebootVm(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.status.reboot.vmReboot()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to reboot VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Clone a VM from a template
   */
  async cloneVm(
    nodeName: string,
    templateVmid: number,
    options: ProxmoxCloneOptions
  ): Promise<string> {
    const resource = this.client.nodes.get(nodeName).qemu.get(templateVmid)

    const result = await resource.clone.cloneVm(options)

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to clone VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Update VM configuration (including cloud-init settings)
   */
  async updateVmConfig(
    nodeName: string,
    vmid: number,
    config: Partial<ProxmoxVmConfig> & CloudInitConfig,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<void> {
    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).config.client.set(
      `/nodes/${nodeName}/${type === "qemu" ? "qemu" : "lxc"}/${vmid}/config`,
      config
    );

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to update VM config: ${result.reasonPhrase}`)
    }
  }

  /**
   * Convert a VM to a template
   */
  async convertToTemplate(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.template.template()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to convert VM to template: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Resize a VM disk
   */
  async resizeDisk(
    nodeName: string,
    vmid: number,
    disk: string,
    size: string // e.g., "+10G" or "50G"
  ): Promise<void> {
    const resource = this.client.nodes.get(nodeName).qemu.get(vmid)

    const result = await resource.resize.resizeVm({ disk, size })

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to resize disk: ${result.reasonPhrase}`)
    }
  }

  /**
   * Get storage information for a node
   */
  async getNodeStorage(nodeName: string): Promise<ProxmoxStorage[]> {
    const result = await this.client.nodes.get(nodeName).storage.index()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get storage: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxStorage[]
  }

  /**
   * Get task status
   */
  async getTaskStatus(nodeName: string, upid: string): Promise<ProxmoxTask> {
    const result = await this.client.nodes.get(nodeName).tasks.get(upid).status.readTaskStatus()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get task status: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxTask
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(
    nodeName: string,
    upid: string,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 2000
  ): Promise<ProxmoxTask> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.getTaskStatus(nodeName, upid)

      if (task.status === "stopped") {
        if (task.exitstatus !== "OK") {
          throw new Error(`Task failed: ${task.exitstatus}`)
        }
        return task
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Task timed out after ${timeoutMs}ms`)
  }

  /**
   * Get the next available VMID
   */
  async getNextVmid(): Promise<number> {
    const result = await this.client.cluster.nextid.nextid()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get next VMID: ${result.reasonPhrase}`)
    }

    return parseInt(result.response.data, 10)
  }

  /**
   * Check if the QEMU Guest Agent is responding inside a VM
   * Uses the Proxmox API agent/ping endpoint (lightweight check)
   */
  async checkQemuAgent(nodeName: string, vmid: number): Promise<boolean> {
    try {
      const result = await this.client.nodes
        .get(nodeName)
        .qemu.get(vmid)
        .agent.ping.ping()
      return result.isSuccessStatusCode
    } catch {
      return false
    }
  }

  /**
   * Get network interfaces from QEMU guest agent via Proxmox API
   * Uses GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces
   */
  async getGuestNetworkInterfaces(
    nodeName: string,
    vmid: number
  ): Promise<GuestNetworkInterface[]> {
    const result = await this.client.nodes
      .get(nodeName)
      .qemu.get(vmid)
      .agent.get("network-get-interfaces")

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get guest network interfaces: ${result.reasonPhrase}`)
    }

    const data = result.response.data
    // The API returns { result: [...interfaces] } or just [...interfaces]
    return Array.isArray(data) ? data : (data?.result ?? [])
  }

  /**
   * Create a snapshot of a VM
   */
  async createSnapshot(
    nodeName: string,
    vmid: number,
    snapname: string,
    description?: string,
    vmstate?: boolean
  ): Promise<string> {
    const params: Record<string, unknown> = { snapname }
    if (description) params.description = description
    if (vmstate != null) params.vmstate = vmstate ? 1 : 0

    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).snapshot.client.set(
      `/nodes/${nodeName}/qemu/${vmid}/snapshot`,
      params
    )

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to create snapshot: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * List snapshots of a VM
   */
  async listSnapshots(
    nodeName: string,
    vmid: number
  ): Promise<ProxmoxSnapshot[]> {
    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).snapshot.snapshotList()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to list snapshots: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxSnapshot[]
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(
    nodeName: string,
    vmid: number,
    snapname: string
  ): Promise<string> {
    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).snapshot.get(snapname).client.delete(
      `/nodes/${nodeName}/qemu/${vmid}/snapshot/${snapname}`
    )

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to delete snapshot: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Rollback to a snapshot
   */
  async rollbackSnapshot(
    nodeName: string,
    vmid: number,
    snapname: string
  ): Promise<string> {
    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).snapshot.get(snapname).client.set(
      `/nodes/${nodeName}/qemu/${vmid}/snapshot/${snapname}/rollback`,
      {}
    )

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to rollback snapshot: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Migrate a VM to another node
   */
  async migrateVm(
    nodeName: string,
    vmid: number,
    target: string,
    online?: boolean
  ): Promise<string> {
    const params: Record<string, unknown> = { target }
    if (online != null) params.online = online ? 1 : 0

    const result = await this.client.nodes.get(nodeName).qemu.get(vmid).migrate.client.set(
      `/nodes/${nodeName}/qemu/${vmid}/migrate`,
      params
    )

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to migrate VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }

  /**
   * Get task log lines
   */
  async getTaskLog(
    nodeName: string,
    upid: string,
    start?: number,
    limit?: number
  ): Promise<ProxmoxTaskLogLine[]> {
    const params: Record<string, unknown> = {}
    if (start != null) params.start = start
    if (limit != null) params.limit = limit

    const result = await this.client.nodes.get(nodeName).tasks.get(upid).log.client.get(
      `/nodes/${nodeName}/tasks/${encodeURIComponent(upid)}/log`,
      params
    )

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to get task log: ${result.reasonPhrase}`)
    }

    return result.response.data as ProxmoxTaskLogLine[]
  }

  /**
   * Delete a VM
   */
  async deleteVm(
    nodeName: string,
    vmid: number,
    type: "qemu" | "lxc" = "qemu"
  ): Promise<string> {
    const resource =
      type === "qemu"
        ? this.client.nodes.get(nodeName).qemu.get(vmid)
        : this.client.nodes.get(nodeName).lxc.get(vmid)

    const result = await resource.destroyVm()

    if (!result.isSuccessStatusCode) {
      throw new Error(`Failed to delete VM: ${result.reasonPhrase}`)
    }

    return result.response.data as string // Returns UPID
  }
}

/**
 * Client factory for managing multiple cluster connections
 */
const clientCache = new Map<string, ProxmoxClient>()

export function getProxmoxClient(credentials: ProxmoxCredentials): ProxmoxClient {
  const cacheKey = `${credentials.host}:${credentials.tokenId}`

  let client = clientCache.get(cacheKey)
  if (!client) {
    client = new ProxmoxClient(credentials)
    clientCache.set(cacheKey, client)
  }

  return client
}

export function createProxmoxClient(credentials: ProxmoxCredentials): ProxmoxClient {
  return getProxmoxClient(credentials)
}

export function createProxmoxClientFromCluster(cluster: {
  host: string | null
  port?: number | null
  tokenId: string | null
  tokenSecret: string | null
  fingerprint?: string | null
}): ProxmoxClient {
  if (!cluster.host || !cluster.tokenId || !cluster.tokenSecret) {
    throw new Error("Proxmox cluster missing required credentials")
  }

  return createProxmoxClient({
    host: cluster.host,
    port: cluster.port || 8006,
    tokenId: cluster.tokenId,
    tokenSecret: cluster.tokenSecret,
    fingerprint: cluster.fingerprint || undefined,
  })
}

export function clearClientCache(host?: string): void {
  if (host) {
    for (const [key] of clientCache) {
      if (key.startsWith(host)) {
        clientCache.delete(key)
      }
    }
  } else {
    clientCache.clear()
  }
}
