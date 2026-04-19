/**
 * Live layer for FactoryApi — wraps the existing FactoryClient class.
 *
 * Error classification by HTTP status code:
 *   401 / 403 → AuthenticationError
 *   404       → EntityNotFoundError
 *   Network   → ApiUnreachableError
 *   Other     → ApiUnreachableError (keeps the service signature narrow)
 */

import { Effect, Layer } from "effect"
import type { FactoryClient } from "../../lib/api-client.js"
import { FactoryApi } from "../services/factory-api.js"
import {
  ApiUnreachableError,
  AuthenticationError,
  EntityNotFoundError,
} from "@smp/factory-shared/effect/errors"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "API 404: ..." style messages from FactoryClient.request(). */
function parseStatusCode(error: Error): number | undefined {
  const match = error.message.match(/^API (\d{3}):/)
  return match ? Number(match[1]) : undefined
}

/**
 * Classify a caught error for entity-level operations (GET/DELETE by id, actions).
 * 404 maps to EntityNotFoundError.
 */
function classifyEntityError(
  error: unknown,
  path: string
): ApiUnreachableError | AuthenticationError | EntityNotFoundError {
  if (!(error instanceof Error)) {
    return new ApiUnreachableError({ url: path, cause: String(error) })
  }

  const status = parseStatusCode(error)

  if (status === 401 || status === 403) {
    return new AuthenticationError({ reason: error.message })
  }

  if (status === 404) {
    return new EntityNotFoundError({ entity: "resource", identifier: path })
  }

  return new ApiUnreachableError({ url: path, cause: error.message })
}

/**
 * Classify a caught error for collection-level operations (list, create).
 * 404 is treated as unreachable, not a missing entity.
 */
function classifyCollectionError(
  error: unknown,
  path: string
): ApiUnreachableError | AuthenticationError {
  if (!(error instanceof Error)) {
    return new ApiUnreachableError({ url: path, cause: String(error) })
  }

  const status = parseStatusCode(error)

  if (status === 401 || status === 403) {
    return new AuthenticationError({ reason: error.message })
  }

  return new ApiUnreachableError({ url: path, cause: error.message })
}

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

/**
 * Build the live FactoryApi layer backed by an existing FactoryClient instance.
 *
 * Usage:
 * ```ts
 * const layer = makeFactoryApiLayer(client)
 * const program = Effect.gen(function* () {
 *   const api = yield* FactoryApi
 *   return yield* api.listEntities("system")
 * })
 * runEffect(Effect.provide(program, layer), "list-systems")
 * ```
 */
export function makeFactoryApiLayer(
  client: FactoryClient
): Layer.Layer<FactoryApi> {
  return Layer.succeed(FactoryApi, {
    request: <T>(method: string, path: string, body?: unknown) =>
      Effect.tryPromise({
        try: () => client.request<T>(method, path, body),
        catch: (error) => classifyEntityError(error, path),
      }),

    listEntities: (kind: string, query?: Record<string, string>) => {
      const qs = query ? "?" + new URLSearchParams(query).toString() : ""
      const path = `/api/v1/factory/catalog/${kind}${qs}`
      return Effect.tryPromise({
        try: () =>
          client.request<{ data: unknown[]; total?: number }>("GET", path),
        catch: (error) => classifyCollectionError(error, path),
      })
    },

    getEntity: (kind: string, slugOrId: string) => {
      const path = `/api/v1/factory/catalog/${kind}/${slugOrId}`
      return Effect.tryPromise({
        try: () => client.request<unknown>("GET", path),
        catch: (error) => classifyEntityError(error, path),
      })
    },

    createEntity: (kind: string, body: unknown) => {
      const path = `/api/v1/factory/catalog/${kind}`
      return Effect.tryPromise({
        try: () => client.request<unknown>("POST", path, body),
        catch: (error) => classifyCollectionError(error, path),
      })
    },

    entityAction: (
      kind: string,
      id: string,
      action: string,
      body?: unknown
    ) => {
      const path = `/api/v1/factory/catalog/${kind}/${id}/${action}`
      return Effect.tryPromise({
        try: () => client.request<unknown>("POST", path, body),
        catch: (error) => classifyEntityError(error, path),
      })
    },

    deleteEntity: (kind: string, id: string) => {
      const path = `/api/v1/factory/catalog/${kind}/${id}/delete`
      return Effect.tryPromise({
        try: () => client.request<void>("POST", path).then(() => undefined),
        catch: (error) => classifyEntityError(error, path),
      })
    },
  })
}
