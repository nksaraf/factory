import { and, eq, count, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { subnet, ipAddress, vm, host, kubeNode } from "../../db/schema/infra";

// --- Subnet operations ---

export async function listSubnets(
  db: Database,
  filters?: { datacenterId?: string; subnetType?: string }
) {
  let query = db.select().from(subnet);
  if (filters?.datacenterId) {
    query = query.where(eq(subnet.datacenterId, filters.datacenterId)) as typeof query;
  }
  if (filters?.subnetType) {
    query = query.where(eq(subnet.subnetType, filters.subnetType)) as typeof query;
  }
  return query;
}

export async function getSubnet(db: Database, id: string) {
  const rows = await db
    .select()
    .from(subnet)
    .where(eq(subnet.subnetId, id));
  return rows[0] ?? null;
}

export async function createSubnet(
  db: Database,
  data: {
    cidr: string;
    gateway?: string;
    netmask?: string;
    vlanId?: number;
    vlanName?: string;
    datacenterId?: string;
    subnetType?: string;
    description?: string;
    dnsServers?: string;
    dnsDomain?: string;
  }
) {
  const rows = await db.insert(subnet).values(data).returning();
  return rows[0];
}

export async function updateSubnet(
  db: Database,
  id: string,
  patch: {
    gateway?: string;
    netmask?: string;
    vlanName?: string;
    description?: string;
    dnsServers?: string;
    dnsDomain?: string;
  }
) {
  const rows = await db
    .update(subnet)
    .set(patch)
    .where(eq(subnet.subnetId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSubnet(db: Database, id: string) {
  const rows = await db
    .delete(subnet)
    .where(eq(subnet.subnetId, id))
    .returning();
  return rows[0] ?? null;
}

// --- IP Address operations ---

export async function listIps(
  db: Database,
  filters?: { subnetId?: string; status?: string; assignedToType?: string }
) {
  const assignedName = sql<string | null>`CASE
    WHEN ${ipAddress.assignedToType} = 'vm'
      THEN (SELECT ${vm.slug} FROM ${vm} WHERE ${vm.vmId} = ${ipAddress.assignedToId})
    WHEN ${ipAddress.assignedToType} = 'host'
      THEN (SELECT ${host.slug} FROM ${host} WHERE ${host.hostId} = ${ipAddress.assignedToId})
    WHEN ${ipAddress.assignedToType} = 'kube_node'
      THEN (SELECT ${kubeNode.name} FROM ${kubeNode} WHERE ${kubeNode.kubeNodeId} = ${ipAddress.assignedToId})
    ELSE NULL
  END`.as("assigned_name");

  let query = db
    .select({
      ipAddressId: ipAddress.ipAddressId,
      address: ipAddress.address,
      subnetId: ipAddress.subnetId,
      assignedToType: ipAddress.assignedToType,
      assignedToId: ipAddress.assignedToId,
      status: ipAddress.status,
      hostname: ipAddress.hostname,
      fqdn: ipAddress.fqdn,
      purpose: ipAddress.purpose,
      createdAt: ipAddress.createdAt,
      assignedName,
    })
    .from(ipAddress);

  if (filters?.subnetId) {
    query = query.where(eq(ipAddress.subnetId, filters.subnetId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(ipAddress.status, filters.status)) as typeof query;
  }
  if (filters?.assignedToType) {
    query = query.where(eq(ipAddress.assignedToType, filters.assignedToType)) as typeof query;
  }
  return query;
}

export async function listAvailableIps(db: Database, subnetId?: string) {
  const conditions = [eq(ipAddress.status, "available")];
  if (subnetId) {
    conditions.push(eq(ipAddress.subnetId, subnetId));
  }
  return db.select().from(ipAddress).where(and(...conditions));
}

export async function lookupIp(db: Database, address: string) {
  const rows = await db
    .select()
    .from(ipAddress)
    .where(eq(ipAddress.address, address));
  return rows[0] ?? null;
}

export async function registerIp(
  db: Database,
  data: { address: string; subnetId?: string }
) {
  const rows = await db
    .insert(ipAddress)
    .values({ ...data, status: "available" })
    .returning();
  return rows[0];
}

export async function assignIp(
  db: Database,
  ipAddressId: string,
  data: {
    assignedToType: string;
    assignedToId: string;
    hostname?: string;
    purpose?: string;
  }
) {
  const rows = await db
    .update(ipAddress)
    .set({ ...data, status: "assigned" })
    .where(eq(ipAddress.ipAddressId, ipAddressId))
    .returning();
  return rows[0] ?? null;
}

export async function releaseIp(db: Database, ipAddressId: string) {
  const rows = await db
    .update(ipAddress)
    .set({
      status: "available",
      assignedToType: null,
      assignedToId: null,
      hostname: null,
      purpose: null,
    })
    .where(eq(ipAddress.ipAddressId, ipAddressId))
    .returning();
  return rows[0] ?? null;
}

export async function getIpamStats(db: Database, subnetId?: string) {
  const baseCondition = subnetId
    ? sql`WHERE ${ipAddress.subnetId} = ${subnetId}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'available')::int AS available,
      COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
      COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved
    FROM factory_infra.ip_address
    ${baseCondition}
  `);

  const { rows } = result as { rows: Array<{ total: number; available: number; assigned: number; reserved: number }> };
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    available: row?.available ?? 0,
    assigned: row?.assigned ?? 0,
    reserved: row?.reserved ?? 0,
  };
}
