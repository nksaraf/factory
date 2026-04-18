import { describe, expect, it } from "bun:test"

import type { CatalogSystem } from "./catalog"
import { DependencyGraph, qualifyNode, unqualifyNode } from "./dependency-graph"

// ── Test fixtures ─────────────────────────────────────────────────

/**
 * Mirrors the actual docker-compose dependency topology:
 *
 *   infra-factory ──→ infra-postgres
 *       │              ↑  ↑  ↑  ↑
 *       └──→ infra-auth─┘  │  │  │
 *            infra-spicedb──┘  │  │
 *            infra-powersync───┘  │  (also → infra-powersync-mongo)
 *            infra-metabase───────┘
 *
 *   infra-otel-collector ──→ infra-loki
 *   infra-api-docs ──→ infra-gateway, infra-reverse-proxy
 */
function buildTestCatalog(): CatalogSystem {
  const stub = {
    metadata: { name: "", namespace: "default" },
  }
  const compSpec = (dependsOn?: string[]) => ({
    ...stub,
    kind: "Component" as const,
    spec: {
      type: "service",
      image: "test",
      ports: [],
      environment: {},
      dependsOn,
    },
  })
  const resSpec = (dependsOn?: string[]) => ({
    ...stub,
    kind: "Resource" as const,
    spec: {
      type: "database",
      image: "test",
      ports: [],
      environment: {},
      dependsOn,
    },
  })

  return {
    kind: "System",
    metadata: { name: "test", namespace: "default" },
    spec: { owner: "test" },
    components: {
      "infra-factory": compSpec(["infra-postgres", "infra-auth"]),
      "infra-api-docs": compSpec(["infra-gateway", "infra-reverse-proxy"]),
    },
    resources: {
      "infra-postgres": resSpec(),
      "infra-auth": resSpec(["infra-postgres"]),
      "infra-spicedb": resSpec(["infra-postgres"]),
      "infra-powersync": resSpec(["infra-postgres", "infra-powersync-mongo"]),
      "infra-metabase": resSpec(["infra-postgres"]),
      "infra-redis": resSpec(),
      "infra-loki": resSpec(),
      "infra-otel-collector": resSpec(["infra-loki"]),
      "infra-powersync-mongo": resSpec(),
      "infra-gateway": resSpec(),
      "infra-reverse-proxy": resSpec(),
    },
    connections: [],
  } as unknown as CatalogSystem
}

// ── Tests ─────────────────────────────────────────────────────────

describe("DependencyGraph", () => {
  describe("fromCatalog", () => {
    it("builds a graph from all components and resources", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.allServices()).toHaveLength(13)
      expect(graph.has("infra-factory")).toBe(true)
      expect(graph.has("infra-postgres")).toBe(true)
      expect(graph.has("nonexistent")).toBe(false)
    })
  })

  describe("fromEdges", () => {
    it("builds a graph from explicit edge pairs", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
      ])
      expect(graph.allServices()).toEqual(["a", "b", "c"])
      expect(graph.directDeps("a")).toEqual(["b"])
      expect(graph.directDeps("b")).toEqual(["c"])
      expect(graph.directDeps("c")).toEqual([])
    })
  })

  describe("directDeps", () => {
    it("returns direct dependencies", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.directDeps("infra-factory").sort()).toEqual([
        "infra-auth",
        "infra-postgres",
      ])
      expect(graph.directDeps("infra-auth")).toEqual(["infra-postgres"])
      expect(graph.directDeps("infra-postgres")).toEqual([])
    })

    it("returns empty for unknown services", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.directDeps("nonexistent")).toEqual([])
    })
  })

  describe("directDependents", () => {
    it("returns services that directly depend on the given service", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const pgDependents = graph.directDependents("infra-postgres").sort()
      expect(pgDependents).toEqual([
        "infra-auth",
        "infra-factory",
        "infra-metabase",
        "infra-powersync",
        "infra-spicedb",
      ])
    })

    it("returns empty for leaves with no dependents", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      // infra-factory is a root — nothing depends on it
      expect(graph.directDependents("infra-factory")).toEqual([])
    })
  })

  describe("transitiveDeps", () => {
    it("returns all recursive dependencies", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      // infra-factory → infra-postgres, infra-auth
      // infra-auth → infra-postgres (already included)
      expect(graph.transitiveDeps("infra-factory").sort()).toEqual([
        "infra-auth",
        "infra-postgres",
      ])
    })

    it("returns empty for services with no deps", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.transitiveDeps("infra-postgres")).toEqual([])
    })

    it("handles multi-level chains", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ])
      expect(graph.transitiveDeps("a").sort()).toEqual(["b", "c", "d"])
    })

    it("handles diamond dependencies", () => {
      // a → b, a → c, b → d, c → d
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ])
      expect(graph.transitiveDeps("a").sort()).toEqual(["b", "c", "d"])
    })
  })

  describe("transitiveDependents", () => {
    it("returns all services that transitively depend on postgres", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const dependents = graph.transitiveDependents("infra-postgres").sort()
      expect(dependents).toEqual([
        "infra-auth",
        "infra-factory",
        "infra-metabase",
        "infra-powersync",
        "infra-spicedb",
      ])
    })

    it("includes transitive dependents through auth", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      // infra-auth is depended on by infra-factory
      const dependents = graph.transitiveDependents("infra-auth").sort()
      expect(dependents).toEqual(["infra-factory"])
    })
  })

  describe("topologicalSort", () => {
    it("produces a valid startup order (deps before dependents)", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const order = graph.topologicalSort()

      // postgres must come before auth, auth before factory
      const pgIdx = order.indexOf("infra-postgres")
      const authIdx = order.indexOf("infra-auth")
      const factoryIdx = order.indexOf("infra-factory")

      expect(pgIdx).toBeLessThan(authIdx)
      expect(authIdx).toBeLessThan(factoryIdx)

      // postgres must come before spicedb
      const spiceIdx = order.indexOf("infra-spicedb")
      expect(pgIdx).toBeLessThan(spiceIdx)

      // loki must come before otel-collector
      const lokiIdx = order.indexOf("infra-loki")
      const otelIdx = order.indexOf("infra-otel-collector")
      expect(lokiIdx).toBeLessThan(otelIdx)
    })

    it("includes all services", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.topologicalSort()).toHaveLength(13)
    })

    it("throws on cycles", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ])
      expect(() => graph.topologicalSort()).toThrow(/cycle/)
    })
  })

  describe("startupOrder", () => {
    it("returns subset + deps in correct order", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const order = graph.startupOrder(["infra-factory"])

      // Should include factory + its transitive deps (auth, postgres)
      expect(order).toHaveLength(3)
      expect(new Set(order)).toEqual(
        new Set(["infra-postgres", "infra-auth", "infra-factory"])
      )

      // Correct order
      expect(order.indexOf("infra-postgres")).toBeLessThan(
        order.indexOf("infra-auth")
      )
      expect(order.indexOf("infra-auth")).toBeLessThan(
        order.indexOf("infra-factory")
      )
    })

    it("merges deps for multiple targets", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const order = graph.startupOrder([
        "infra-factory",
        "infra-otel-collector",
      ])

      // Should include both chains
      expect(order).toContain("infra-postgres")
      expect(order).toContain("infra-auth")
      expect(order).toContain("infra-factory")
      expect(order).toContain("infra-loki")
      expect(order).toContain("infra-otel-collector")
    })
  })

  describe("hasCycle", () => {
    it("returns false for acyclic graphs", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      expect(graph.hasCycle()).toBe(false)
    })

    it("returns true for cyclic graphs", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "a"],
      ])
      expect(graph.hasCycle()).toBe(true)
    })

    it("detects indirect cycles", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ])
      expect(graph.hasCycle()).toBe(true)
    })
  })

  describe("leaves", () => {
    it("returns services with no dependencies", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const leaves = graph.leaves()
      expect(leaves).toContain("infra-postgres")
      expect(leaves).toContain("infra-redis")
      expect(leaves).toContain("infra-loki")
      expect(leaves).toContain("infra-powersync-mongo")
      expect(leaves).toContain("infra-gateway")
      expect(leaves).toContain("infra-reverse-proxy")
      // auth has deps, should NOT be a leaf
      expect(leaves).not.toContain("infra-auth")
      expect(leaves).not.toContain("infra-factory")
    })
  })

  describe("roots", () => {
    it("returns services that nothing depends on", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const roots = graph.roots()
      expect(roots).toContain("infra-factory")
      expect(roots).toContain("infra-api-docs")
      expect(roots).toContain("infra-redis") // redis has no dependents in our test data
      // postgres is not a root — many things depend on it
      expect(roots).not.toContain("infra-postgres")
    })
  })

  describe("topologicalLevels", () => {
    it("groups services by topological level", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const levels = graph.topologicalLevels()

      // Level 0 should be all leaves (no deps)
      expect(levels[0]).toEqual(graph.leaves())

      // Every level's services should have all deps in earlier levels
      const seen = new Set<string>()
      for (const level of levels) {
        for (const svc of level) {
          for (const dep of graph.directDeps(svc)) {
            expect(seen.has(dep)).toBe(true)
          }
        }
        for (const svc of level) seen.add(svc)
      }
    })

    it("contains all services across all levels", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const levels = graph.topologicalLevels()
      const all = levels.flat()
      expect(all).toHaveLength(13)
      expect(new Set(all).size).toBe(13)
    })

    it("puts postgres in level 0 and auth in level 1", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const levels = graph.topologicalLevels()
      expect(levels[0]).toContain("infra-postgres")
      expect(levels[0]).not.toContain("infra-auth")
      expect(levels[1]).toContain("infra-auth")
    })

    it("throws on cycles", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "a"],
      ])
      expect(() => graph.topologicalLevels()).toThrow(/cycle/)
    })

    it("each level is sorted alphabetically", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const levels = graph.topologicalLevels()
      for (const level of levels) {
        expect(level).toEqual([...level].sort())
      }
    })
  })

  describe("subgraphFor", () => {
    it("creates a subgraph with service + transitive deps", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const sub = graph.subgraphFor(["infra-factory"])

      expect(sub.allServices().sort()).toEqual([
        "infra-auth",
        "infra-factory",
        "infra-postgres",
      ])
      expect(sub.directDeps("infra-factory").sort()).toEqual([
        "infra-auth",
        "infra-postgres",
      ])
      expect(sub.directDeps("infra-auth")).toEqual(["infra-postgres"])
    })

    it("merges subgraphs for multiple services", () => {
      const graph = DependencyGraph.fromCatalog(buildTestCatalog())
      const sub = graph.subgraphFor(["infra-factory", "infra-otel-collector"])

      expect(sub.allServices().sort()).toEqual([
        "infra-auth",
        "infra-factory",
        "infra-loki",
        "infra-otel-collector",
        "infra-postgres",
      ])
    })
  })

  describe("collapse", () => {
    it("removes init node and rewires edges to target", () => {
      // spicedb → spicedb-migrate → postgres
      const graph = DependencyGraph.fromEdges([
        ["spicedb", "spicedb-migrate"],
        ["spicedb-migrate", "postgres"],
      ])
      const collapsed = graph.collapse(new Set(["spicedb-migrate"]))
      expect(collapsed.allServices().sort()).toEqual(["postgres", "spicedb"])
      expect(collapsed.directDeps("spicedb")).toEqual(["postgres"])
    })

    it("handles chain of init nodes", () => {
      // spicedb → spicedb-migrate → postgres-init → postgres
      const graph = DependencyGraph.fromEdges([
        ["spicedb", "spicedb-migrate"],
        ["spicedb-migrate", "postgres-init"],
        ["postgres-init", "postgres"],
      ])
      const collapsed = graph.collapse(
        new Set(["spicedb-migrate", "postgres-init"])
      )
      expect(collapsed.allServices().sort()).toEqual(["postgres", "spicedb"])
      expect(collapsed.directDeps("spicedb")).toEqual(["postgres"])
    })

    it("preserves edges not involving init nodes", () => {
      const graph = DependencyGraph.fromEdges([
        ["app", "db"],
        ["app", "app-migrate"],
        ["app-migrate", "db"],
      ])
      const collapsed = graph.collapse(new Set(["app-migrate"]))
      expect(collapsed.directDeps("app")).toEqual(["db"])
      expect(collapsed.has("app-migrate")).toBe(false)
    })

    it("returns equivalent graph when no nodes to collapse", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
      ])
      const collapsed = graph.collapse(new Set())
      expect(collapsed.allServices().sort()).toEqual(["a", "b", "c"])
      expect(collapsed.directDeps("a")).toEqual(["b"])
    })

    it("preserves isolated nodes", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["c", "c-init"],
      ])
      // Add an isolated node that has no edges at all
      const collapsed = graph.collapse(new Set(["c-init"]))
      expect(collapsed.has("a")).toBe(true)
      expect(collapsed.has("b")).toBe(true)
      expect(collapsed.has("c")).toBe(true)
      expect(collapsed.has("c-init")).toBe(false)
    })
  })
})

// ── Multi-catalog composition (slice 4) ──────────────────────────

/** Minimal catalog builder for multi-catalog tests. */
function miniCatalog(
  name: string,
  components: Record<string, string[] | undefined> = {},
  resources: Record<string, string[] | undefined> = {}
): CatalogSystem {
  const compSpec = (dependsOn?: string[]) => ({
    kind: "Component" as const,
    metadata: { name: "", namespace: "default" },
    spec: {
      type: "service",
      image: "test",
      ports: [],
      environment: {},
      dependsOn,
    },
  })
  const resSpec = (dependsOn?: string[]) => ({
    kind: "Resource" as const,
    metadata: { name: "", namespace: "default" },
    spec: {
      type: "database",
      image: "test",
      ports: [],
      environment: {},
      dependsOn,
    },
  })
  return {
    kind: "System",
    metadata: { name, namespace: "default" },
    spec: { owner: "test" },
    components: Object.fromEntries(
      Object.entries(components).map(([n, d]) => [n, compSpec(d)])
    ) as any,
    resources: Object.fromEntries(
      Object.entries(resources).map(([n, d]) => [n, resSpec(d)])
    ) as any,
    connections: [],
  }
}

describe("qualifyNode / unqualifyNode", () => {
  it("round-trips", () => {
    const id = qualifyNode("shared-auth", "auth-api")
    expect(id).toBe("shared-auth/auth-api")
    expect(unqualifyNode(id)).toEqual({
      system: "shared-auth",
      component: "auth-api",
    })
  })

  it("returns null for unqualified IDs", () => {
    expect(unqualifyNode("postgres")).toBeNull()
  })

  it("returns null for malformed qualified IDs", () => {
    expect(unqualifyNode("/postgres")).toBeNull()
    expect(unqualifyNode("system/")).toBeNull()
  })
})

describe("DependencyGraph.fromCatalogs (multi-system)", () => {
  it("unions multiple catalogs with qualified IDs (no collision)", () => {
    // Both systems have a component named `postgres` — qualified IDs prevent collision.
    const auth = miniCatalog(
      "shared-auth",
      { "auth-api": ["postgres"] },
      { postgres: [] }
    )
    const trafficure = miniCatalog(
      "trafficure",
      { api: ["postgres"] },
      { postgres: [] }
    )
    const graph = DependencyGraph.fromCatalogs([auth, trafficure])

    expect(graph.has("shared-auth/postgres")).toBe(true)
    expect(graph.has("trafficure/postgres")).toBe(true)
    expect(graph.has("shared-auth/auth-api")).toBe(true)
    expect(graph.has("trafficure/api")).toBe(true)
    // Unqualified IDs not present.
    expect(graph.has("postgres")).toBe(false)
  })

  it("dependsOn edges are qualified to the LOCAL system", () => {
    const auth = miniCatalog(
      "shared-auth",
      { "auth-api": ["postgres"] },
      { postgres: [] }
    )
    const trafficure = miniCatalog(
      "trafficure",
      { api: ["postgres"] },
      { postgres: [] }
    )
    const graph = DependencyGraph.fromCatalogs([auth, trafficure])

    // `auth-api`'s dependsOn: [postgres] resolves WITHIN shared-auth.
    expect(graph.directDeps("shared-auth/auth-api")).toEqual([
      "shared-auth/postgres",
    ])
    // `trafficure/api`'s dependsOn: [postgres] resolves WITHIN trafficure.
    expect(graph.directDeps("trafficure/api")).toEqual(["trafficure/postgres"])
    // Cross-system edges are NOT silently emitted.
    expect(graph.directDependents("shared-auth/postgres")).toEqual([
      "shared-auth/auth-api",
    ])
  })

  it("already-qualified dependsOn entry passes through unchanged", () => {
    // Advanced use: catalog author explicitly writes a qualified ref.
    const trafficure = miniCatalog("trafficure", {
      api: ["shared-auth/auth-api"],
    })
    const auth = miniCatalog("shared-auth", { "auth-api": [] }, {})
    const graph = DependencyGraph.fromCatalogs([trafficure, auth])

    expect(graph.directDeps("trafficure/api")).toEqual(["shared-auth/auth-api"])
    expect(graph.directDependents("shared-auth/auth-api")).toContain(
      "trafficure/api"
    )
  })

  it("transitive traversal crosses system boundaries when edges exist", () => {
    const shared = miniCatalog(
      "shared-auth",
      { "auth-api": ["auth-db"] },
      { "auth-db": [] }
    )
    const trafficure = miniCatalog(
      "trafficure",
      { api: ["shared-auth/auth-api"] } // explicit cross-system
    )
    const graph = DependencyGraph.fromCatalogs([shared, trafficure])

    const transitive = graph.transitiveDeps("trafficure/api")
    expect(transitive).toContain("shared-auth/auth-api")
    expect(transitive).toContain("shared-auth/auth-db")
  })

  it("initFor promotion is scoped per-catalog", () => {
    // Each catalog has its own init container for a local resource.
    const a = miniCatalog(
      "system-a",
      { "postgres-init": [] },
      { postgres: [], webapp: ["postgres"] }
    )
    a.components["postgres-init"].spec.initFor = "postgres"

    const b = miniCatalog(
      "system-b",
      { "postgres-init": [] },
      { postgres: [], worker: ["postgres"] }
    )
    b.components["postgres-init"].spec.initFor = "postgres"

    const graph = DependencyGraph.fromCatalogs([a, b])

    // system-a's webapp should depend on system-a's postgres-init (not b's).
    expect(graph.directDeps("system-a/webapp")).toContain(
      "system-a/postgres-init"
    )
    expect(graph.directDeps("system-a/webapp")).not.toContain(
      "system-b/postgres-init"
    )
    // Same for b.
    expect(graph.directDeps("system-b/worker")).toContain(
      "system-b/postgres-init"
    )
  })

  it("single-catalog `fromCatalog` still uses unqualified IDs (backwards compat)", () => {
    const cat = miniCatalog("test", { api: ["db"] }, { db: [] })
    const graph = DependencyGraph.fromCatalog(cat)

    expect(graph.has("api")).toBe(true)
    expect(graph.has("db")).toBe(true)
    expect(graph.has("test/api")).toBe(false) // no qualification
    expect(graph.directDeps("api")).toEqual(["db"])
  })

  it("empty catalog list produces an empty graph", () => {
    const graph = DependencyGraph.fromCatalogs([])
    expect(graph.allServices()).toEqual([])
  })
})
