import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import type {
  EntityRow,
  LinkRow,
  MatchedRoute,
  PortEntity,
  RequestContext,
  RequestGraphReader,
} from "../../../modules/infra/trace"
import { Trace, makeTrace } from "../trace"
import { DnsResolver, type DnsEntity } from "../dns-resolver"

// ── Mock helpers (same pattern as trace.test.ts) ─────────────

function entity(slug: string, type: string): EntityRow {
  return { id: slug, slug, name: slug, type }
}

function link(
  from: { kind: string; id: string },
  to: { kind: string; id: string },
  overrides: Partial<LinkRow> = {}
): LinkRow {
  return {
    id: `${from.id}-${to.id}`,
    slug: `${from.id}-to-${to.id}`,
    name: `${from.id} → ${to.id}`,
    type: "network-link",
    sourceKind: from.kind,
    sourceId: from.id,
    targetKind: to.kind,
    targetId: to.id,
    spec: {},
    ...overrides,
  }
}

interface MockReaderOpts {
  entities: Record<string, EntityRow>
  links?: LinkRow[]
  ports?: Record<string, PortEntity>
  routes?: Record<string, MatchedRoute[]>
  hostForRealm?: Record<string, EntityRow>
}

function mockReader(opts: MockReaderOpts): RequestGraphReader {
  const {
    entities,
    links = [],
    ports = {},
    routes = {},
    hostForRealm = {},
  } = opts
  return {
    async findLinks(kind, id, direction) {
      return links.filter((l) =>
        direction === "outbound"
          ? l.sourceKind === kind && l.sourceId === id
          : l.targetKind === kind && l.targetId === id
      )
    },
    async findEntity(kind, id) {
      return entities[id] ?? null
    },
    async findEntityOnPort(hostId, port) {
      return ports[`${hostId}:${port}`] ?? null
    },
    async findRoutesOnRealm(realmId, request) {
      const allRoutes = routes[realmId] ?? []
      return allRoutes.filter((r) => {
        if (!request.domain) return true
        if (r.domain === "*") return true
        return r.domain === request.domain
      })
    },
    async findHostForRealm(realmId) {
      return hostForRealm[realmId] ?? null
    },
    async findComponentBySlug(slug) {
      return entities[slug] ?? null
    },
  }
}

/** Build a DnsResolver mock layer from the reader's dns-domain entities. */
function mockDnsLayer(
  dnsEntities: Record<string, DnsEntity>
): Layer.Layer<DnsResolver> {
  return Layer.succeed(DnsResolver, {
    findEntity: (hostname: string) =>
      Effect.succeed(dnsEntities[hostname] ?? null),
    resolve: () => Effect.succeed([]),
    resolveWithFallback: (hostname: string) =>
      Effect.succeed({
        hostname,
        strategy: "ontology" as const,
        records: [],
        entityId: dnsEntities[hostname]?.id,
        entitySlug: dnsEntities[hostname]?.slug,
      }),
  })
}

/** Build a Trace layer with mock reader + mock DnsResolver. */
function makeTestLayer(
  reader: RequestGraphReader,
  dnsEntities: Record<string, DnsEntity> = {}
): Layer.Layer<Trace> {
  const dnsLayer = mockDnsLayer(dnsEntities)
  const traceLayer = Layer.effect(
    Trace,
    Effect.gen(function* () {
      const dns = yield* DnsResolver
      return makeTrace(reader, dns)
    })
  )
  return Layer.provide(traceLayer, dnsLayer)
}

// ── Tests ────────────────────────────────────────────────────

describe("Trace", () => {
  describe("trace without explicit start (DNS auto-resolve)", () => {
    it("resolves domain → dns entity → traces through graph", async () => {
      const reader = mockReader({
        entities: {
          "bugs.rio.software": entity("bugs.rio.software", "dns-domain"),
          ip1: entity("192.168.1.100", "ip-address"),
          host1: entity("lepton-59", "host"),
        },
        links: [
          link(
            { kind: "dns-domain", id: "bugs.rio.software" },
            { kind: "ip-address", id: "ip1" }
          ),
          link(
            { kind: "ip-address", id: "ip1" },
            { kind: "host", id: "host1" }
          ),
        ],
      })

      const dnsEntities: Record<string, DnsEntity> = {
        "bugs.rio.software": {
          id: "bugs.rio.software",
          slug: "bugs-rio-software",
          name: "bugs.rio.software",
          type: "dns-domain",
          fqdn: "bugs.rio.software",
        },
      }

      const layer = makeTestLayer(reader, dnsEntities)
      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace({
          protocol: "https",
          port: 443,
          domain: "bugs.rio.software",
          path: "/api/v1",
        })
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result.request.domain).toBe("bugs.rio.software")
      expect(result.root.entity.slug).toBe("bugs.rio.software")
      expect(result.root.children).toHaveLength(1)
    })

    it("fails when domain has no DNS entity", async () => {
      const reader = mockReader({ entities: {} })
      const layer = makeTestLayer(reader)

      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace({
          protocol: "https",
          port: 443,
          domain: "nonexistent.example.com",
        })
      })

      const exit = await Effect.runPromiseExit(Effect.provide(program, layer))
      expect(exit._tag).toBe("Failure")
    })

    it("fails when request has no domain and no start", async () => {
      const reader = mockReader({ entities: {} })
      const layer = makeTestLayer(reader)

      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace({ protocol: "tcp", port: 5432 })
      })

      const exit = await Effect.runPromiseExit(Effect.provide(program, layer))
      expect(exit._tag).toBe("Failure")
    })
  })

  describe("trace with explicit start", () => {
    it("skips DNS resolution when start is provided", async () => {
      const reader = mockReader({
        entities: {
          host1: entity("lepton-59", "host"),
          realm1: entity("traefik", "reverse-proxy"),
        },
        links: [],
        ports: {
          "host1:443": {
            entity: entity("traefik", "reverse-proxy"),
            isGateway: true,
          },
        },
        routes: { realm1: [] },
      })

      const layer = makeTestLayer(reader)
      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace(
          { protocol: "https", port: 443, domain: "example.com" },
          { kind: "host", id: "host1" }
        )
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result.root.entity.slug).toBe("lepton-59")
      expect(result.root.children).toHaveLength(1)
      expect(result.root.children[0].entity.slug).toBe("traefik")
      expect(result.root.children[0].implicit).toBe(true)
    })

    it("follows routes at a reverse-proxy realm", async () => {
      const reader = mockReader({
        entities: {
          realm1: entity("traefik", "reverse-proxy"),
          backend1: entity("my-app", "service"),
        },
        links: [
          link(
            { kind: "route", id: "route1" },
            { kind: "service", id: "backend1" }
          ),
        ],
        routes: {
          realm1: [
            {
              id: "route1",
              slug: "my-app-route",
              name: "my-app.example.com",
              domain: "my-app.example.com",
              realmId: "realm1",
              spec: { targetPort: 8080 },
              priority: 0,
            },
          ],
        },
      })

      const layer = makeTestLayer(reader)
      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace(
          { protocol: "https", port: 443, domain: "my-app.example.com" },
          { kind: "realm", id: "realm1" }
        )
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      expect(result.root.entity.slug).toBe("traefik")
      const routeNode = result.root.children[0]
      expect(routeNode.entity.slug).toBe("my-app-route")
      expect(routeNode.children).toHaveLength(1)
      expect(routeNode.children[0].entity.slug).toBe("my-app")
    })

    it("uses resolvedTargets when no explicit links", async () => {
      const reader = mockReader({
        entities: {
          realm1: entity("traefik", "reverse-proxy"),
          "airflow-webserver": entity("airflow-webserver", "component"),
        },
        links: [],
        routes: {
          realm1: [
            {
              id: "route-airflow",
              slug: "airflow-route",
              name: "airflow.example.com",
              domain: "airflow.example.com",
              realmId: "realm1",
              spec: { targetPort: 8080 },
              priority: 0,
            },
          ],
        },
      })

      const origFindEntity = reader.findEntity.bind(reader)
      reader.findEntity = async (kind, id) => {
        if (kind === "route" && id === "route-airflow") {
          return {
            id: "route-airflow",
            slug: "airflow-route",
            name: "airflow.example.com",
            type: "route",
            status: {
              resolvedTargets: [
                {
                  componentSlug: "airflow-webserver",
                  port: 8080,
                  address: "172.20.0.5",
                },
              ],
            },
          }
        }
        return origFindEntity(kind, id)
      }

      const layer = makeTestLayer(reader)
      const program = Effect.gen(function* () {
        const trace = yield* Trace
        return yield* trace.trace(
          { protocol: "https", port: 443, domain: "airflow.example.com" },
          { kind: "realm", id: "realm1" }
        )
      })

      const result = await Effect.runPromise(Effect.provide(program, layer))
      const routeNode = result.root.children[0]
      expect(routeNode.children).toHaveLength(1)
      expect(routeNode.children[0].entity.slug).toBe("airflow-webserver")
    })
  })
})
