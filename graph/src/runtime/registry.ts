/**
 * GraphRegistry — composes framework/product IR with per-graph customer
 * overlays at runtime.
 *
 * The registry holds a base IR (typically DxFactoryGraph extended by one
 * or more product graphs) and, for each registered graph_id, fetches the
 * customer-layer definitions from the DB via `loadCustomer`, merges them
 * into the base, and caches the result.
 *
 * Callers interact via `forGraph(id)` which returns the composed IR.
 * `invalidate(id)` drops one entry; `invalidate()` drops all.
 *
 * Concurrency: the cache stores the memoized Effect itself (via
 * Effect.cached) so concurrent forGraph(id) calls share a single
 * loadCustomer + merge invocation. Failures evict the entry so subsequent
 * calls retry rather than pin to a permanent error.
 */

import { Effect } from "effect"
import type { GraphIR, EntityIR } from "../schema/ir"

export interface CustomerLoadResult {
  readonly objectTypes: Record<string, EntityIR>
  readonly extensions?: Record<string, unknown>
  // Future: linkTypes, interfaceTypes, sharedProperties, valueTypes,
  // structTypes, actionTypes, functionTypes — each loaded by the customer
  // loader and merged into the returned IR.
}

export type CustomerLoader = (
  graphId: string
) => Effect.Effect<CustomerLoadResult, Error>

export interface GraphRegistry {
  readonly forGraph: (graphId: string) => Effect.Effect<GraphIR, Error>
  readonly invalidate: (graphId?: string) => Effect.Effect<void>
}

interface Deps {
  readonly base: GraphIR
  readonly loadCustomer: CustomerLoader
}

function mergeCustomer(base: GraphIR, customer: CustomerLoadResult): GraphIR {
  const entities: Record<string, EntityIR> = { ...base.entities }
  const namespaces: GraphIR["namespaces"] = {}
  for (const [ns, def] of Object.entries(base.namespaces)) {
    namespaces[ns] = {
      description: def.description,
      entityKinds: [...def.entityKinds],
    }
  }

  for (const [kind, entity] of Object.entries(customer.objectTypes)) {
    if (entities[kind]) {
      throw new Error(
        `customer graph cannot redefine existing kind "${kind}"; use a new kind`
      )
    }
    entities[kind] = entity
    if (!namespaces[entity.namespace]) {
      namespaces[entity.namespace] = { entityKinds: [] }
    }
    namespaces[entity.namespace].entityKinds.push(kind)
  }

  return { ...base, entities, namespaces }
}

export function makeGraphRegistry(deps: Deps): GraphRegistry {
  // Cache holds the memoized Effect itself. Concurrent callers all observe
  // the same fiber via Effect.cached's structural sharing — no second
  // loadCustomer invocation, no detached fiber chain.
  const cache = new Map<string, Effect.Effect<GraphIR, Error>>()

  const buildCached = (
    graphId: string
  ): Effect.Effect<Effect.Effect<GraphIR, Error>, never> =>
    Effect.cached(
      deps.loadCustomer(graphId).pipe(
        Effect.flatMap((customer) =>
          Effect.try({
            try: () => mergeCustomer(deps.base, customer),
            catch: (err) =>
              err instanceof Error ? err : new Error(String(err)),
          })
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            // On failure, evict so subsequent forGraph calls retry.
            cache.delete(graphId)
          })
        )
      )
    )

  return {
    forGraph: (graphId) => {
      const cached = cache.get(graphId)
      if (cached) return cached
      // Effect.cached returns Effect<Effect<A,E>>; we run it synchronously
      // (no DB work yet — just memoization wiring) to get the inner cached
      // Effect, then store + return that. First call to inner runs the
      // loader; subsequent calls (concurrent or sequential) reuse the
      // memoized result.
      const memoized = Effect.runSync(buildCached(graphId))
      cache.set(graphId, memoized)
      return memoized
    },

    invalidate: (graphId) =>
      Effect.sync(() => {
        if (graphId === undefined) {
          cache.clear()
        } else {
          cache.delete(graphId)
        }
      }),
  }
}
