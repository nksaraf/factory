/**
 * DNS zone sync — reads zone data from a DNS provider via adapter
 * and upserts Factory entities: estates (zones), DnsDomains, IpAddresses,
 * and NetworkLinks (dns-resolution / cdn-forward).
 */
import type {
  DnsDomainSpec,
  DnsRecord,
  NetworkLinkSpec,
} from "@smp/factory-shared/schemas/infra"
import { eq, sql } from "drizzle-orm"

import type {
  DnsProviderAdapter,
  DnsRecordEntry,
} from "../../adapters/dns-provider-adapter"
import type { DnsProviderType } from "../../adapters/dns-provider-adapter"
import { getDnsProviderAdapter } from "../../adapters/adapter-registry"
import type { Database } from "../../db/connection"
import {
  dnsDomain,
  estate,
  ipAddress,
  networkLink,
} from "../../db/schema/infra"
import { newId } from "../../lib/id"
import { PostgresSecretBackend } from "../../lib/secrets/postgres-backend"
import { createSpecRefResolver } from "../../lib/spec-ref-resolver"
import { assignIp, ensureIp } from "./ipam.service"

// ── Types ───────────────────────────────────────────────────

export interface SyncResult {
  zones: { created: number; updated: number }
  domains: { created: number; updated: number }
  ipAddresses: { created: number }
  networkLinks: { created: number }
  records: { stored: number }
  errors: string[]
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function isRfc1918(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return false
}

const RESOLUTION_RECORD_TYPES = new Set(["A", "AAAA", "CNAME"])

// ── Core sync ────────────────────────────────────────────────

/**
 * Resolve credentials from an estate and build a DNS provider adapter.
 */
async function resolveAdapter(
  db: Database,
  estateRow: { spec: unknown }
): Promise<{ adapter: DnsProviderAdapter; providerKind: string }> {
  const spec = estateRow.spec as Record<string, unknown>

  const resolver = createSpecRefResolver(db, new PostgresSecretBackend(db))
  const resolved = await resolver.resolve(spec)

  const apiToken =
    (resolved.credentialsRef as string | undefined) ??
    (resolved.tokenSecret as string | undefined)
  if (!apiToken) {
    throw new Error("No credentialsRef or tokenSecret configured")
  }

  const providerKind = (spec.providerKind ??
    spec.dnsProvider ??
    "cloudflare") as string
  const adapter = getDnsProviderAdapter(providerKind as DnsProviderType, {
    apiToken,
    apiKey: resolved.apiKey as string | undefined,
    apiSecret: resolved.apiSecret as string | undefined,
    apiUser: resolved.apiUser as string | undefined,
    clientIp: resolved.clientIp as string | undefined,
  })

  return { adapter, providerKind }
}

/**
 * Sync all zones from a DNS provider estate.
 */
export async function syncDnsFromEstate(
  db: Database,
  estateId: string
): Promise<SyncResult> {
  const [estateRow] = await db
    .select()
    .from(estate)
    .where(eq(estate.id, estateId))
    .limit(1)

  if (!estateRow) {
    throw new Error(`Estate ${estateId} not found`)
  }

  const { adapter, providerKind } = await resolveAdapter(db, estateRow)

  const result: SyncResult = {
    zones: { created: 0, updated: 0 },
    domains: { created: 0, updated: 0 },
    ipAddresses: { created: 0 },
    networkLinks: { created: 0 },
    records: { stored: 0 },
    errors: [],
  }

  // Fetch all zones via adapter
  let zones: Awaited<ReturnType<DnsProviderAdapter["listZones"]>>
  try {
    zones = await adapter.listZones()
  } catch (err: any) {
    result.errors.push(`Failed to fetch zones: ${err.message}`)
    return result
  }

  for (const zone of zones) {
    try {
      const zoneEstateId = await upsertZoneEstate(
        db,
        estateId,
        providerKind,
        zone,
        result
      )

      // Fetch records via adapter
      const records = await adapter.listRecords(zone.externalId)
      await syncZoneRecords(
        db,
        providerKind,
        zoneEstateId,
        zone.name,
        records,
        result
      )
    } catch (err: any) {
      result.errors.push(`Zone ${zone.name}: ${err.message}`)
    }
  }

  // Update sync state on the parent estate
  await db
    .update(estate)
    .set({
      spec: sql`${estate.spec} || ${JSON.stringify({
        lastSyncAt: new Date().toISOString(),
        syncStatus: result.errors.length > 0 ? "error" : "idle",
        syncError:
          result.errors.length > 0 ? result.errors.join("; ") : undefined,
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(estate.id, estateId))

  return result
}

// ── Zone estate upsert ──────────────────────────────────────

async function upsertZoneEstate(
  db: Database,
  parentEstateId: string,
  providerKind: string,
  zone: { externalId: string; name: string; status: string },
  result: SyncResult
): Promise<string> {
  const zoneSlug = slugify(`${zone.name}-zone`)

  const [existing] = await db
    .select({ id: estate.id })
    .from(estate)
    .where(eq(estate.slug, zoneSlug))
    .limit(1)

  if (existing) {
    await db
      .update(estate)
      .set({
        spec: sql`${estate.spec} || ${JSON.stringify({
          zone: zone.name,
          externalId: zone.externalId,
          lastSyncAt: new Date().toISOString(),
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(estate.id, existing.id))
    result.zones.updated++
    return existing.id
  }

  const id = newId("est")
  await db.insert(estate).values({
    id,
    slug: zoneSlug,
    name: `${zone.name} zone`,
    type: "dns-zone",
    parentEstateId,
    spec: {
      dnsProvider: providerKind,
      zone: zone.name,
      externalId: zone.externalId,
      lastSyncAt: new Date().toISOString(),
    } as any,
  })
  result.zones.created++
  return id
}

// ── Record sync ─────────────────────────────────────────────

async function syncZoneRecords(
  db: Database,
  providerKind: string,
  zoneEstateId: string,
  zoneName: string,
  records: DnsRecordEntry[],
  result: SyncResult
) {
  // Group records by FQDN
  const byFqdn = new Map<string, DnsRecordEntry[]>()
  for (const rec of records) {
    const group = byFqdn.get(rec.name) ?? []
    group.push(rec)
    byFqdn.set(rec.name, group)
  }

  for (const [fqdn, fqdnRecords] of byFqdn) {
    const domainId = await upsertDnsDomain(
      db,
      providerKind,
      zoneEstateId,
      zoneName,
      fqdn,
      fqdnRecords,
      result
    )

    for (const rec of fqdnRecords) {
      if (RESOLUTION_RECORD_TYPES.has(rec.type)) {
        await createResolutionLink(db, domainId, fqdn, rec, result)
      }
    }
  }
}

async function upsertDnsDomain(
  db: Database,
  providerKind: string,
  zoneEstateId: string,
  zoneName: string,
  fqdn: string,
  records: DnsRecordEntry[],
  result: SyncResult
): Promise<string> {
  const domainSlug = slugify(fqdn.replace(/^\*\./, "wildcard-"))
  const isApex = fqdn === zoneName
  const isWildcard = fqdn.startsWith("*.")
  const domainType = isApex ? "primary" : isWildcard ? "wildcard" : "custom"

  // Collect non-resolution records for spec.records[]
  const nonResolutionRecords: DnsRecord[] = records
    .filter((r) => !RESOLUTION_RECORD_TYPES.has(r.type))
    .map((r) => ({
      type: r.type,
      name: r.name,
      value: r.content,
      ttl: r.ttl === 1 ? undefined : r.ttl,
      priority: r.priority,
      externalId: r.externalId,
    }))

  const [existing] = await db
    .select()
    .from(dnsDomain)
    .where(eq(dnsDomain.fqdn, fqdn))
    .limit(1)

  if (existing) {
    const existingSpec = existing.spec as DnsDomainSpec
    const updatedSpec: DnsDomainSpec = {
      ...existingSpec,
      zoneEstateId,
      dnsProvider: providerKind,
      records: nonResolutionRecords,
      lastSyncedAt: new Date(),
      syncError: undefined,
    }

    await db
      .update(dnsDomain)
      .set({ spec: updatedSpec, updatedAt: new Date() })
      .where(eq(dnsDomain.id, existing.id))
    result.domains.updated++
    result.records.stored += nonResolutionRecords.length
    return existing.id
  }

  const id = newId("dom")
  const spec: DnsDomainSpec = {
    zoneEstateId,
    dnsProvider: providerKind,
    verified: true,
    verifiedAt: new Date(),
    status: "verified",
    records: nonResolutionRecords,
    lastSyncedAt: new Date(),
  }

  await db.insert(dnsDomain).values({
    id,
    slug: domainSlug,
    name: fqdn,
    type: domainType,
    fqdn,
    siteId: null,
    spec,
  })
  result.domains.created++
  result.records.stored += nonResolutionRecords.length
  return id
}

// ── Resolution links ────────────────────────────────────────

async function createResolutionLink(
  db: Database,
  domainId: string,
  fqdn: string,
  record: DnsRecordEntry,
  result: SyncResult
) {
  if (record.type === "A" || record.type === "AAAA") {
    const ipRow = await ensureIp(db, {
      address: record.content,
      spec: {
        scope: isRfc1918(record.content) ? "private" : "public",
        version: record.type === "AAAA" ? "v6" : "v4",
      },
    })

    if (!ipRow) return

    const linkSlug = slugify(
      `dns-${fqdn}-${record.type.toLowerCase()}-${record.content}`
    )

    const linkSpec: Partial<NetworkLinkSpec> = {
      recordType: record.type,
      ttl: record.ttl === 1 ? undefined : record.ttl,
      proxied: record.proxied ?? false,
      externalId: record.externalId,
      enabled: true,
      priority: 0,
      middlewares: [],
    }

    const [existingLink] = await db
      .select({ id: networkLink.id })
      .from(networkLink)
      .where(eq(networkLink.slug, linkSlug))
      .limit(1)

    if (existingLink) {
      await db
        .update(networkLink)
        .set({ spec: linkSpec as any, updatedAt: new Date() })
        .where(eq(networkLink.id, existingLink.id))
    } else {
      await db.insert(networkLink).values({
        id: newId("nlnk"),
        slug: linkSlug,
        name: `${fqdn} → ${record.content}`,
        type: "dns-resolution",
        sourceKind: "dns-domain",
        sourceId: domainId,
        targetKind: "ip-address",
        targetId: ipRow.ipAddressId,
        spec: linkSpec as any,
      })
      result.networkLinks.created++
    }
    result.ipAddresses.created++
  } else if (record.type === "CNAME") {
    const [targetDomain] = await db
      .select({ id: dnsDomain.id })
      .from(dnsDomain)
      .where(eq(dnsDomain.fqdn, record.content))
      .limit(1)

    const linkSlug = slugify(`dns-${fqdn}-cname-${record.content}`)

    const linkSpec: Partial<NetworkLinkSpec> = {
      recordType: "CNAME",
      ttl: record.ttl === 1 ? undefined : record.ttl,
      proxied: record.proxied ?? false,
      externalTarget: targetDomain ? undefined : record.content,
      externalId: record.externalId,
      enabled: true,
      priority: 0,
      middlewares: [],
    }

    const [existingLink] = await db
      .select({ id: networkLink.id })
      .from(networkLink)
      .where(eq(networkLink.slug, linkSlug))
      .limit(1)

    if (existingLink) {
      await db
        .update(networkLink)
        .set({ spec: linkSpec as any, updatedAt: new Date() })
        .where(eq(networkLink.id, existingLink.id))
    } else {
      await db.insert(networkLink).values({
        id: newId("nlnk"),
        slug: linkSlug,
        name: `${fqdn} → ${record.content} (CNAME)`,
        type: "dns-resolution",
        sourceKind: "dns-domain",
        sourceId: domainId,
        targetKind: targetDomain ? "dns-domain" : "dns-domain",
        targetId: targetDomain?.id ?? domainId,
        spec: linkSpec as any,
      })
      result.networkLinks.created++
    }
  }
}
