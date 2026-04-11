/**
 * Cloudflare DNS zone sync — reads zone data from the Cloudflare API
 * and upserts Factory entities: estates (zones), DnsDomains, IpAddresses,
 * and NetworkLinks (dns-resolution / cdn-forward).
 */
import type {
  DnsDomainSpec,
  DnsRecord,
  NetworkLinkSpec,
} from "@smp/factory-shared/schemas/infra"
import { eq, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  dnsDomain,
  estate,
  ipAddress,
  networkLink,
} from "../../db/schema/infra-v2"
import { newId } from "../../lib/id"
import { assignIp, ensureIp } from "./ipam.service"

// ── Cloudflare API types ─────────────────────────────────────

interface CfZone {
  id: string
  name: string
  status: string
}

interface CfDnsRecord {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  priority?: number
  proxied?: boolean
}

interface CfApiResponse<T> {
  success: boolean
  result: T
  errors?: Array<{ message: string }>
}

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

async function cfFetch<T>(
  apiToken: string,
  path: string
): Promise<CfApiResponse<T>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    throw new Error(`Cloudflare API ${path}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<CfApiResponse<T>>
}

/**
 * Sync all zones from a Cloudflare account estate.
 */
export async function syncFromCloudflare(
  db: Database,
  cloudflareEstateId: string
): Promise<SyncResult> {
  const [estateRow] = await db
    .select()
    .from(estate)
    .where(eq(estate.id, cloudflareEstateId))
    .limit(1)

  if (!estateRow) {
    throw new Error(`Estate ${cloudflareEstateId} not found`)
  }

  const spec = estateRow.spec as Record<string, unknown>
  const apiToken = spec.tokenSecret as string | undefined
  if (!apiToken) {
    throw new Error(
      `Estate ${cloudflareEstateId} has no tokenSecret configured`
    )
  }

  const result: SyncResult = {
    zones: { created: 0, updated: 0 },
    domains: { created: 0, updated: 0 },
    ipAddresses: { created: 0 },
    networkLinks: { created: 0 },
    records: { stored: 0 },
    errors: [],
  }

  // Fetch all zones
  let zones: CfZone[]
  try {
    const resp = await cfFetch<CfZone[]>(apiToken, "/zones?per_page=100")
    zones = resp.result
  } catch (err: any) {
    result.errors.push(`Failed to fetch zones: ${err.message}`)
    return result
  }

  for (const zone of zones) {
    try {
      const zoneEstateId = await upsertZoneEstate(
        db,
        cloudflareEstateId,
        zone,
        result
      )
      await syncZoneRecords(db, apiToken, zoneEstateId, zone, result)
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
    .where(eq(estate.id, cloudflareEstateId))

  return result
}

async function upsertZoneEstate(
  db: Database,
  parentEstateId: string,
  zone: CfZone,
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
          externalId: zone.id,
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
      dnsProvider: "cloudflare",
      zone: zone.name,
      externalId: zone.id,
      lastSyncAt: new Date().toISOString(),
    } as any,
  })
  result.zones.created++
  return id
}

async function syncZoneRecords(
  db: Database,
  apiToken: string,
  zoneEstateId: string,
  zone: CfZone,
  result: SyncResult
) {
  const resp = await cfFetch<CfDnsRecord[]>(
    apiToken,
    `/zones/${zone.id}/dns_records?per_page=5000`
  )
  const records = resp.result

  // Group records by FQDN
  const byFqdn = new Map<string, CfDnsRecord[]>()
  for (const rec of records) {
    const fqdn = rec.name
    const group = byFqdn.get(fqdn) ?? []
    group.push(rec)
    byFqdn.set(fqdn, group)
  }

  for (const [fqdn, fqdnRecords] of byFqdn) {
    const domainId = await upsertDnsDomain(
      db,
      zoneEstateId,
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
  zoneEstateId: string,
  fqdn: string,
  records: CfDnsRecord[],
  result: SyncResult
): Promise<string> {
  const domainSlug = slugify(fqdn)
  const isWildcard = fqdn.startsWith("*.")
  const domainType = isWildcard ? "wildcard" : "custom"

  // Collect non-resolution records for spec.records[]
  const nonResolutionRecords: DnsRecord[] = records
    .filter((r) => !RESOLUTION_RECORD_TYPES.has(r.type))
    .map((r) => ({
      type: r.type,
      name: r.name,
      value: r.content,
      ttl: r.ttl === 1 ? undefined : r.ttl,
      priority: r.priority,
      externalId: r.id,
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
      dnsProvider: "cloudflare",
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

  const id = newId("est")
  const spec: DnsDomainSpec = {
    zoneEstateId,
    dnsProvider: "cloudflare",
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

async function createResolutionLink(
  db: Database,
  domainId: string,
  fqdn: string,
  record: CfDnsRecord,
  result: SyncResult
) {
  if (record.type === "A" || record.type === "AAAA") {
    // Create/ensure IP address entity
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
      externalId: record.id,
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
    // CNAME target — check if it's an internal domain
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
      externalId: record.id,
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
