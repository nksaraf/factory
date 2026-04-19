/**
 * DNS zone sync — fully Effect-native.
 *
 * Reads zone data from a DNS provider via the DnsProvider service,
 * resolves credentials via the Secrets service, and upserts Factory
 * entities: estates (zones), DnsDomains, IpAddresses, NetworkLinks.
 *
 * All DB access uses `query()` from context. All errors are typed.
 * The DnsProvider layer is constructed per-estate based on resolved credentials.
 */

import type {
  DnsDomainSpec,
  DnsRecord,
  NetworkLinkSpec,
} from "@smp/factory-shared/schemas/infra"
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"

import type { DnsProviderType } from "../../adapters/dns-provider-adapter"
import type { DnsRecordEntry } from "../../adapters/dns-provider-adapter"
import { getDnsProviderAdapter } from "../../adapters/adapter-registry"
import {
  dnsDomain,
  estate,
  ipAddress,
  networkLink,
} from "../../db/schema/infra"
import { newId } from "../../lib/id"
import { ensureIp } from "../../services/infra/ipam.service"
import {
  Db,
  query,
  queryOrNotFound,
  type DatabaseError,
} from "../layers/database"
import { classifyDatabaseError } from "../layers/database"
import { Secrets, type SecretDecryptionError } from "../services/secrets"
import {
  DnsProvider,
  type DnsApiError,
  type DnsAuthError,
} from "../services/dns"
import { makeDnsProviderLayer } from "../layers/dns"
import type { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type SyncError =
  | DatabaseError
  | EntityNotFoundError
  | SecretDecryptionError
  | DnsApiError
  | DnsAuthError

// ---------------------------------------------------------------------------
// Core sync program
// ---------------------------------------------------------------------------

/**
 * Sync DNS zones from an estate.
 *
 * Resolves credentials from the estate spec via the Secrets service,
 * constructs a DnsProvider layer, fetches zones and records, and
 * upserts all entities.
 *
 * Requires: Db, Secrets
 */
export function syncDnsFromEstate(
  estateId: string
): Effect.Effect<SyncResult, SyncError, Db | Secrets> {
  return Effect.gen(function* () {
    const db = yield* Db
    const secrets = yield* Secrets

    // Verify estate exists
    const estateRow = yield* queryOrNotFound(
      db.select().from(estate).where(eq(estate.id, estateId)).limit(1),
      "estate",
      estateId
    )

    // Resolve credentials from estate spec
    const spec = estateRow.spec as Record<string, unknown>

    // Resolve $secret() refs in the estate spec
    const resolved = { ...spec } as Record<string, unknown>
    for (const [key, value] of Object.entries(spec)) {
      if (typeof value !== "string") continue
      const secretMatch = value.match(/^\$secret\(([^)]+)\)$/)
      if (secretMatch) {
        const secretValue = yield* secrets.get({
          key: secretMatch[1],
          scopeType: "org",
          scopeId: "default",
        })
        resolved[key] = secretValue
      }
    }

    const apiToken =
      (resolved.credentialsRef as string | undefined) ??
      (resolved.tokenSecret as string | undefined)

    if (!apiToken) {
      return yield* classifyDatabaseError(
        new Error("No credentialsRef or tokenSecret configured")
      )
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

    // Construct DnsProvider layer from the resolved adapter
    const dnsLayer = makeDnsProviderLayer(adapter)
    const dns = yield* Effect.provide(DnsProvider, dnsLayer)

    const result: SyncResult = {
      zones: { created: 0, updated: 0 },
      domains: { created: 0, updated: 0 },
      ipAddresses: { created: 0 },
      networkLinks: { created: 0 },
      records: { stored: 0 },
      errors: [],
    }

    // Fetch all zones
    const zones = yield* Effect.catchAll(dns.listZones, (err) =>
      Effect.succeed([]).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            result.errors.push(`Failed to fetch zones: ${err.message}`)
          )
        )
      )
    )

    // Process each zone
    for (const zone of zones) {
      const zoneEffect = Effect.gen(function* () {
        const zoneEstateId = yield* upsertZoneEstate(
          db,
          estateId,
          providerKind,
          zone,
          result
        )

        const records = yield* dns.listRecords(zone.externalId)
        yield* syncZoneRecords(
          db,
          providerKind,
          zoneEstateId,
          zone.name,
          records,
          result
        )
      })

      // Catch per-zone errors and accumulate them rather than aborting
      yield* Effect.catchAll(zoneEffect, (err) =>
        Effect.sync(() =>
          result.errors.push(`Zone ${zone.name}: ${err.message}`)
        )
      )
    }

    // Update sync state on the parent estate
    yield* query(
      db
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
    )

    return result
  })
}

// ---------------------------------------------------------------------------
// Zone estate upsert
// ---------------------------------------------------------------------------

function upsertZoneEstate(
  db: import("../../db/connection").Database,
  parentEstateId: string,
  providerKind: string,
  zone: { externalId: string; name: string; status: string },
  result: SyncResult
): Effect.Effect<string, DatabaseError> {
  return Effect.gen(function* () {
    const zoneSlug = slugify(`${zone.name}-zone`)

    const [existing] = yield* query(
      db
        .select({ id: estate.id })
        .from(estate)
        .where(eq(estate.slug, zoneSlug))
        .limit(1)
    )

    if (existing) {
      yield* query(
        db
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
      )
      result.zones.updated++
      return existing.id
    }

    const id = newId("est")
    yield* query(
      db.insert(estate).values({
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
    )
    result.zones.created++
    return id
  })
}

// ---------------------------------------------------------------------------
// Record sync
// ---------------------------------------------------------------------------

function syncZoneRecords(
  db: import("../../db/connection").Database,
  providerKind: string,
  zoneEstateId: string,
  zoneName: string,
  records: DnsRecordEntry[],
  result: SyncResult
): Effect.Effect<void, DatabaseError> {
  return Effect.gen(function* () {
    const byFqdn = new Map<string, DnsRecordEntry[]>()
    for (const rec of records) {
      const group = byFqdn.get(rec.name) ?? []
      group.push(rec)
      byFqdn.set(rec.name, group)
    }

    for (const [fqdn, fqdnRecords] of byFqdn) {
      const domainId = yield* upsertDnsDomain(
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
          yield* createResolutionLink(db, domainId, fqdn, rec, result)
        }
      }
    }
  })
}

function upsertDnsDomain(
  db: import("../../db/connection").Database,
  providerKind: string,
  zoneEstateId: string,
  zoneName: string,
  fqdn: string,
  records: DnsRecordEntry[],
  result: SyncResult
): Effect.Effect<string, DatabaseError> {
  return Effect.gen(function* () {
    const domainSlug = slugify(fqdn.replace(/^\*\./, "wildcard-"))
    const isApex = fqdn === zoneName
    const isWildcard = fqdn.startsWith("*.")
    const domainType = isApex ? "primary" : isWildcard ? "wildcard" : "custom"

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

    const [existing] = yield* query(
      db.select().from(dnsDomain).where(eq(dnsDomain.fqdn, fqdn)).limit(1)
    )

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

      yield* query(
        db
          .update(dnsDomain)
          .set({ spec: updatedSpec, updatedAt: new Date() })
          .where(eq(dnsDomain.id, existing.id))
      )
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

    yield* query(
      db.insert(dnsDomain).values({
        id,
        slug: domainSlug,
        name: fqdn,
        type: domainType,
        fqdn,
        siteId: null,
        spec,
      })
    )
    result.domains.created++
    result.records.stored += nonResolutionRecords.length
    return id
  })
}

// ---------------------------------------------------------------------------
// Resolution links
// ---------------------------------------------------------------------------

function createResolutionLink(
  db: import("../../db/connection").Database,
  domainId: string,
  fqdn: string,
  record: DnsRecordEntry,
  result: SyncResult
): Effect.Effect<void, DatabaseError> {
  return Effect.gen(function* () {
    if (record.type === "A" || record.type === "AAAA") {
      const ipRow = yield* Effect.tryPromise({
        try: () =>
          ensureIp(db, {
            address: record.content,
            spec: {
              scope: isRfc1918(record.content) ? "private" : "public",
              version: record.type === "AAAA" ? "v6" : "v4",
            },
          }),
        catch: classifyDatabaseError,
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

      const [existingLink] = yield* query(
        db
          .select({ id: networkLink.id })
          .from(networkLink)
          .where(eq(networkLink.slug, linkSlug))
          .limit(1)
      )

      if (existingLink) {
        yield* query(
          db
            .update(networkLink)
            .set({ spec: linkSpec as any, updatedAt: new Date() })
            .where(eq(networkLink.id, existingLink.id))
        )
      } else {
        yield* query(
          db.insert(networkLink).values({
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
        )
        result.networkLinks.created++
      }
      result.ipAddresses.created++
    } else if (record.type === "CNAME") {
      const [targetDomain] = yield* query(
        db
          .select({ id: dnsDomain.id })
          .from(dnsDomain)
          .where(eq(dnsDomain.fqdn, record.content))
          .limit(1)
      )

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

      const [existingLink] = yield* query(
        db
          .select({ id: networkLink.id })
          .from(networkLink)
          .where(eq(networkLink.slug, linkSlug))
          .limit(1)
      )

      if (existingLink) {
        yield* query(
          db
            .update(networkLink)
            .set({ spec: linkSpec as any, updatedAt: new Date() })
            .where(eq(networkLink.id, existingLink.id))
        )
      } else {
        yield* query(
          db.insert(networkLink).values({
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
        )
        result.networkLinks.created++
      }
    }
  })
}
