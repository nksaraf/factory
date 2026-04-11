import type { IpAddressSpec } from "@smp/factory-shared/schemas/infra"
import { and, eq, inArray, sql } from "drizzle-orm"

import type { NetworkDeviceAdapter } from "../../adapters/network-device-adapter"
import type { Database } from "../../db/connection"
// v2: subnet → infra.estate (type='subnet'), ip fields → spec JSONB
import { estate, ipAddress } from "../../db/schema/infra-v2"

// hostname/purpose/assignedToType/assignedToId are now in IpAddressSpecSchema
type IpAddressSpecStored = IpAddressSpec

function toIpSpec(stored: IpAddressSpecStored): IpAddressSpec {
  return stored
}

function csvEscape(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`
  }
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ── Mapped views (v1-compatible return shapes) ─────────────────────────────

type IpAddressRow = {
  ipAddressId: string
  address: string
  subnetId: string | null
  status: string
  assignedToType: string | null
  assignedToId: string | null
  hostname: string | null
  purpose: string | null
  spec: IpAddressSpecStored
}

function mapIpRow(row: typeof ipAddress.$inferSelect): IpAddressRow {
  const spec = (row.spec ?? {}) as IpAddressSpecStored
  return {
    ipAddressId: row.id,
    address: row.address,
    subnetId: row.subnetId,
    status: spec.status ?? "available",
    assignedToType: spec.assignedToType ?? null,
    assignedToId: spec.assignedToId ?? null,
    hostname: spec.hostname ?? null,
    purpose: spec.purpose ?? null,
    spec,
  }
}

type SubnetRow = {
  subnetId: string
  cidr: string
  gateway?: string | null
  netmask?: string | null
  subnetType?: string | null
  description?: string | null
}

function mapSubnetRow(row: typeof estate.$inferSelect): SubnetRow {
  const spec = (row.spec ?? {}) as Record<string, unknown>
  return {
    subnetId: row.id,
    cidr: (spec.cidr as string) ?? row.slug,
    gateway: (spec.gateway as string) ?? null,
    netmask: (spec.netmask as string) ?? null,
    subnetType: (spec.subnetType as string) ?? null,
    description: (spec.description as string) ?? null,
  }
}

// ── Subnet operations ───────────────────────────────────────────────────────

export async function createSubnet(
  db: Database,
  data: {
    cidr: string
    gateway?: string
    netmask?: string
    vlanId?: number
    vlanName?: string
    datacenterId?: string
    subnetType?: string
    description?: string
    dnsServers?: string
    dnsDomain?: string
  }
) {
  const [row] = await db
    .insert(estate)
    .values({
      slug: data.cidr.replace(/[^a-z0-9-]/g, "-"),
      name: data.cidr,
      type: "subnet",
      spec: {
        cidr: data.cidr,
        gateway: data.gateway,
        netmask: data.netmask,
        vlanId: data.vlanId,
        vlanName: data.vlanName,
        subnetType: data.subnetType ?? "vm",
        description: data.description,
        dnsServers: data.dnsServers,
        dnsDomain: data.dnsDomain,
      } as any,
    })
    .returning()
  return mapSubnetRow(row)
}

// ── IP Address operations ───────────────────────────────────────────────────

export async function listAvailableIps(db: Database, subnetId?: string) {
  const conditions: ReturnType<typeof eq>[] = [
    sql`(${ipAddress.spec}->>'status') = 'available'` as any,
  ]
  if (subnetId) {
    conditions.push(eq(ipAddress.subnetId, subnetId) as any)
  }
  const rows = await db
    .select()
    .from(ipAddress)
    .where(and(...conditions))
  return rows.map(mapIpRow)
}

export async function lookupIp(db: Database, address: string) {
  const rows = await db
    .select()
    .from(ipAddress)
    .where(eq(ipAddress.address, address))
  const row = rows[0]
  return row ? mapIpRow(row) : null
}

export async function registerIp(
  db: Database,
  data: { address: string; subnetId?: string }
) {
  const [row] = await db
    .insert(ipAddress)
    .values({
      address: data.address,
      subnetId: data.subnetId ?? null,
      spec: toIpSpec({ status: "available", version: "v4" }),
    })
    .returning()
  return mapIpRow(row)
}

export async function assignIp(
  db: Database,
  ipAddressId: string,
  data: {
    assignedToType: string
    assignedToId: string
    hostname?: string
    purpose?: string
  }
) {
  const [existing] = await db
    .select()
    .from(ipAddress)
    .where(eq(ipAddress.id, ipAddressId))
  if (!existing) return null

  const existingSpec = (existing.spec ?? {}) as IpAddressSpecStored
  const newSpec: IpAddressSpecStored = {
    ...existingSpec,
    status: "assigned",
    assignedToType: data.assignedToType,
    assignedToId: data.assignedToId,
    hostname: data.hostname ?? existingSpec.hostname ?? undefined,
    purpose: data.purpose ?? existingSpec.purpose ?? undefined,
  }

  const [row] = await db
    .update(ipAddress)
    .set({ spec: toIpSpec(newSpec), updatedAt: new Date() })
    .where(eq(ipAddress.id, ipAddressId))
    .returning()
  return row ? mapIpRow(row) : null
}

export async function releaseIp(db: Database, ipAddressId: string) {
  const [existing] = await db
    .select()
    .from(ipAddress)
    .where(eq(ipAddress.id, ipAddressId))
  if (!existing) return null

  const existingSpec = (existing.spec ?? {}) as IpAddressSpecStored
  const newSpec: IpAddressSpecStored = {
    ...existingSpec,
    status: "available",
    assignedToType: undefined,
    assignedToId: undefined,
    hostname: undefined,
    purpose: undefined,
  }

  const [row] = await db
    .update(ipAddress)
    .set({ spec: toIpSpec(newSpec), updatedAt: new Date() })
    .where(eq(ipAddress.id, ipAddressId))
    .returning()
  return row ? mapIpRow(row) : null
}

export async function getIpamStats(db: Database, subnetId?: string) {
  const conditions = subnetId
    ? and(eq(ipAddress.subnetId, subnetId))
    : undefined

  const [result] = await db
    .select({
      total: sql<number>`count(*)::int`,
      available: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'available')::int`,
      assigned: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'assigned')::int`,
      reserved: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'reserved')::int`,
    })
    .from(ipAddress)
    .where(conditions)

  return {
    total: result?.total ?? 0,
    available: result?.available ?? 0,
    assigned: result?.assigned ?? 0,
    reserved: result?.reserved ?? 0,
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class NoAvailableIpsError extends Error {
  constructor(subnetId: string) {
    super(`No available IPs in subnet ${subnetId}`)
    this.name = "NoAvailableIpsError"
  }
}

// ── Atomic allocation ───────────────────────────────────────────────────────

export async function allocateNextAvailable(
  db: Database,
  data: {
    subnetId: string
    assignedToType: string
    assignedToId: string
    hostname?: string
    purpose?: string
    policy?: "sequential" | "random"
  }
) {
  return db.transaction(async (tx) => {
    const orderClause =
      data.policy === "random"
        ? sql`ORDER BY random()`
        : sql`ORDER BY ${ipAddress.address} ASC`

    const query = sql`
      SELECT id FROM infra.ip_address
      WHERE (spec->>'status') = 'available'
        AND subnet_id = ${data.subnetId}
      ${orderClause}
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `

    const lockResult = await tx.execute(query)
    const { rows } = lockResult as { rows: Array<{ id: string }> }

    if (!rows.length) {
      throw new NoAvailableIpsError(data.subnetId)
    }

    const ipId = rows[0].id
    const [existing] = await tx
      .select()
      .from(ipAddress)
      .where(eq(ipAddress.id, ipId))
    const existingSpec = (existing?.spec ?? {}) as IpAddressSpecStored

    const newSpec: IpAddressSpecStored = {
      ...existingSpec,
      status: "assigned",
      assignedToType: data.assignedToType,
      assignedToId: data.assignedToId,
      hostname: data.hostname ?? undefined,
      purpose: data.purpose ?? undefined,
    }

    const [updated] = await tx
      .update(ipAddress)
      .set({ spec: toIpSpec(newSpec), updatedAt: new Date() })
      .where(eq(ipAddress.id, ipId))
      .returning()

    return mapIpRow(updated)
  })
}

// ── Conflict detection ──────────────────────────────────────────────────────

export type ConflictResult = {
  address: string
  status: "free" | "registered"
  existingRecord?: {
    ipAddressId: string
    status: string | null
    assignedToType: string | null
    assignedToId: string | null
    hostname: string | null
  }
}

export async function checkConflicts(
  db: Database,
  addresses: string[]
): Promise<ConflictResult[]> {
  if (!addresses.length) return []

  const existing = await db
    .select()
    .from(ipAddress)
    .where(inArray(ipAddress.address, addresses))

  const byAddress = new Map(existing.map((r) => [r.address, r]))

  return addresses.map((addr) => {
    const record = byAddress.get(addr)
    if (!record) return { address: addr, status: "free" as const }
    const spec = (record.spec ?? {}) as IpAddressSpecStored
    return {
      address: addr,
      status: "registered" as const,
      existingRecord: {
        ipAddressId: record.id,
        status: spec.status ?? "available",
        assignedToType: spec.assignedToType ?? null,
        assignedToId: spec.assignedToId ?? null,
        hostname: spec.hostname ?? null,
      },
    }
  })
}

export type NetworkConflict = {
  address: string
  type: "ghost" | "stale" | "mismatch"
  detail: string
  foundVia: "arp" | "dhcp" | "db"
  mac?: string
  hostname?: string
}

export async function verifyOnNetwork(
  db: Database,
  adapter: NetworkDeviceAdapter,
  subnetId?: string
): Promise<NetworkConflict[]> {
  const [arpTable, dhcpLeases, dbIpRows] = await Promise.all([
    adapter.getArpTable(),
    adapter.getDhcpLeases(),
    subnetId
      ? db.select().from(ipAddress).where(eq(ipAddress.subnetId, subnetId))
      : db.select().from(ipAddress),
  ])

  const dbIps = dbIpRows.map(mapIpRow)
  const dbByAddress = new Map(dbIps.map((r) => [r.address, r]))
  const conflicts: NetworkConflict[] = []

  // Ghost IPs: on network but not in IPAM DB
  for (const entry of arpTable) {
    if (!dbByAddress.has(entry.ipAddress)) {
      conflicts.push({
        address: entry.ipAddress,
        type: "ghost",
        detail: `Found on network (ARP) but not registered in IPAM`,
        foundVia: "arp",
        mac: entry.macAddress,
        hostname: entry.hostname,
      })
    }
  }

  for (const lease of dhcpLeases) {
    if (lease.status !== "active") continue
    if (
      !dbByAddress.has(lease.ipAddress) &&
      !conflicts.some((c) => c.address === lease.ipAddress)
    ) {
      conflicts.push({
        address: lease.ipAddress,
        type: "ghost",
        detail: `Active DHCP lease but not registered in IPAM`,
        foundVia: "dhcp",
        mac: lease.macAddress,
        hostname: lease.hostname,
      })
    }
  }

  // Stale assignments: in DB as assigned but not seen on network
  const networkAddresses = new Set([
    ...arpTable.map((e) => e.ipAddress),
    ...dhcpLeases.filter((l) => l.status === "active").map((l) => l.ipAddress),
  ])

  for (const dbIp of dbIps) {
    if (dbIp.status === "assigned" && !networkAddresses.has(dbIp.address)) {
      conflicts.push({
        address: dbIp.address,
        type: "stale",
        detail: `Marked assigned in IPAM but not seen on network`,
        foundVia: "db",
      })
    }
  }

  return conflicts
}

// ── Bulk operations ─────────────────────────────────────────────────────────

export type BulkResult = {
  inserted: number
  skipped: number
  errors: string[]
}

export async function bulkRegister(
  db: Database,
  items: Array<{
    address: string
    subnetId?: string
    hostname?: string
    purpose?: string
    status?: string
  }>
): Promise<BulkResult> {
  if (!items.length) return { inserted: 0, skipped: 0, errors: [] }

  const values = items.map((item) => ({
    address: item.address,
    subnetId: item.subnetId ?? null,
    spec: toIpSpec({
      status: (item.status ?? "available") as IpAddressSpec["status"],
      hostname: item.hostname ?? null,
      purpose: item.purpose ?? null,
    } as IpAddressSpecStored),
  }))

  const inserted = await db
    .insert(ipAddress)
    .values(values)
    .onConflictDoNothing({ target: ipAddress.address })
    .returning({ address: ipAddress.address })

  return {
    inserted: inserted.length,
    skipped: items.length - inserted.length,
    errors: [],
  }
}

export type BulkAssignResult = {
  assigned: number
  skipped: number
  errors: string[]
}

export async function bulkAssign(
  db: Database,
  assignments: Array<{
    address: string
    assignedToType: string
    assignedToId: string
    hostname?: string
    purpose?: string
  }>
): Promise<BulkAssignResult> {
  if (!assignments.length) return { assigned: 0, skipped: 0, errors: [] }

  const errors: string[] = []
  let assigned = 0
  let skipped = 0

  await db.transaction(async (tx) => {
    for (const item of assignments) {
      const rows = await tx
        .select()
        .from(ipAddress)
        .where(eq(ipAddress.address, item.address))

      const row = rows[0]
      if (!row) {
        errors.push(`${item.address}: not found`)
        skipped++
        continue
      }

      const spec = (row.spec ?? {}) as IpAddressSpecStored
      const status = spec.status ?? "available"

      if (status !== "available") {
        errors.push(`${item.address}: status is ${status}, expected available`)
        skipped++
        continue
      }

      const newSpec: IpAddressSpecStored = {
        ...spec,
        status: "assigned",
        assignedToType: item.assignedToType,
        assignedToId: item.assignedToId,
        hostname: item.hostname ?? undefined,
        purpose: item.purpose ?? undefined,
      }

      await tx
        .update(ipAddress)
        .set({ spec: toIpSpec(newSpec), updatedAt: new Date() })
        .where(eq(ipAddress.id, row.id))

      assigned++
    }
  })

  return { assigned, skipped, errors }
}

// ── Import from CSV rows ─────────────────────────────────────────────────────

export async function importIps(
  db: Database,
  rows: Array<{
    address: string
    subnet_cidr?: string
    hostname?: string
    purpose?: string
    status?: string
    assigned_to_type?: string
    assigned_to_id?: string
  }>
): Promise<{
  total: number
  registered: number
  assigned: number
  skippedConflicts: number
  errors: string[]
}> {
  // Resolve subnet CIDRs to IDs
  const uniqueCidrs = [
    ...new Set(rows.map((r) => r.subnet_cidr).filter(Boolean)),
  ] as string[]
  const allSubnets = await db
    .select()
    .from(estate)
    .where(eq(estate.type, "subnet"))
  const cidrToId = new Map(
    allSubnets.map((s) => {
      const spec = (s.spec ?? {}) as Record<string, unknown>
      const cidr = (spec.cidr as string) ?? s.slug
      return [cidr, s.id]
    })
  )

  // Check for unknown CIDRs
  const errors: string[] = []
  for (const cidr of uniqueCidrs) {
    if (!cidrToId.has(cidr)) {
      errors.push(`Unknown subnet CIDR: ${cidr}`)
    }
  }

  // Check conflicts
  const conflicts = await checkConflicts(
    db,
    rows.map((r) => r.address)
  )
  const conflictAddresses = new Set(
    conflicts.filter((c) => c.status === "registered").map((c) => c.address)
  )

  // Register non-conflicting IPs
  const toRegister = rows
    .filter((r) => !conflictAddresses.has(r.address))
    .map((r) => ({
      address: r.address,
      subnetId: r.subnet_cidr ? cidrToId.get(r.subnet_cidr) : undefined,
      hostname: r.hostname,
      purpose: r.purpose,
      status: r.assigned_to_type ? "available" : (r.status ?? "available"),
    }))

  const registerResult = await bulkRegister(db, toRegister)

  // Assign IPs that have assignment data
  const toAssign = rows
    .filter(
      (r) =>
        r.assigned_to_type &&
        r.assigned_to_id &&
        !conflictAddresses.has(r.address)
    )
    .map((r) => ({
      address: r.address,
      assignedToType: r.assigned_to_type!,
      assignedToId: r.assigned_to_id!,
      hostname: r.hostname,
      purpose: r.purpose,
    }))

  const assignResult = await bulkAssign(db, toAssign)

  return {
    total: rows.length,
    registered: registerResult.inserted,
    assigned: assignResult.assigned,
    skippedConflicts: conflictAddresses.size,
    errors: [...errors, ...registerResult.errors, ...assignResult.errors],
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportIps(
  db: Database,
  filters?: { subnetId?: string; format?: "json" | "csv" }
): Promise<{ data: any[]; csv?: string }> {
  const allSubnets = await db
    .select()
    .from(estate)
    .where(eq(estate.type, "subnet"))
  const idToCidr = new Map(
    allSubnets.map((s) => {
      const spec = (s.spec ?? {}) as Record<string, unknown>
      const cidr = (spec.cidr as string) ?? s.slug
      return [s.id, cidr]
    })
  )

  const conditions = filters?.subnetId
    ? eq(ipAddress.subnetId, filters.subnetId)
    : undefined
  const ips = await db.select().from(ipAddress).where(conditions)
  const mapped = ips.map(mapIpRow)

  const data = mapped.map((ip) => ({
    address: ip.address,
    subnet_cidr: ip.subnetId ? (idToCidr.get(ip.subnetId) ?? "") : "",
    hostname: ip.hostname ?? "",
    purpose: ip.purpose ?? "",
    status: ip.status ?? "available",
    assigned_to_type: ip.assignedToType ?? "",
    assigned_to_id: ip.assignedToId ?? "",
  }))

  if (filters?.format === "csv") {
    const header =
      "address,subnet_cidr,hostname,purpose,status,assigned_to_type,assigned_to_id"
    const lines = data.map((r) =>
      [
        r.address,
        r.subnet_cidr,
        r.hostname,
        r.purpose,
        r.status,
        r.assigned_to_type,
        r.assigned_to_id,
      ]
        .map(csvEscape)
        .join(",")
    )
    return { data, csv: [header, ...lines].join("\n") }
  }

  return { data }
}

// ── Import from network device ────────────────────────────────────────────────

export async function importFromDevice(
  db: Database,
  adapter: NetworkDeviceAdapter,
  opts?: { subnetId?: string; dryRun?: boolean }
): Promise<{
  preview: Array<{
    address: string
    mac: string
    hostname?: string
    conflict: boolean
  }>
  result?: BulkResult
}> {
  const [arpTable, dhcpLeases] = await Promise.all([
    adapter.getArpTable(),
    adapter.getDhcpLeases(),
  ])

  // Merge ARP + DHCP into a deduplicated list
  const seen = new Map<string, { mac: string; hostname?: string }>()
  for (const entry of arpTable) {
    seen.set(entry.ipAddress, {
      mac: entry.macAddress,
      hostname: entry.hostname,
    })
  }
  for (const lease of dhcpLeases) {
    if (lease.status === "active" && !seen.has(lease.ipAddress)) {
      seen.set(lease.ipAddress, {
        mac: lease.macAddress,
        hostname: lease.hostname,
      })
    }
  }

  const addresses = [...seen.keys()]
  const conflicts = await checkConflicts(db, addresses)
  const conflictSet = new Set(
    conflicts.filter((c) => c.status === "registered").map((c) => c.address)
  )

  const preview = addresses.map((addr) => ({
    address: addr,
    mac: seen.get(addr)!.mac,
    hostname: seen.get(addr)!.hostname,
    conflict: conflictSet.has(addr),
  }))

  if (opts?.dryRun) {
    return { preview }
  }

  const toRegister = preview
    .filter((p) => !p.conflict)
    .map((p) => ({
      address: p.address,
      subnetId: opts?.subnetId,
      hostname: p.hostname,
      status: "available" as const,
    }))

  const result = await bulkRegister(db, toRegister)
  return { preview, result }
}

// ── Subnet hierarchy ──────────────────────────────────────────────────────────

export async function getSubnetTree(db: Database, subnetId?: string) {
  const conditions = subnetId
    ? and(eq(estate.type, "subnet"), eq(estate.id, subnetId))
    : eq(estate.type, "subnet")

  const subnets = await db.select().from(estate).where(conditions)
  const mapped = subnets.map(mapSubnetRow)

  const stats = await Promise.all(
    mapped.map(async (s) => {
      const ipStats = await getIpamStats(db, s.subnetId)
      return { ...s, ipStats }
    })
  )

  return stats
}
