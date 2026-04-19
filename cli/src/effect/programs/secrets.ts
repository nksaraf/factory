/**
 * Effect programs for secret management.
 *
 * Each function returns an Effect that depends on FactoryApi.
 * The caller provides the layer and runs via `runEffect()`.
 */

import { Effect } from "effect"
import { FactoryApi } from "../services/factory-api.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretListResponse {
  secrets: Array<{
    slug: string
    scopeType: string
    scopeId: string
    environment: string
    updatedAt: string
  }>
}

export interface SecretGetResponse {
  value: string
}

export interface SecretSetBody {
  slug: string
  value: string
  scopeType?: string
  scopeId?: string
  environment?: string
}

export interface SecretRotateBody {
  slug: string
  scopeType?: string
  scopeId?: string
}

export interface SecretRotateResponse {
  rotated: number
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export const listSecrets = (query?: Record<string, string>) =>
  Effect.gen(function* () {
    const api = yield* FactoryApi
    const qs = query ? "?" + new URLSearchParams(query).toString() : ""
    return yield* api.request<SecretListResponse>(
      "GET",
      `/api/v1/factory/secrets${qs}`
    )
  })

export const getSecret = (slug: string, query?: Record<string, string>) =>
  Effect.gen(function* () {
    const api = yield* FactoryApi
    const qs = query ? "?" + new URLSearchParams(query).toString() : ""
    return yield* api.request<SecretGetResponse>(
      "GET",
      `/api/v1/factory/secrets/${encodeURIComponent(slug)}${qs}`
    )
  })

export const setSecret = (body: SecretSetBody) =>
  Effect.gen(function* () {
    const api = yield* FactoryApi
    return yield* api.request<{ success: boolean }>(
      "POST",
      "/api/v1/factory/secrets",
      body
    )
  })

export const removeSecret = (slug: string, query?: Record<string, string>) =>
  Effect.gen(function* () {
    const api = yield* FactoryApi
    const qs = query ? "?" + new URLSearchParams(query).toString() : ""
    return yield* api.request<{ success: boolean }>(
      "DELETE",
      `/api/v1/factory/secrets/${encodeURIComponent(slug)}${qs}`
    )
  })

export const rotateSecret = (body: SecretRotateBody) =>
  Effect.gen(function* () {
    const api = yield* FactoryApi
    return yield* api.request<SecretRotateResponse>(
      "POST",
      "/api/v1/factory/secrets/rotate",
      body
    )
  })
