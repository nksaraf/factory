/**
 * DNS resolution service for the trace pipeline.
 *
 * Multiple resolution strategies behind one interface:
 * - Ontology: query the dnsDomain table for exact/wildcard FQDN matches
 * - Live DNS: Node.js dns module for A/AAAA/CNAME records
 * - Future: remote probing via SSH (dig from vantage points)
 *
 * Separate from DnsProvider (api/src/effect/services/dns.ts) which handles
 * provider CRUD (Cloudflare/GoDaddy/Namecheap). DnsResolver is read-only
 * hostname resolution; DnsProvider is zone/record management.
 */

import { Context, Data, Effect } from "effect"
import type { DatabaseError } from "../layers/database"

// ── Types ──────────────────────────────────────────────────

export interface DnsEntity {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly type: string
  readonly fqdn: string
}

export interface DnsRecord {
  readonly type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS"
  readonly value: string
  readonly ttl?: number
}

export type DnsStrategy = "ontology" | "live" | "probe"

export interface DnsResolution {
  readonly hostname: string
  readonly strategy: DnsStrategy
  readonly records: DnsRecord[]
  readonly entityId?: string
  readonly entitySlug?: string
}

// ── Errors ─────────────────────────────────────────────────

export class DnsResolutionError extends Data.TaggedError("DnsResolutionError")<{
  readonly hostname: string
  readonly message: string
}> {}

// ── Service ────────────────────────────────────────────────

export class DnsResolver extends Context.Tag("DnsResolver")<
  DnsResolver,
  {
    /** Find the Factory DNS entity for a hostname (exact or wildcard). DB lookup. */
    readonly findEntity: (
      hostname: string
    ) => Effect.Effect<DnsEntity | null, DatabaseError>

    /** Resolve hostname to IP addresses using live DNS (Node.js dns module). */
    readonly resolve: (
      hostname: string
    ) => Effect.Effect<DnsRecord[], DnsResolutionError>

    /** Ontology first, then live DNS if needed. Combined resolution. */
    readonly resolveWithFallback: (
      hostname: string
    ) => Effect.Effect<DnsResolution, DnsResolutionError>
  }
>() {}
