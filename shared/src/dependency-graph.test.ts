import { describe, expect, it } from "vitest"

import type { CatalogSystem } from "./catalog"
import { DependencyGraph } from "./dependency-graph"

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
      const collapsed = graph.collapse(
        new Map([["spicedb-migrate", "spicedb"]])
      )
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
        new Map([
          ["spicedb-migrate", "spicedb"],
          ["postgres-init", "postgres"],
        ])
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
      const collapsed = graph.collapse(new Map([["app-migrate", "app"]]))
      expect(collapsed.directDeps("app")).toEqual(["db"])
      expect(collapsed.has("app-migrate")).toBe(false)
    })

    it("returns equivalent graph when no nodes to collapse", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["b", "c"],
      ])
      const collapsed = graph.collapse(new Map())
      expect(collapsed.allServices().sort()).toEqual(["a", "b", "c"])
      expect(collapsed.directDeps("a")).toEqual(["b"])
    })

    it("preserves isolated nodes", () => {
      const graph = DependencyGraph.fromEdges([
        ["a", "b"],
        ["c", "c-init"],
      ])
      // Add an isolated node that has no edges at all
      const collapsed = graph.collapse(new Map([["c-init", "c"]]))
      expect(collapsed.has("a")).toBe(true)
      expect(collapsed.has("b")).toBe(true)
      expect(collapsed.has("c")).toBe(true)
      expect(collapsed.has("c-init")).toBe(false)
    })
  })
})
