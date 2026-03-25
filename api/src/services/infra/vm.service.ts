import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { vm, provider } from "../../db/schema/infra";
import { getProviderAdapter } from "../../adapters/adapter-registry";
import type { Provider, ProviderType } from "@smp/factory-shared/types";

export async function listVms(
  db: Database,
  filters?: {
    providerId?: string;
    status?: string;
    hostId?: string;
    clusterId?: string;
    datacenterId?: string;
    osType?: string;
  }
) {
  let query = db.select().from(vm);
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

export async function getVm(db: Database, id: string) {
  const rows = await db.select().from(vm).where(eq(vm.vmId, id));
  return rows[0] ?? null;
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
    proxmoxClusterId?: string;
    proxmoxVmid?: number;
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
  const row = await getVm(db, id);
  if (!row) throw new Error(`VM not found: ${id}`);
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
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.startVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "running" })
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}

export async function stopVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.stopVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "stopped" })
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}

export async function restartVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.restartVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "running" })
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}

export async function resizeVm(
  db: Database,
  id: string,
  spec: { cpu?: number; memoryMb?: number; diskGb?: number }
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.resizeVm(prov as unknown as Provider, row.vmId, spec);
  const rows = await db
    .update(vm)
    .set(spec)
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}

export async function migrateVm(
  db: Database,
  id: string,
  targetHostId: string
) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.migrateVm(prov as unknown as Provider, row.vmId, targetHostId);
  const rows = await db
    .update(vm)
    .set({ hostId: targetHostId })
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}

export async function snapshotVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  return adapter.snapshotVm(prov as unknown as Provider, row.vmId);
}

export async function destroyVm(db: Database, id: string) {
  const { vm: row, provider: prov } = await getVmWithProvider(db, id);
  const adapter = getProviderAdapter(prov.providerType as ProviderType, db);
  await adapter.destroyVm(prov as unknown as Provider, row.vmId);
  const rows = await db
    .update(vm)
    .set({ status: "destroying" })
    .where(eq(vm.vmId, id))
    .returning();
  return rows[0];
}
