import type { Provider } from "@smp/factory-shared/types";
import type { Database } from "../db/connection";

export interface VmCreateSpec {
  name: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  templateId?: string;
  hostName?: string;
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

export interface SyncResult {
  hostsDiscovered: number;
  vmsDiscovered: number;
}

export interface ProviderAdapter {
  readonly type: string;
  syncInventory(provider: Provider, db: Database): Promise<SyncResult>;
  createVm(provider: Provider, spec: VmCreateSpec): Promise<VmProvisionResult>;
  startVm(provider: Provider, externalId: string): Promise<void>;
  stopVm(provider: Provider, externalId: string): Promise<void>;
  restartVm(provider: Provider, externalId: string): Promise<void>;
  resizeVm(provider: Provider, externalId: string, spec: VmResizeSpec): Promise<void>;
  migrateVm(provider: Provider, externalId: string, targetHost: string): Promise<void>;
  snapshotVm(provider: Provider, externalId: string): Promise<SnapshotResult>;
  destroyVm(provider: Provider, externalId: string): Promise<void>;
}
