/**
 * DnsResolver layers — ontology (DB) + live DNS resolution.
 *
 * DnsResolverLive: requires Db. findEntity queries dnsDomain table
 * with exact + wildcard FQDN matching. resolve uses Node.js dns module.
 * resolveWithFallback composes ontology-first, live DNS fallback.
 *
 * DnsResolverOntologyOnly: testing/restricted. resolve returns empty.
 */

import { Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import dns from "node:dns/promises"

import { Db, query } from "./database"
import {
  DnsResolver,
  DnsResolutionError,
  type DnsEntity,
  type DnsRecord,
} from "../services/dns-resolver"
import { dnsDomain } from "../../db/schema/infra"
import { domainMatches } from "../../modules/infra/trace"

// ── Pure logic: wildcard FQDN matching ───────────────────────

/**
 * Find the best-matching DNS domain entity for a hostname.
 * Supports exact match and wildcard (*.example.com).
 * Extracted from api/src/modules/infra/index.ts findDnsDomainForHost.
 */
export function findDnsDomainForHost(
  candidates: Array<{
    id: string
    slug: string
    name: string
    type: string
    fqdn: string
  }>,
  hostname: string
): DnsEntity | null {
  return (
    candidates.find(
      (d) =>
        d.fqdn === hostname ||
        (d.fqdn.startsWith("*.") && domainMatches(d.fqdn, hostname))
    ) ?? null
  )
}

// ── DnsResolverLive ──────────────────────────────────────────

export const DnsResolverLive = Layer.effect(
  DnsResolver,
  Effect.gen(function* () {
    const db = yield* Db

    return {
      findEntity: (hostname: string) =>
        Effect.gen(function* () {
          const dotIdx = hostname.indexOf(".")
          const parentSuffix = dotIdx >= 0 ? hostname.slice(dotIdx) : null

          const candidates = yield* query(
            db
              .select({
                id: dnsDomain.id,
                slug: dnsDomain.slug,
                name: dnsDomain.name,
                type: dnsDomain.type,
                fqdn: dnsDomain.fqdn,
              })
              .from(dnsDomain)
              .where(
                parentSuffix
                  ? sql`${dnsDomain.fqdn} = ${hostname} OR ${dnsDomain.fqdn} = ${"*" + parentSuffix}`
                  : eq(dnsDomain.fqdn, hostname)
              )
          )

          return findDnsDomainForHost(candidates, hostname)
        }),

      resolve: (hostname: string) =>
        Effect.tryPromise({
          try: async () => {
            const records: DnsRecord[] = []
            try {
              const a = await dns.resolve4(hostname)
              for (const addr of a) {
                records.push({ type: "A", value: addr })
              }
            } catch {
              /* ENODATA / ENOTFOUND — no A records */
            }
            try {
              const aaaa = await dns.resolve6(hostname)
              for (const addr of aaaa) {
                records.push({ type: "AAAA", value: addr })
              }
            } catch {
              /* no AAAA records */
            }
            try {
              const cnames = await dns.resolveCname(hostname)
              for (const cname of cnames) {
                records.push({ type: "CNAME", value: cname })
              }
            } catch {
              /* no CNAME records */
            }
            return records
          },
          catch: (err) =>
            new DnsResolutionError({
              hostname,
              message: `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
        }),

      resolveWithFallback: (hostname: string) =>
        Effect.gen(function* () {
          // 1. Try ontology (DB lookup)
          const entity = yield* Effect.catchAll(
            Effect.gen(function* () {
              const dotIdx = hostname.indexOf(".")
              const parentSuffix = dotIdx >= 0 ? hostname.slice(dotIdx) : null

              const candidates = yield* query(
                db
                  .select({
                    id: dnsDomain.id,
                    slug: dnsDomain.slug,
                    name: dnsDomain.name,
                    type: dnsDomain.type,
                    fqdn: dnsDomain.fqdn,
                  })
                  .from(dnsDomain)
                  .where(
                    parentSuffix
                      ? sql`${dnsDomain.fqdn} = ${hostname} OR ${dnsDomain.fqdn} = ${"*" + parentSuffix}`
                      : eq(dnsDomain.fqdn, hostname)
                  )
              )

              return findDnsDomainForHost(candidates, hostname)
            }),
            () => Effect.succeed(null)
          )

          if (entity) {
            return {
              hostname,
              strategy: "ontology" as const,
              records: [] as DnsRecord[],
              entityId: entity.id,
              entitySlug: entity.slug,
            }
          }

          // 2. Fall back to live DNS
          const records = yield* Effect.catchAll(
            Effect.tryPromise({
              try: async () => {
                const results: DnsRecord[] = []
                try {
                  const a = await dns.resolve4(hostname)
                  for (const addr of a)
                    results.push({ type: "A" as const, value: addr })
                } catch {}
                try {
                  const aaaa = await dns.resolve6(hostname)
                  for (const addr of aaaa)
                    results.push({ type: "AAAA" as const, value: addr })
                } catch {}
                return results
              },
              catch: () =>
                new DnsResolutionError({
                  hostname,
                  message: `Live DNS resolution failed for ${hostname}`,
                }),
            }),
            () => Effect.succeed([] as DnsRecord[])
          )

          return {
            hostname,
            strategy: (records.length > 0 ? "live" : "ontology") as
              | "live"
              | "ontology",
            records,
          }
        }),
    }
  })
)

// ── DnsResolverOntologyOnly (testing / restricted) ───────────

export function makeDnsResolverOntologyOnly(
  findEntity: (hostname: string) => Effect.Effect<DnsEntity | null, never>
) {
  return Layer.succeed(DnsResolver, {
    findEntity,
    resolve: () => Effect.succeed([] as DnsRecord[]),
    resolveWithFallback: (hostname: string) =>
      Effect.map(findEntity(hostname), (entity) => ({
        hostname,
        strategy: "ontology" as const,
        records: [] as DnsRecord[],
        entityId: entity?.id,
        entitySlug: entity?.slug,
      })),
  })
}
