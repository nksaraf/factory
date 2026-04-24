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
) => Effect.Effect<CustomerLoadResult>

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
  const cache = new Map<string, Promise<GraphIR>>()

  return {
    forGraph: (graphId) =>
      Effect.tryPromise({
        try: () => {
          const cached = cache.get(graphId)
          if (cached) return cached
          const promise = Effect.runPromise(deps.loadCustomer(graphId)).then(
            (customer) => mergeCustomer(deps.base, customer)
          )
          // Only cache successful resolutions so a merge failure doesn't pin
          // the cache to a rejected promise forever.
          promise.catch(() => cache.delete(graphId))
          cache.set(graphId, promise)
          return promise
        },
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }),

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
