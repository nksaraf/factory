import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import {
  DnsResolver,
  type DnsEntity,
  type DnsRecord,
  DnsResolutionError,
} from "../dns-resolver"
import {
  findDnsDomainForHost,
  makeDnsResolverOntologyOnly,
} from "../../layers/dns-resolver"

// ── Mock DnsResolver layers ──────────────────────────────────

/** Ontology-only resolver backed by a static entity map. */
function mockOntologyResolver(
  entities: Record<string, DnsEntity>
): typeof DnsResolver.Service {
  return {
    findEntity: (hostname) => Effect.succeed(entities[hostname] ?? null),
    resolve: (_hostname) => Effect.succeed([]),
    resolveWithFallback: (hostname) =>
      Effect.gen(function* () {
        const ent = entities[hostname] ?? null
        return {
          hostname,
          strategy: "ontology" as const,
          records: [],
          entityId: ent?.id,
          entitySlug: ent?.slug,
        }
      }),
  }
}

/** Resolver that also returns live DNS records. */
function mockLiveResolver(
  entities: Record<string, DnsEntity>,
  liveRecords: Record<string, DnsRecord[]>
): typeof DnsResolver.Service {
  return {
    findEntity: (hostname) => Effect.succeed(entities[hostname] ?? null),
    resolve: (hostname) => Effect.succeed(liveRecords[hostname] ?? []),
    resolveWithFallback: (hostname) =>
      Effect.gen(function* () {
        const ent = entities[hostname] ?? null
        if (ent) {
          return {
            hostname,
            strategy: "ontology" as const,
            records: [],
            entityId: ent.id,
            entitySlug: ent.slug,
          }
        }
        const records = liveRecords[hostname] ?? []
        return {
          hostname,
          strategy:
            records.length > 0 ? ("live" as const) : ("ontology" as const),
          records,
        }
      }),
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("DnsResolver", () => {
  describe("findEntity", () => {
    it("returns entity for exact hostname match", async () => {
      const entities: Record<string, DnsEntity> = {
        "bugs.rio.software": {
          id: "dns-1",
          slug: "bugs-rio-software",
          name: "bugs.rio.software",
          type: "dns-domain",
          fqdn: "bugs.rio.software",
        },
      }

      const layer = Layer.succeed(DnsResolver, mockOntologyResolver(entities))
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.findEntity("bugs.rio.software")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result).not.toBeNull()
      expect(result!.id).toBe("dns-1")
      expect(result!.fqdn).toBe("bugs.rio.software")
    })

    it("returns null for unknown hostname", async () => {
      const layer = Layer.succeed(DnsResolver, mockOntologyResolver({}))
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.findEntity("nonexistent.example.com")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result).toBeNull()
    })
  })

  describe("resolve (live DNS)", () => {
    it("returns DNS records for a hostname", async () => {
      const liveRecords: Record<string, DnsRecord[]> = {
        "example.com": [
          { type: "A", value: "93.184.216.34" },
          { type: "AAAA", value: "2606:2800:220:1:248:1893:25c8:1946" },
        ],
      }

      const layer = Layer.succeed(
        DnsResolver,
        mockLiveResolver({}, liveRecords)
      )
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.resolve("example.com")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result).toHaveLength(2)
      expect(result[0].type).toBe("A")
      expect(result[0].value).toBe("93.184.216.34")
    })

    it("returns empty for unknown hostname", async () => {
      const layer = Layer.succeed(DnsResolver, mockLiveResolver({}, {}))
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.resolve("nonexistent.test")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result).toHaveLength(0)
    })
  })

  describe("resolveWithFallback", () => {
    it("prefers ontology when entity exists", async () => {
      const entities: Record<string, DnsEntity> = {
        "bugs.rio.software": {
          id: "dns-1",
          slug: "bugs-rio-software",
          name: "bugs.rio.software",
          type: "dns-domain",
          fqdn: "bugs.rio.software",
        },
      }
      const liveRecords: Record<string, DnsRecord[]> = {
        "bugs.rio.software": [{ type: "A", value: "192.168.1.100" }],
      }

      const layer = Layer.succeed(
        DnsResolver,
        mockLiveResolver(entities, liveRecords)
      )
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.resolveWithFallback("bugs.rio.software")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result.strategy).toBe("ontology")
      expect(result.entityId).toBe("dns-1")
      expect(result.entitySlug).toBe("bugs-rio-software")
    })

    it("falls back to live DNS when not in ontology", async () => {
      const liveRecords: Record<string, DnsRecord[]> = {
        "external.example.com": [{ type: "A", value: "1.2.3.4" }],
      }

      const layer = Layer.succeed(
        DnsResolver,
        mockLiveResolver({}, liveRecords)
      )
      const program = Effect.gen(function* () {
        const dns = yield* DnsResolver
        return yield* dns.resolveWithFallback("external.example.com")
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result.strategy).toBe("live")
      expect(result.records).toHaveLength(1)
      expect(result.records[0].value).toBe("1.2.3.4")
      expect(result.entityId).toBeUndefined()
    })
  })
})

// ── findDnsDomainForHost (pure function) ─────────────────────

describe("findDnsDomainForHost", () => {
  const candidates = [
    {
      id: "d1",
      slug: "bugs-rio-software",
      name: "bugs.rio.software",
      type: "dns-domain",
      fqdn: "bugs.rio.software",
    },
    {
      id: "d2",
      slug: "wildcard-rio-software",
      name: "*.rio.software",
      type: "dns-domain",
      fqdn: "*.rio.software",
    },
  ]

  it("matches exact FQDN", () => {
    const result = findDnsDomainForHost(candidates, "bugs.rio.software")
    expect(result).not.toBeNull()
    expect(result!.id).toBe("d1")
  })

  it("matches wildcard FQDN", () => {
    const result = findDnsDomainForHost(candidates, "app.rio.software")
    expect(result).not.toBeNull()
    expect(result!.id).toBe("d2")
  })

  it("prefers exact over wildcard", () => {
    const result = findDnsDomainForHost(candidates, "bugs.rio.software")
    expect(result!.id).toBe("d1")
  })

  it("returns null for non-matching hostname", () => {
    const result = findDnsDomainForHost(candidates, "other.example.com")
    expect(result).toBeNull()
  })

  it("wildcard does not match deeper subdomains", () => {
    const result = findDnsDomainForHost(candidates, "a.b.rio.software")
    expect(result).toBeNull()
  })

  it("returns null for empty candidates", () => {
    const result = findDnsDomainForHost([], "anything.com")
    expect(result).toBeNull()
  })
})

// ── makeDnsResolverOntologyOnly ──────────────────────────────

describe("DnsResolverOntologyOnly", () => {
  it("findEntity returns entity from provided function", async () => {
    const entities: Record<string, DnsEntity> = {
      "test.example.com": {
        id: "t1",
        slug: "test-example-com",
        name: "test.example.com",
        type: "dns-domain",
        fqdn: "test.example.com",
      },
    }

    const layer = makeDnsResolverOntologyOnly((hostname) =>
      Effect.succeed(entities[hostname] ?? null)
    )

    const program = Effect.gen(function* () {
      const dns = yield* DnsResolver
      return yield* dns.findEntity("test.example.com")
    })

    const result = await Effect.runPromise(Effect.provide(program, layer))
    expect(result).not.toBeNull()
    expect(result!.id).toBe("t1")
  })

  it("resolve always returns empty", async () => {
    const layer = makeDnsResolverOntologyOnly(() => Effect.succeed(null))

    const program = Effect.gen(function* () {
      const dns = yield* DnsResolver
      return yield* dns.resolve("anything.com")
    })

    const result = await Effect.runPromise(Effect.provide(program, layer))
    expect(result).toHaveLength(0)
  })

  it("resolveWithFallback returns ontology strategy with entity data", async () => {
    const ent: DnsEntity = {
      id: "t2",
      slug: "foo-bar",
      name: "foo.bar",
      type: "dns-domain",
      fqdn: "foo.bar",
    }
    const layer = makeDnsResolverOntologyOnly((hostname) =>
      Effect.succeed(hostname === "foo.bar" ? ent : null)
    )

    const program = Effect.gen(function* () {
      const dns = yield* DnsResolver
      return yield* dns.resolveWithFallback("foo.bar")
    })

    const result = await Effect.runPromise(Effect.provide(program, layer))
    expect(result.strategy).toBe("ontology")
    expect(result.entityId).toBe("t2")
    expect(result.records).toHaveLength(0)
  })
})
