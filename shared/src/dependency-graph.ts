import type { CatalogSystem } from "./catalog"

/**
 * Directed acyclic graph of service dependencies.
 *
 * Built from catalog `spec.dependsOn` fields. Edges point from dependent → dependency
 * (e.g., infra-auth → infra-postgres means "auth depends on postgres").
 *
 * Used by:
 * - `dx dev` — determine what to start and in what order
 * - `dx up` — startup ordering
 * - Connection propagation — transitive remote dep expansion
 * - Health checks — dependency chain verification
 */
export class DependencyGraph {
  /** Adjacency list: service → its direct dependencies */
  private readonly deps: Map<string, string[]>
  /** Reverse adjacency list: service → services that depend on it */
  private readonly rdeps: Map<string, string[]>
  /** All known service names */
  private readonly nodes: Set<string>

  private constructor(
    deps: Map<string, string[]>,
    rdeps: Map<string, string[]>,
    nodes: Set<string>
  ) {
    this.deps = deps
    this.rdeps = rdeps
    this.nodes = nodes
  }

  /**
   * Build a dependency graph from a CatalogSystem.
   * Includes both components and resources.
   */
  static fromCatalog(catalog: CatalogSystem): DependencyGraph {
    const deps = new Map<string, string[]>()
    const rdeps = new Map<string, string[]>()
    const nodes = new Set<string>()

    // Collect all entities
    for (const name of Object.keys(catalog.components)) {
      nodes.add(name)
    }
    for (const name of Object.keys(catalog.resources)) {
      nodes.add(name)
    }

    // Build adjacency lists
    for (const [name, comp] of Object.entries(catalog.components)) {
      const d = comp.spec.dependsOn ?? []
      deps.set(name, d)
      for (const dep of d) {
        nodes.add(dep) // ensure deps are in the node set even if not declared
        const rev = rdeps.get(dep) ?? []
        rev.push(name)
        rdeps.set(dep, rev)
      }
    }

    for (const [name, res] of Object.entries(catalog.resources)) {
      const d = res.spec.dependsOn ?? []
      deps.set(name, d)
      for (const dep of d) {
        nodes.add(dep)
        const rev = rdeps.get(dep) ?? []
        rev.push(name)
        rdeps.set(dep, rev)
      }
    }

    // Ensure every node has an entry in deps/rdeps
    for (const node of nodes) {
      if (!deps.has(node)) deps.set(node, [])
      if (!rdeps.has(node)) rdeps.set(node, [])
    }

    return new DependencyGraph(deps, rdeps, nodes)
  }

  /**
   * Build a graph from explicit edges (for testing or manual construction).
   */
  static fromEdges(edges: Array<[string, string]>): DependencyGraph {
    const deps = new Map<string, string[]>()
    const rdeps = new Map<string, string[]>()
    const nodes = new Set<string>()

    for (const [from, to] of edges) {
      nodes.add(from)
      nodes.add(to)

      const d = deps.get(from) ?? []
      d.push(to)
      deps.set(from, d)

      const r = rdeps.get(to) ?? []
      r.push(from)
      rdeps.set(to, r)
    }

    for (const node of nodes) {
      if (!deps.has(node)) deps.set(node, [])
      if (!rdeps.has(node)) rdeps.set(node, [])
    }

    return new DependencyGraph(deps, rdeps, nodes)
  }

  // ── Core queries ────────────────────────────────────────────

  /** Direct dependencies of a service. */
  directDeps(service: string): string[] {
    return this.deps.get(service) ?? []
  }

  /** Services that directly depend on the given service. */
  directDependents(service: string): string[] {
    return this.rdeps.get(service) ?? []
  }

  /** All transitive dependencies (recursive). Does not include the service itself. */
  transitiveDeps(service: string): string[] {
    const visited = new Set<string>()
    const stack = [...this.directDeps(service)]

    while (stack.length > 0) {
      const node = stack.pop()!
      if (visited.has(node)) continue
      visited.add(node)
      stack.push(...this.directDeps(node))
    }

    return [...visited]
  }

  /** All services that transitively depend on the given service. Does not include the service itself. */
  transitiveDependents(service: string): string[] {
    const visited = new Set<string>()
    const stack = [...this.directDependents(service)]

    while (stack.length > 0) {
      const node = stack.pop()!
      if (visited.has(node)) continue
      visited.add(node)
      stack.push(...this.directDependents(node))
    }

    return [...visited]
  }

  // ── Ordering ────────────────────────────────────────────────

  /**
   * Topological sort of all services (Kahn's algorithm).
   * Returns services in startup order (dependencies first).
   * Throws if the graph has a cycle.
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>()
    for (const node of this.nodes) {
      inDegree.set(node, 0)
    }
    for (const [, targets] of this.deps) {
      for (const t of targets) {
        inDegree.set(t, (inDegree.get(t) ?? 0) + 1)
      }
    }

    // Wait — inDegree should count how many things depend on each node,
    // but for startup order we want dependencies first.
    // In our graph, edges are dependent→dependency. For topo sort in
    // startup order (deps first), we need to process by the REVERSE graph.
    // Kahn's on the reverse: nodes with no incoming edges in rdeps go first.

    const revInDegree = new Map<string, number>()
    for (const node of this.nodes) {
      revInDegree.set(node, (this.deps.get(node) ?? []).length)
    }

    const queue: string[] = []
    for (const [node, deg] of revInDegree) {
      if (deg === 0) queue.push(node)
    }

    // Stable sort: process queue alphabetically within each "level"
    queue.sort()

    const result: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      result.push(node)

      for (const dependent of this.directDependents(node)) {
        const newDeg = (revInDegree.get(dependent) ?? 1) - 1
        revInDegree.set(dependent, newDeg)
        if (newDeg === 0) {
          // Insert in sorted position for stability
          const idx = queue.findIndex((q) => q > dependent)
          if (idx === -1) queue.push(dependent)
          else queue.splice(idx, 0, dependent)
        }
      }
    }

    if (result.length !== this.nodes.size) {
      throw new Error(
        "Dependency graph contains a cycle — cannot produce a topological sort"
      )
    }

    return result
  }

  /**
   * Startup order for a subset of services + all their transitive deps.
   * Returns services in dependency-first order.
   */
  startupOrder(targets: string[]): string[] {
    // Collect all needed services (targets + their transitive deps)
    const needed = new Set<string>()
    for (const t of targets) {
      needed.add(t)
      for (const dep of this.transitiveDeps(t)) {
        needed.add(dep)
      }
    }

    // Filter topological sort to only needed services
    const fullOrder = this.topologicalSort()
    return fullOrder.filter((s) => needed.has(s))
  }

  /**
   * Group services into topological levels (BFS waves).
   * Level 0 = leaves (no deps), Level N = all deps in levels < N.
   * Useful for visualizing startup parallelism.
   * Throws if the graph has a cycle.
   */
  topologicalLevels(): string[][] {
    const revInDegree = new Map<string, number>()
    for (const node of this.nodes) {
      revInDegree.set(node, (this.deps.get(node) ?? []).length)
    }

    let queue: string[] = []
    for (const [node, deg] of revInDegree) {
      if (deg === 0) queue.push(node)
    }
    queue.sort()

    const levels: string[][] = []
    let processed = 0

    while (queue.length > 0) {
      levels.push([...queue])
      processed += queue.length

      const next: string[] = []
      for (const node of queue) {
        for (const dependent of this.directDependents(node)) {
          const newDeg = (revInDegree.get(dependent) ?? 1) - 1
          revInDegree.set(dependent, newDeg)
          if (newDeg === 0) next.push(dependent)
        }
      }

      next.sort()
      queue = next
    }

    if (processed !== this.nodes.size) {
      throw new Error(
        "Dependency graph contains a cycle — cannot produce topological levels"
      )
    }

    return levels
  }

  // ── Analysis ────────────────────────────────────────────────

  /** Check if the graph contains any cycles. */
  hasCycle(): boolean {
    try {
      this.topologicalSort()
      return false
    } catch {
      return true
    }
  }

  /** Services with no dependencies (e.g., postgres, redis, mongo). */
  leaves(): string[] {
    return [...this.nodes]
      .filter((n) => (this.deps.get(n) ?? []).length === 0)
      .sort()
  }

  /** Services that nothing depends on (e.g., factory-api, top-level apps). */
  roots(): string[] {
    return [...this.nodes]
      .filter((n) => (this.rdeps.get(n) ?? []).length === 0)
      .sort()
  }

  /** All service names in the graph. */
  allServices(): string[] {
    return [...this.nodes].sort()
  }

  /** Whether a service exists in the graph. */
  has(service: string): boolean {
    return this.nodes.has(service)
  }

  // ── Collapsing ─────────────────────────────────────────────

  /**
   * Collapse nodes out of the graph, rewiring edges through them.
   *
   * For each entry in `nodeToTarget`, the node is removed and any service
   * that depended on it inherits the collapsed node's own dependencies.
   * Returns a new DependencyGraph (no mutation).
   *
   * Example: collapse({spicedb-migrate: spicedb, postgres-init: postgres})
   *   Before: spicedb → spicedb-migrate → postgres-init → postgres
   *   After:  spicedb → postgres
   */
  collapse(nodeToTarget: Map<string, string>): DependencyGraph {
    const collapsedSet = new Set(nodeToTarget.keys())

    // Resolve deps for a node, expanding through collapsed nodes
    const resolveDeps = (
      node: string,
      visited = new Set<string>()
    ): string[] => {
      if (visited.has(node)) return []
      visited.add(node)
      const result: string[] = []
      for (const dep of this.directDeps(node)) {
        if (collapsedSet.has(dep)) {
          // Skip the collapsed node, inherit its deps
          result.push(...resolveDeps(dep, visited))
        } else {
          result.push(dep)
        }
      }
      return result
    }

    const edges: Array<[string, string]> = []
    const nodesWithoutEdges: string[] = []

    for (const node of this.nodes) {
      if (collapsedSet.has(node)) continue

      const resolvedDeps = new Set<string>()
      for (const dep of resolveDeps(node)) {
        if (dep !== node) resolvedDeps.add(dep)
      }

      if (resolvedDeps.size === 0) {
        nodesWithoutEdges.push(node)
      }
      for (const dep of resolvedDeps) {
        edges.push([node, dep])
      }
    }

    const graph = DependencyGraph.fromEdges(edges)
    // Ensure isolated non-collapsed nodes are still in the graph
    for (const node of nodesWithoutEdges) {
      if (!graph.has(node)) {
        graph.nodes.add(node)
        if (!graph.deps.has(node)) graph.deps.set(node, [])
        if (!graph.rdeps.has(node)) graph.rdeps.set(node, [])
      }
    }

    return graph
  }

  // ── Subgraph ────────────────────────────────────────────────

  /** Create a subgraph containing only the given services + their transitive deps. */
  subgraphFor(services: string[]): DependencyGraph {
    const needed = new Set<string>()
    for (const s of services) {
      needed.add(s)
      for (const dep of this.transitiveDeps(s)) {
        needed.add(dep)
      }
    }

    const edges: Array<[string, string]> = []
    for (const node of needed) {
      for (const dep of this.directDeps(node)) {
        if (needed.has(dep)) {
          edges.push([node, dep])
        }
      }
    }

    return DependencyGraph.fromEdges(edges)
  }
}
