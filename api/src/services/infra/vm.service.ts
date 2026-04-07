import { and, eq, type SQL } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { host, substrate } from "../../db/schema/infra-v2";
import { getVMProviderAdapter } from "../../adapters/adapter-registry";
import { resolveVmHost } from "../../lib/proxmox/resolve-vm";
import type { VmProviderType } from "../../adapters/vm-provider-adapter";
import type { HostSpec } from "@smp/factory-shared/schemas/infra";

export async function listVms(
  db: Database,
  filters?: {
    slug?: string;
    substrateId?: string;
  }
) {
  const conditions: SQL[] = [eq(host.type, "vm")];

  if (filters?.slug) {
    conditions.push(eq(host.slug, filters.slug));
  }
  if (filters?.substrateId) {
    conditions.push(eq(host.substrateId, filters.substrateId));
  }

  return db.select().from(host).where(and(...conditions));
}

/**
 * Get a VM by any identifier: host id, slug, name, IP, or external VMID.
 */
export async function getVm(db: Database, id: string) {
  try {
    return await resolveVmHost(db, id);
  } catch {
    return null;
  }
}

export async function createVm(
  db: Database,
  data: {
    name: string;
    slug?: string;
    substrateId: string;
    cpu: number;
    memoryMb: number;
    diskGb: number;
    externalId?: string;
    osType?: string;
    accessMethod?: "ssh" | "winrm" | "rdp";
    accessUser?: string;
    ipAddress?: string;
  }
) {
  const { slug: explicitSlug, substrateId, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(host)
        .where(eq(host.slug, s))
        .limit(1);
      return r != null;
    },
  });

  const spec: HostSpec = {
    hostname: data.name,
    os: (data.osType === "windows" ? "windows" : "linux") as HostSpec["os"],
    arch: "amd64",
    cpu: data.cpu,
    memoryMb: data.memoryMb,
    diskGb: data.diskGb,
    accessMethod: data.accessMethod ?? "ssh",
    accessUser: data.accessUser ?? "root",
    sshPort: 22,
    lifecycle: "active",
    externalId: data.externalId,
    ipAddress: data.ipAddress,
  };

  const rows = await db
    .insert(host)
    .values({
      name: data.name,
      slug,
      type: "vm",
      substrateId,
      spec,
    })
    .returning();
  return rows[0];
}

async function getVmWithHypervisor(db: Database, id: string) {
  const row = await resolveVmHost(db, id);
  if (!row.substrateId) {
    throw new Error(`VM host ${row.id} is not linked to a substrate`);
  }
  const [hypervisor] = await db
    .select()
    .from(substrate)
    .where(eq(substrate.id, row.substrateId))
    .limit(1);
  if (!hypervisor) throw new Error(`Substrate not found: ${row.substrateId}`);

  const providerKind = (hypervisor.spec as Record<string, unknown>)?.providerKind as VmProviderType | undefined;
  if (!providerKind) throw new Error(`Substrate ${hypervisor.id} has no providerKind in spec`);

  return { vm: row, hypervisor, providerKind };
}

export async function startVm(db: Database, id: string) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.startVm(hypervisor, externalId);
  const rows = await db
    .update(host)
    .set({ spec: { ...row.spec, lifecycle: "active" } as HostSpec, updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}

export async function stopVm(db: Database, id: string) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.stopVm(hypervisor, externalId);
  const rows = await db
    .update(host)
    .set({ spec: { ...row.spec, lifecycle: "offline" } as HostSpec, updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}

export async function restartVm(db: Database, id: string) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.restartVm(hypervisor, externalId);
  const rows = await db
    .update(host)
    .set({ spec: { ...row.spec, lifecycle: "active" } as HostSpec, updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}

export async function resizeVm(
  db: Database,
  id: string,
  resizeSpec: { cpu?: number; memoryMb?: number; diskGb?: number }
) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.resizeVm(hypervisor, externalId, resizeSpec);

  const updatedSpec: HostSpec = {
    ...(row.spec as HostSpec),
    ...(resizeSpec.cpu != null ? { cpu: resizeSpec.cpu } : {}),
    ...(resizeSpec.memoryMb != null ? { memoryMb: resizeSpec.memoryMb } : {}),
    ...(resizeSpec.diskGb != null ? { diskGb: resizeSpec.diskGb } : {}),
  };

  const rows = await db
    .update(host)
    .set({ spec: updatedSpec, updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}

export async function migrateVm(
  db: Database,
  id: string,
  targetHostId: string
) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.migrateVm(hypervisor, externalId, targetHostId);
  // Note: substrateId stays the same since the hypervisor doesn't change
  const rows = await db
    .update(host)
    .set({ updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}

export async function snapshotVm(
  db: Database,
  id: string,
  name?: string,
  description?: string
) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  return adapter.snapshotVm(hypervisor, externalId, name, description);
}

export async function listSnapshots(db: Database, id: string) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  return adapter.listSnapshots(hypervisor, externalId);
}

export async function restoreSnapshot(
  db: Database,
  id: string,
  snapshotName: string
) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.restoreSnapshot(hypervisor, externalId, snapshotName);
}

export async function deleteSnapshot(
  db: Database,
  id: string,
  snapshotName: string
) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.deleteSnapshot(hypervisor, externalId, snapshotName);
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
  const { vm: sourceRow, hypervisor, providerKind } = await getVmWithHypervisor(db, data.sourceVmId);
  const adapter = getVMProviderAdapter(providerKind, db);
  const sourceSpec = sourceRow.spec as HostSpec;

  const result = await adapter.cloneVm(hypervisor, {
    sourceVmId: data.sourceVmId,
    name: data.name,
    cpu: data.cpu,
    memoryMb: data.memoryMb,
    diskGb: data.diskGb,
    full: data.full,
  });

  const slug = await allocateSlug({
    baseLabel: data.name,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(host)
        .where(eq(host.slug, s))
        .limit(1);
      return r != null;
    },
  });

  const clonedSpec: HostSpec = {
    hostname: data.name,
    os: sourceSpec.os ?? "linux",
    arch: sourceSpec.arch ?? "amd64",
    cpu: data.cpu ?? sourceSpec.cpu,
    memoryMb: data.memoryMb ?? sourceSpec.memoryMb,
    diskGb: data.diskGb ?? sourceSpec.diskGb,
    accessMethod: sourceSpec.accessMethod ?? "ssh",
    accessUser: sourceSpec.accessUser ?? "root",
    sshPort: sourceSpec.sshPort ?? 22,
    lifecycle: result.ipAddress ? "active" : "maintenance",
    externalId: result.externalId,
    ipAddress: result.ipAddress ?? undefined,
  };

  const rows = await db
    .insert(host)
    .values({
      name: data.name,
      slug,
      type: sourceRow.type,
      substrateId: sourceRow.substrateId,
      spec: clonedSpec,
    })
    .returning();

  return rows[0];
}

export async function destroyVm(db: Database, id: string) {
  const { vm: row, hypervisor, providerKind } = await getVmWithHypervisor(db, id);
  const adapter = getVMProviderAdapter(providerKind, db);
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const externalId = spec.externalId as string;
  await adapter.destroyVm(hypervisor, externalId);
  const rows = await db
    .update(host)
    .set({ spec: { ...row.spec, lifecycle: "offline" } as HostSpec, updatedAt: new Date() })
    .where(eq(host.id, row.id))
    .returning();
  return rows[0];
}
