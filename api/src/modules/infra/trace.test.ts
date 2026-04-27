import { describe, expect, it } from "bun:test"

import {
  type EntityRow,
  type LinkRow,
  type MatchedRoute,
  type PortEntity,
  type RequestContext,
  type RequestGraphReader,
  type TraceNode,
  domainMatches,
  filterByRequest,
  parseRequestInput,
  traceRequest,
} from "./trace"

// ── parseRequestInput ────────────────────────────────────────

describe("parseRequestInput", () => {
  it("parses a full https URL", () => {
    const r = parseRequestInput("https://bugs.rio.software/api/v1")
    expect(r.protocol).toBe("https")
    expect(r.port).toBe(443)
    expect(r.domain).toBe("bugs.rio.software")
    expect(r.path).toBe("/api/v1")
  })

  it("parses https URL with explicit port", () => {
    const r = parseRequestInput("https://example.com:8443/health")
    expect(r.protocol).toBe("https")
    expect(r.port).toBe(8443)
    expect(r.domain).toBe("example.com")
    expect(r.path).toBe("/health")
  })

  it("parses http URL with default port", () => {
    const r = parseRequestInput("http://app.local")
    expect(r.protocol).toBe("http")
    expect(r.port).toBe(80)
    expect(r.domain).toBe("app.local")
    expect(r.path).toBeUndefined()
  })

  it("treats root path as no path", () => {
    const r = parseRequestInput("https://example.com/")
    expect(r.path).toBeUndefined()
  })

  it("parses domain:port", () => {
    const r = parseRequestInput("bugs.rio.software:8080")
    expect(r.protocol).toBe("https")
    expect(r.port).toBe(8080)
    expect(r.domain).toBe("bugs.rio.software")
    expect(r.path).toBeUndefined()
  })

  it("parses domain:80 as http", () => {
    const r = parseRequestInput("app.local:80")
    expect(r.protocol).toBe("http")
    expect(r.port).toBe(80)
  })

  it("parses bare domain — defaults to https:443", () => {
    const r = parseRequestInput("bugs.rio.software")
    expect(r.protocol).toBe("https")
    expect(r.port).toBe(443)
    expect(r.domain).toBe("bugs.rio.software")
  })
})

// ── domainMatches ────────────────────────────────────────────

describe("domainMatches", () => {
  it("matches exact domain", () => {
    expect(domainMatches("bugs.rio.software", "bugs.rio.software")).toBe(true)
  })

  it("rejects non-matching domain", () => {
    expect(domainMatches("app.rio.software", "bugs.rio.software")).toBe(false)
  })

  it("matches wildcard pattern", () => {
    expect(domainMatches("*.rio.software", "bugs.rio.software")).toBe(true)
    expect(domainMatches("*.rio.software", "app.rio.software")).toBe(true)
  })

  it("wildcard does not match deeper subdomains", () => {
    expect(domainMatches("*.rio.software", "a.b.rio.software")).toBe(false)
  })

  it("wildcard does not match bare parent domain", () => {
    expect(domainMatches("*.rio.software", "rio.software")).toBe(false)
  })
})

// ── filterByRequest ──────────────────────────────────────────

function makeLink(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: "link-1",
    slug: "link-1",
    name: "link-1",
    type: "dns",
    sourceKind: "dns-domain",
    sourceId: "src-1",
    targetKind: "ip-address",
    targetId: "tgt-1",
    viaKind: null,
    viaId: null,
    spec: {},
    ...overrides,
  }
}

describe("filterByRequest", () => {
  const baseRequest: RequestContext = {
    protocol: "https",
    port: 443,
    domain: "bugs.rio.software",
  }

  it("returns links with no match constraints (catch-all)", () => {
    const links = [makeLink()]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(1)
  })

  it("filters out links with non-matching ingressPort", () => {
    const links = [makeLink({ spec: { ingressPort: 8080 } })]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(0)
  })

  it("keeps links with matching ingressPort", () => {
    const links = [makeLink({ spec: { ingressPort: 443 } })]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(1)
  })

  it("filters out links with non-matching host", () => {
    const links = [
      makeLink({ spec: { match: { hosts: ["app.rio.software"] } } }),
    ]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(0)
  })

  it("keeps links with exact host match", () => {
    const links = [
      makeLink({ spec: { match: { hosts: ["bugs.rio.software"] } } }),
    ]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(1)
  })

  it("keeps links with wildcard host match", () => {
    const links = [makeLink({ spec: { match: { hosts: ["*.rio.software"] } } })]
    const result = filterByRequest(links, baseRequest)
    expect(result).toHaveLength(1)
  })

  it("sorts exact domain match above wildcard", () => {
    const exact = makeLink({
      id: "exact",
      spec: { match: { hosts: ["bugs.rio.software"] } },
    })
    const wildcard = makeLink({
      id: "wildcard",
      spec: { match: { hosts: ["*.rio.software"] } },
    })
    const result = filterByRequest([wildcard, exact], baseRequest)
    expect(result[0].id).toBe("exact")
    expect(result[1].id).toBe("wildcard")
  })

  it("filters by path prefix", () => {
    const request: RequestContext = { ...baseRequest, path: "/api/v1/users" }
    const matchingLink = makeLink({
      id: "api",
      spec: { match: { pathPrefixes: ["/api"] } },
    })
    const nonMatchingLink = makeLink({
      id: "admin",
      spec: { match: { pathPrefixes: ["/admin"] } },
    })
    const result = filterByRequest([matchingLink, nonMatchingLink], request)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("api")
  })

  it("sorts longer path prefix higher", () => {
    const request: RequestContext = { ...baseRequest, path: "/api/v1/users" }
    const short = makeLink({
      id: "short",
      spec: { match: { pathPrefixes: ["/api"] } },
    })
    const long = makeLink({
      id: "long",
      spec: { match: { pathPrefixes: ["/api/v1"] } },
    })
    const result = filterByRequest([short, long], request)
    expect(result[0].id).toBe("long")
  })

  it("filters by header match", () => {
    const request: RequestContext = {
      ...baseRequest,
      headers: { "x-tenant": "acme" },
    }
    const matching = makeLink({
      id: "m",
      spec: { match: { headers: { "x-tenant": "acme" } } },
    })
    const nonMatching = makeLink({
      id: "n",
      spec: { match: { headers: { "x-tenant": "other" } } },
    })
    const result = filterByRequest([matching, nonMatching], request)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("m")
  })

  it("filters by SNI match", () => {
    const sniLink = makeLink({
      id: "sni",
      spec: { match: { sni: ["bugs.rio.software"] } },
    })
    const result = filterByRequest([sniLink], baseRequest)
    expect(result).toHaveLength(1)
  })

  it("applies priority from spec", () => {
    const low = makeLink({ id: "low", spec: { priority: 0 } })
    const high = makeLink({ id: "high", spec: { priority: 100 } })
    const result = filterByRequest([low, high], baseRequest)
    expect(result[0].id).toBe("high")
  })
})

// ── traceRequest ─────────────────────────────────────────────

function entity(slug: string, type = "generic"): EntityRow {
  return { id: slug, slug, name: slug, type }
}

function link(
  from: { kind: string; id: string },
  to: { kind: string; id: string },
  overrides: Partial<LinkRow> = {}
): LinkRow {
  return {
    id: `${from.id}->${to.id}`,
    slug: `${from.id}->${to.id}`,
    name: `${from.id}->${to.id}`,
    type: "dns",
    sourceKind: from.kind,
    sourceId: from.id,
    targetKind: to.kind,
    targetId: to.id,
    viaKind: null,
    viaId: null,
    spec: {},
    ...overrides,
  }
}

/** Build a mock RequestGraphReader from explicit data. */
function mockReader(opts: {
  entities?: Record<string, EntityRow>
  links?: LinkRow[]
  ports?: Record<string, PortEntity> // key: "hostId:port"
  routes?: Record<string, MatchedRoute[]> // key: realmId
  hostForRealm?: Record<string, EntityRow> // key: realmId
}): RequestGraphReader {
  const {
    entities = {},
    links: allLinks = [],
    ports = {},
    routes = {},
    hostForRealm = {},
  } = opts

  return {
    async findEntity(_kind, id) {
      return entities[id] ?? null
    },
    async findLinks(kind, id, direction) {
      return allLinks.filter((l) =>
        direction === "outbound"
          ? l.sourceKind === kind && l.sourceId === id
          : l.targetKind === kind && l.targetId === id
      )
    },
    async findEntityOnPort(hostId, port) {
      return ports[`${hostId}:${port}`] ?? null
    },
    async findRoutesOnRealm(realmId) {
      const all = routes[realmId] ?? []
      return all.filter((r) => {
        const ts = (r.spec as Record<string, unknown>)?.targetService as
          | string
          | undefined
        return !ts?.includes("@internal")
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

describe("traceRequest", () => {
  it("follows a simple linear chain: dns → ip → host", async () => {
    const reader = mockReader({
      entities: {
        dns1: entity("bugs.rio.software", "dns-domain"),
        ip1: entity("192.168.1.100", "ip-address"),
        host1: entity("lepton-59", "host"),
      },
      links: [
        link(
          { kind: "dns-domain", id: "dns1" },
          { kind: "ip-address", id: "ip1" }
        ),
        link({ kind: "ip-address", id: "ip1" }, { kind: "host", id: "host1" }),
      ],
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "bugs.rio.software",
    }

    const root = await traceRequest(reader, request, "dns-domain", "dns1")

    expect(root.entity.slug).toBe("bugs.rio.software")
    expect(root.children).toHaveLength(1)
    expect(root.children[0].entity.slug).toBe("192.168.1.100")
    expect(root.children[0].children).toHaveLength(1)
    expect(root.children[0].children[0].entity.slug).toBe("lepton-59")
  })

  it("resolves host:port → gateway realm implicitly", async () => {
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
      // Realm has no routes → leaf node
      routes: { realm1: [] },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "bugs.rio.software",
    }

    const root = await traceRequest(reader, request, "host", "host1")

    expect(root.entity.slug).toBe("lepton-59")
    expect(root.children).toHaveLength(1)

    const realmChild = root.children[0]
    expect(realmChild.entity.slug).toBe("traefik")
    expect(realmChild.implicit).toBe(true)
  })

  it("resolves host:port → non-gateway as terminal", async () => {
    const reader = mockReader({
      entities: {
        host1: entity("lepton-59", "host"),
      },
      links: [],
      ports: {
        "host1:3000": {
          entity: entity("my-app", "component"),
          isGateway: false,
        },
      },
    })

    const request: RequestContext = {
      protocol: "http",
      port: 3000,
      domain: "localhost",
    }

    const root = await traceRequest(reader, request, "host", "host1")

    expect(root.children).toHaveLength(1)
    expect(root.children[0].entity.slug).toBe("my-app")
    expect(root.children[0].implicit).toBe(true)
    expect(root.children[0].children).toHaveLength(0)
  })

  it("follows routes at a reverse-proxy realm", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        backend1: entity("bugs-app", "service"),
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
            slug: "bugs-rio-software",
            name: "bugs.rio.software",
            domain: "bugs.rio.software",
            realmId: "realm1",
            spec: { targetPort: 8080 },
            priority: 0,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "bugs.rio.software",
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    expect(root.entity.slug).toBe("traefik")
    expect(root.children).toHaveLength(1)
    // Route node wraps the service
    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("bugs-rio-software")
    expect(routeNode.children).toHaveLength(1)
    expect(routeNode.children[0].entity.slug).toBe("bugs-app")
  })

  it("branches at load-balanced links", async () => {
    const reader = mockReader({
      entities: {
        lb: entity("load-balancer", "service"),
        be1: entity("backend-1", "service"),
        be2: entity("backend-2", "service"),
      },
      links: [
        link(
          { kind: "service", id: "lb" },
          { kind: "service", id: "be1" },
          {
            spec: { loadBalancing: { weight: 70 } },
          }
        ),
        link(
          { kind: "service", id: "lb" },
          { kind: "service", id: "be2" },
          {
            spec: { loadBalancing: { weight: 30 } },
          }
        ),
      ],
    })

    const request: RequestContext = {
      protocol: "http",
      port: 80,
      domain: "app.local",
    }

    const root = await traceRequest(reader, request, "service", "lb")

    expect(root.children).toHaveLength(2)
    expect(root.children[0].weight).toBe(70)
    expect(root.children[1].weight).toBe(30)
    const slugs = root.children.map((c) => c.entity.slug).sort()
    expect(slugs).toEqual(["backend-1", "backend-2"])
  })

  it("detects cycles and stops recursion", async () => {
    // A → B → A (cycle)
    const reader = mockReader({
      entities: {
        a: entity("node-a", "service"),
        b: entity("node-b", "service"),
      },
      links: [
        link({ kind: "service", id: "a" }, { kind: "service", id: "b" }),
        link({ kind: "service", id: "b" }, { kind: "service", id: "a" }),
      ],
    })

    const request: RequestContext = {
      protocol: "http",
      port: 80,
    }

    const root = await traceRequest(reader, request, "service", "a")

    // A → B → (A again, but cycle detected → leaf)
    expect(root.entity.slug).toBe("node-a")
    expect(root.children).toHaveLength(1)
    expect(root.children[0].entity.slug).toBe("node-b")
    // B's child should be A as a leaf (cycle stopped)
    expect(root.children[0].children).toHaveLength(1)
    expect(root.children[0].children[0].entity.slug).toBe("node-a")
    expect(root.children[0].children[0].children).toHaveLength(0)
  })

  it("returns a stub node for unknown entity", async () => {
    const reader = mockReader({ entities: {} })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
    }

    const root = await traceRequest(reader, request, "host", "unknown-id")

    expect(root.entity.id).toBe("unknown-id")
    expect(root.entity.slug).toBe("unknown-id")
    expect(root.children).toHaveLength(0)
  })

  it("updates port from link egressPort", async () => {
    // Verify that when a link has egressPort, the child's context uses it
    const findEntityOnPortCalls: Array<{ hostId: string; port: number }> = []

    const reader: RequestGraphReader = {
      async findEntity(_kind, id) {
        if (id === "ip1") return entity("192.168.1.1", "ip-address")
        if (id === "host1") return entity("lepton", "host")
        return null
      },
      async findLinks(kind, id) {
        if (kind === "ip-address" && id === "ip1") {
          return [
            link(
              { kind: "ip-address", id: "ip1" },
              { kind: "host", id: "host1" },
              { spec: { egressPort: 8443 } }
            ),
          ]
        }
        return []
      },
      async findEntityOnPort(hostId, port) {
        findEntityOnPortCalls.push({ hostId, port })
        return null
      },
      async findRoutesOnRealm() {
        return []
      },
      async findHostForRealm() {
        return null
      },
      async findComponentBySlug() {
        return null
      },
    }

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "test.com",
    }

    await traceRequest(reader, request, "ip-address", "ip1")

    // The host lookup should use port 8443 (from egressPort), not 443
    expect(findEntityOnPortCalls).toHaveLength(1)
    expect(findEntityOnPortCalls[0].port).toBe(8443)
  })

  it("full trace: dns → ip → host → (port) → realm → route → backend", async () => {
    const reader = mockReader({
      entities: {
        dns1: entity("bugs.rio.software", "dns-domain"),
        ip1: entity("192.168.1.100", "ip-address"),
        host1: entity("lepton-59", "host"),
        realm1: entity("traefik", "reverse-proxy"),
        backend1: entity("bugs-container", "component"),
      },
      links: [
        link(
          { kind: "dns-domain", id: "dns1" },
          { kind: "ip-address", id: "ip1" }
        ),
        link({ kind: "ip-address", id: "ip1" }, { kind: "host", id: "host1" }),
        // Route outbound link to backend
        link(
          { kind: "route", id: "route1" },
          { kind: "component", id: "backend1" }
        ),
      ],
      ports: {
        "host1:443": {
          entity: {
            id: "realm1",
            slug: "traefik",
            name: "traefik",
            type: "reverse-proxy",
          },
          isGateway: true,
        },
      },
      routes: {
        realm1: [
          {
            id: "route1",
            slug: "bugs-rio-software",
            name: "bugs.rio.software",
            domain: "bugs.rio.software",
            realmId: "realm1",
            spec: {},
            priority: 0,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "bugs.rio.software",
    }

    const root = await traceRequest(reader, request, "dns-domain", "dns1")

    // dns → ip
    expect(root.entity.slug).toBe("bugs.rio.software")
    expect(root.children).toHaveLength(1)
    const ipNode = root.children[0]
    expect(ipNode.entity.slug).toBe("192.168.1.100")

    // ip → host
    expect(ipNode.children).toHaveLength(1)
    const hostNode = ipNode.children[0]
    expect(hostNode.entity.slug).toBe("lepton-59")

    // host → realm (implicit port resolution)
    expect(hostNode.children).toHaveLength(1)
    const realmNode = hostNode.children[0]
    expect(realmNode.entity.slug).toBe("traefik")
    expect(realmNode.implicit).toBe(true)

    // realm → route → backend
    expect(realmNode.children).toHaveLength(1)
    const routeNode = realmNode.children[0]
    expect(routeNode.entity.slug).toBe("bugs-rio-software")
    expect(routeNode.children).toHaveLength(1)
    const backendNode = routeNode.children[0]
    expect(backendNode.entity.slug).toBe("bugs-container")
  })

  it("falls back to catch-all route when no specific domain matches", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        backend1: entity("default-app", "service"),
      },
      links: [
        link(
          { kind: "route", id: "catchall" },
          { kind: "service", id: "backend1" }
        ),
      ],
      routes: {
        realm1: [
          {
            id: "catchall",
            slug: "catchall",
            name: "catch-all",
            domain: "*",
            realmId: "realm1",
            spec: {},
            priority: -1,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "unknown.example.com",
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    expect(root.children).toHaveLength(1)
    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("catchall")
    expect(routeNode.children).toHaveLength(1)
    expect(routeNode.children[0].entity.slug).toBe("default-app")
  })

  it("prefers specific route over catch-all", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        specific: entity("bugs-app", "service"),
        fallback: entity("default-app", "service"),
      },
      links: [
        link(
          { kind: "route", id: "specific-route" },
          { kind: "service", id: "specific" }
        ),
        link(
          { kind: "route", id: "catchall-route" },
          { kind: "service", id: "fallback" }
        ),
      ],
      routes: {
        realm1: [
          // Routes sorted by priority (specific first, catch-all last)
          {
            id: "specific-route",
            slug: "bugs-rio",
            name: "bugs.rio.software",
            domain: "bugs.rio.software",
            realmId: "realm1",
            spec: {},
            priority: 0,
          },
          {
            id: "catchall-route",
            slug: "catchall",
            name: "catch-all",
            domain: "*",
            realmId: "realm1",
            spec: {},
            priority: -1,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "bugs.rio.software",
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    // Should follow the specific route, not the catch-all
    expect(root.children).toHaveLength(1)
    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("bugs-rio")
    expect(routeNode.children).toHaveLength(1)
    expect(routeNode.children[0].entity.slug).toBe("bugs-app")
  })

  it("skips @internal routes and falls through to next match", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        backend1: entity("real-app", "service"),
      },
      links: [
        link(
          { kind: "route", id: "real-route" },
          { kind: "service", id: "backend1" }
        ),
      ],
      routes: {
        realm1: [
          {
            id: "internal-route",
            slug: "internal-api",
            name: "api@internal",
            domain: "*",
            realmId: "realm1",
            spec: { targetService: "api@internal" },
            priority: 0,
          },
          {
            id: "real-route",
            slug: "real-route",
            name: "real",
            domain: "*",
            realmId: "realm1",
            spec: { targetService: "real-app-service" },
            priority: -1,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "example.com",
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    expect(root.children).toHaveLength(1)
    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("real-route")
    expect(routeNode.children).toHaveLength(1)
    expect(routeNode.children[0].entity.slug).toBe("real-app")
  })

  it("uses targetService fallback when resolvedTargets is empty", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        "my-app": entity("my-app", "component"),
      },
      links: [],
      routes: {
        realm1: [
          {
            id: "route1",
            slug: "app-route",
            name: "app",
            domain: "app.example.com",
            realmId: "realm1",
            spec: { targetService: "my-app-service", targetPort: 3000 },
            priority: 0,
          },
        ],
      },
    })

    const request: RequestContext = {
      protocol: "https",
      port: 443,
      domain: "app.example.com",
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    expect(root.children).toHaveLength(1)
    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("app-route")
    // targetService "my-app-service" → strip "-service" → "my-app" → findComponentBySlug
    expect(routeNode.children).toHaveLength(1)
    expect(routeNode.children[0].entity.slug).toBe("my-app")
    expect(routeNode.children[0].link?.type).toBe("forward")
    expect(routeNode.children[0].link?.spec.egressPort).toBe(3000)
  })

  it("resolvedTargets creates forward links with exact component slug", async () => {
    const reader = mockReader({
      entities: {
        realm1: entity("traefik", "reverse-proxy"),
        "traffic-airflow-airflow-webserver": entity(
          "traffic-airflow-airflow-webserver",
          "service"
        ),
      },
      links: [],
      routes: {
        realm1: [
          {
            id: "route1",
            slug: "airflow-route",
            name: "airflow",
            domain: "*",
            realmId: "realm1",
            spec: { targetService: "airflow-service", targetPort: 8002 },
            priority: -1,
          },
        ],
      },
    })

    // Mock findEntity to return the route with resolvedTargets
    const originalFindEntity = reader.findEntity.bind(reader)
    reader.findEntity = async (kind: string, id: string) => {
      if (kind === "route" && id === "route1") {
        return {
          id: "route1",
          slug: "airflow-route",
          name: "airflow",
          type: "route",
          status: {
            phase: "resolved",
            resolvedTargets: [
              {
                componentSlug: "traffic-airflow-airflow-webserver",
                port: 8002,
                address: "http://host.docker.internal:8002",
              },
            ],
          },
          spec: { targetService: "airflow-service", targetPort: 8002 },
        }
      }
      return originalFindEntity(kind, id)
    }

    const request: RequestContext = {
      protocol: "http",
      port: 80,
    }

    const root = await traceRequest(reader, request, "realm", "realm1")

    const routeNode = root.children[0]
    expect(routeNode.entity.slug).toBe("airflow-route")
    expect(routeNode.children).toHaveLength(1)
    const component = routeNode.children[0]
    expect(component.entity.slug).toBe("traffic-airflow-airflow-webserver")
    expect(component.link?.type).toBe("forward")
    expect(component.link?.spec.egressPort).toBe(8002)
    expect(component.link?.spec.address).toBe(
      "http://host.docker.internal:8002"
    )
  })
})
