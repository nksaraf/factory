import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { vm, provider } from "../../db/schema/infra";
import { getVMProviderAdapter } from "../../adapters/adapter-registry";
import { resolveVm } from "../../lib/proxmox/resolve-vm";
import type { Provider, ProviderType } from "@smp/factory-shared/types";

export async function listVms(
  db: Database,
  filters?: {
    slug?: string;
    providerId?: string;
    status?: string;
    hostId?: string;
    clusterId?: string;
    datacenterId?: string;
    osType?: string;
  }
) {
  let query = db.select().from(vm);
  if (filters?.slug) {
    query = query.where(eq(vm.slug, filters.slug)) as typeof query;
  }
  if (filters?.providerId) {
    query = query.where(eq(vm.providerId, filters.providerId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(vm.status, filters.status)) as typeof query;
  }
  if (filters?.hostId) {
    query = query.where(eq(vm.hostId, filters.hostId)) as typeof query;
  }
  if (filters?.clusterId) {
    query = query.where(eq(vm.clusterId, filters.clusterId)) as typeof query;
  }
  if (filters?.datacenterId) {
    query = query.where(eq(vm.datacenterId, filters.datacenterId)) as typeof query;
  }
  if (filters?.osType) {
    query = query.where(eq(vm.osType, filters.osType)) as typeof query;
  }
  return query;
}

/**
 * Get a VM by any identifier: vmId, slug, name, IP, or external VMID.
 */
export async function getVm(db: Database, id: string) {
  try {
    return await resolveVm(db, id);
  } catch {
    return null;
  }
}

export async function createVm(
  db: Database,
  data: {
    name: string;
    slug?: string;
    providerId: string;
    cpu: number;
    memoryMb: number;
    diskGb: number;
    hostId?: string;
    datacenterId?: string;
    clusterId?: string;
    vmClusterId?: string;
    externalVmid?: number;
    vmType?: string;
    osType?: string;
    accessMethod?: string;
    accessUser?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(vm)
        .where(eq(vm.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(vm).values({ ...rest, slug }).returning();
  return rows[0];
}

async function getVmWithProvider(db: Database, id: string) {
  const row = await resolveVm(db, id);
  const providerRows = await db
    .select()
    .from(provider)
    .where(eq(provider.providerId, row.providerId));
  const prov = providerRows[0];
  if (!prov) throw new Error(`Provider not found: ${row.providerId}`);
  return { vm: row, provider: prov };
}

export async function startVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.startVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "running" })
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}

export async function stopVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.stopVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "stopped" })
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}

export async function restartVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.restartVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "running" })
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}

export async function resizeVm(
  db: Database,
  id: string,
  spec: { cpu?: number; memoryMb?: number; diskGb?: number }
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.resizeVm(prov as unknown as Provider, row.vmId, spec);
  const rows = await db
    .update(vm)
    .set(spec)
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}

export async function migrateVm(
  db: Database,
  id: string,
  targetHostId: string
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.migrateVm(prov as unknown as Provider, row.vmId, targetHostId);
  const rows = await db
    .update(vm)
    .set({ hostId: targetHostId })
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}

export async function snapshotVm(
  db: Database,
  id: string,
  name?: string,
  description?: string
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  return adapter.snapshotVm(prov as unknown as Provider, row.vmId, name, description);
}

export async function listSnapshots(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  return adapter.listSnapshots(prov as unknown as Provider, row.vmId);
}

export async function restoreSnapshot(
  db: Database,
  id: string,
  snapshotName: string
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.restoreSnapshot(prov as unknown as Provider, row.vmId, snapshotName);
}

export async function deleteSnapshot(
  db: Database,
  id: string,
  snapshotName: string
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.deleteSnapshot(prov as unknown as Provider, row.vmId, snapshotName);
}

export async function cloneVm(
  db: Database,
  data: {
    sourceVmId: string;
    name: string;
    cpu?: number;
    memoryMb?: number;
    diskGb?: number;
    full?: boolean;
  }
) {
  const { vm: sourceRow, provider: prov } = await getVmWithProvider(db, data.sourceVmId);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);

  const result = await adapter.cloneVm(prov as unknown as Provider, {
    sourceExternalId: sourceRow.vmId,
    name: data.name,
    cpu: data.cpu,
    memoryMb: data.memoryMb,
    diskGb: data.diskGb,
    full: data.full,
  });

  // Insert the cloned VM into DB
  const slug = await allocateSlug({
    baseLabel: data.name,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(vm)
        .where(eq(vm.slug, s))
        .limit(1);
      return r != null;
    },
  });

  const rows = await db
    .insert(vm)
    .values({
      name: data.name,
      slug,
      providerId: sourceRow.providerId,
      datacenterId: sourceRow.datacenterId,
      hostId: sourceRow.hostId,
      clusterId: sourceRow.clusterId,
      vmClusterId: sourceRow.vmClusterId,
      externalVmid: parseInt(result.externalId, 10) || null,
      vmType: sourceRow.vmType,
      cpu: data.cpu || sourceRow.cpu,
      memoryMb: data.memoryMb || sourceRow.memoryMb,
      diskGb: data.diskGb || sourceRow.diskGb,
      status: result.ipAddress ? "running" : "provisioning",
      osType: sourceRow.osType,
      accessMethod: sourceRow.accessMethod,
      accessUser: sourceRow.accessUser,
      ipAddress: result.ipAddress || null,
    })
    .returning();

  return rows[0];
}

export async function destroyVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getVMProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.destroyVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "destroying" })
    .where(eq(vm.vmId, row.vmId))
    .returning();
  return rows[0];
}
