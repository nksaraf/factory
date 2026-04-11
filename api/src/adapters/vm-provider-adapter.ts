import type { estate } from "../db/schema/infra"

/** An estate record representing a hypervisor/cloud-account. */
export type InfraEstate = typeof estate.$inferSelect

export interface VmCreateSpec {
  name: string
  templateId: string
  cpu: number
  memoryMb: number
  diskGb: number
  hostName?: string
  estateId?: string
  cloudInit?: {
    user?: string
    password?: string
    sshKeys?: string
    ipConfig?: string
    nameserver?: string
    searchDomain?: string
  }
}

export interface VmCloneSpec {
  /** Internal host id or slug (resolved via resolveVmHost) */
  sourceVmId: string
  name: string
  cpu?: number
  memoryMb?: number
  diskGb?: number
  full?: boolean
  cloudInit?: VmCreateSpec["cloudInit"]
}

export interface VmProvisionResult {
  externalId: string
  ipAddress?: string
}

export interface VmResizeSpec {
  cpu?: number
  memoryMb?: number
  diskGb?: number
}

export interface SnapshotResult {
  snapshotId: string
  createdAt: string
}

export interface SnapshotInfo {
  name: string
  description?: string
  createdAt?: string
  vmstate?: boolean
  parent?: string
}

export interface SyncResult {
  hostsDiscovered: number
  vmsDiscovered: number
}

/**
 * VM provider adapter interface.
 *
 * All `vmId` parameters accept any identifier that resolveVmHost() understands:
 * internal host id, slug, name, IP address, or external VMID (numeric).
 * The adapter resolves the identifier internally via getVmContext().
 */
export type VmProviderType = "proxmox" | "hetzner" | "aws" | "gcp"

export interface VMProviderAdapter {
  readonly type: string
  syncInventory(hypervisor: InfraEstate): Promise<SyncResult>
  createVm(
    hypervisor: InfraEstate,
    spec: VmCreateSpec
  ): Promise<VmProvisionResult>
  cloneVm(
    hypervisor: InfraEstate,
    spec: VmCloneSpec
  ): Promise<VmProvisionResult>
  startVm(hypervisor: InfraEstate, vmId: string): Promise<void>
  stopVm(hypervisor: InfraEstate, vmId: string): Promise<void>
  restartVm(hypervisor: InfraEstate, vmId: string): Promise<void>
  resizeVm(
    hypervisor: InfraEstate,
    vmId: string,
    spec: VmResizeSpec
  ): Promise<void>
  migrateVm(
    hypervisor: InfraEstate,
    vmId: string,
    targetHost: string
  ): Promise<void>
  snapshotVm(
    hypervisor: InfraEstate,
    vmId: string,
    name?: string,
    description?: string
  ): Promise<SnapshotResult>
  listSnapshots(hypervisor: InfraEstate, vmId: string): Promise<SnapshotInfo[]>
  restoreSnapshot(
    hypervisor: InfraEstate,
    vmId: string,
    snapshotName: string
  ): Promise<void>
  deleteSnapshot(
    hypervisor: InfraEstate,
    vmId: string,
    snapshotName: string
  ): Promise<void>
  destroyVm(hypervisor: InfraEstate, vmId: string): Promise<void>
}
