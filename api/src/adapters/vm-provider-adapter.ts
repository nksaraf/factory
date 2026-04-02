import type { Provider } from "@smp/factory-shared/types";

export interface VmCreateSpec {
  name: string;
  templateId: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  hostName?: string;
  vmClusterId?: string;
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
  /** Internal vmId (resolved via resolveVm) */
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
 * All `vmId` parameters accept any identifier that resolveVm() understands:
 * internal vmId, slug, name, IP address, or external VMID (numeric).
 * The adapter resolves the identifier internally via getVmContext().
 */
export interface VMProviderAdapter {
  readonly type: string;
  syncInventory(provider: Provider): Promise<SyncResult>;
  createVm(provider: Provider, spec: VmCreateSpec): Promise<VmProvisionResult>;
  cloneVm(provider: Provider, spec: VmCloneSpec): Promise<VmProvisionResult>;
  startVm(provider: Provider, vmId: string): Promise<void>;
  stopVm(provider: Provider, vmId: string): Promise<void>;
  restartVm(provider: Provider, vmId: string): Promise<void>;
  resizeVm(provider: Provider, vmId: string, spec: VmResizeSpec): Promise<void>;
  migrateVm(provider: Provider, vmId: string, targetHost: string): Promise<void>;
  snapshotVm(provider: Provider, vmId: string, name?: string, description?: string): Promise<SnapshotResult>;
  listSnapshots(provider: Provider, vmId: string): Promise<SnapshotInfo[]>;
  restoreSnapshot(provider: Provider, vmId: string, snapshotName: string): Promise<void>;
  deleteSnapshot(provider: Provider, vmId: string, snapshotName: string): Promise<void>;
  destroyVm(provider: Provider, vmId: string): Promise<void>;
}
