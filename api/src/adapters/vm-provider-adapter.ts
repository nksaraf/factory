import type { substrate } from "../db/schema/infra-v2";

/** A substrate record representing a hypervisor/cloud-account. */
export type InfraSubstrate = typeof substrate.$inferSelect;

export interface VmCreateSpec {
  name: string;
  templateId: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  hostName?: string;
  substrateId?: string;
  cloudInit?: {
    user?: string;
    password?: string;
    sshKeys?: string;
    ipConfig?: string;
    nameserver?: string;
    searchDomain?: string;
  };
}

export interface VmCloneSpec {
  /** Internal host id or slug (resolved via resolveVmHost) */
  sourceVmId: string;
  name: string;
  cpu?: number;
  memoryMb?: number;
  diskGb?: number;
  full?: boolean;
  cloudInit?: VmCreateSpec["cloudInit"];
}

export interface VmProvisionResult {
  externalId: string;
  ipAddress?: string;
}

export interface VmResizeSpec {
  cpu?: number;
  memoryMb?: number;
  diskGb?: number;
}

export interface SnapshotResult {
  snapshotId: string;
  createdAt: string;
}

export interface SnapshotInfo {
  name: string;
  description?: string;
  createdAt?: string;
  vmstate?: boolean;
  parent?: string;
}

export interface SyncResult {
  hostsDiscovered: number;
  vmsDiscovered: number;
}

/**
 * VM provider adapter interface.
 *
 * All `vmId` parameters accept any identifier that resolveVmHost() understands:
 * internal host id, slug, name, IP address, or external VMID (numeric).
 * The adapter resolves the identifier internally via getVmContext().
 */
export type VmProviderType = "proxmox" | "hetzner" | "aws" | "gcp";

export interface VMProviderAdapter {
  readonly type: string;
  syncInventory(hypervisor: InfraSubstrate): Promise<SyncResult>;
  createVm(hypervisor: InfraSubstrate, spec: VmCreateSpec): Promise<VmProvisionResult>;
  cloneVm(hypervisor: InfraSubstrate, spec: VmCloneSpec): Promise<VmProvisionResult>;
  startVm(hypervisor: InfraSubstrate, vmId: string): Promise<void>;
  stopVm(hypervisor: InfraSubstrate, vmId: string): Promise<void>;
  restartVm(hypervisor: InfraSubstrate, vmId: string): Promise<void>;
  resizeVm(hypervisor: InfraSubstrate, vmId: string, spec: VmResizeSpec): Promise<void>;
  migrateVm(hypervisor: InfraSubstrate, vmId: string, targetHost: string): Promise<void>;
  snapshotVm(hypervisor: InfraSubstrate, vmId: string, name?: string, description?: string): Promise<SnapshotResult>;
  listSnapshots(hypervisor: InfraSubstrate, vmId: string): Promise<SnapshotInfo[]>;
  restoreSnapshot(hypervisor: InfraSubstrate, vmId: string, snapshotName: string): Promise<void>;
  deleteSnapshot(hypervisor: InfraSubstrate, vmId: string, snapshotName: string): Promise<void>;
  destroyVm(hypervisor: InfraSubstrate, vmId: string): Promise<void>;
}
