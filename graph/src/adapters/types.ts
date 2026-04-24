/**
 * Adapter interface — pluggable storage/compute backend for the Graph runtime.
 *
 * Each adapter maps entity kinds to a storage strategy:
 *   - postgres-code:    typed Drizzle tables, resolved via FACTORY_BINDINGS
 *   - postgres-dynamic: generic JSONB instance/link rows in the graph schema
 *   - rest (future):    delegate to an HTTP API
 *   - attachment-s3:    blob storage for attachment properties
 *
 * The Graph service picks an adapter per kind. Callers of Graph never touch
 * adapters directly.
 */

import type { Effect } from "effect"

export interface Ref {
  readonly kind: string
  readonly id: string
}

export interface InstanceRow {
  readonly id: string
  readonly graphId: string | null
  readonly kind: string
  readonly slug: string | null
  readonly title: string | null
  readonly spec: Record<string, unknown>
  readonly status: Record<string, unknown> | null
  readonly metadata: Record<string, unknown> | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ListOpts {
  readonly filter?: Record<string, unknown>
  readonly limit?: number
  readonly offset?: number
  readonly orderBy?: { field: string; dir: "asc" | "desc" }
}

export interface LinkRow {
  readonly graphId: string | null
  readonly source: Ref
  readonly linkName: string
  readonly target: Ref
}

export interface AdapterCapabilities {
  readonly supportsWatch: boolean
  readonly supportsAggregate: boolean
}

export interface Adapter {
  readonly name: string
  readonly capabilities: AdapterCapabilities

  readonly get: (
    kind: string,
    idOrSlug: string,
    graphId: string | null
  ) => Effect.Effect<InstanceRow | null>

  readonly list: (
    kind: string,
    opts: ListOpts,
    graphId: string | null
  ) => Effect.Effect<InstanceRow[]>

  readonly create: (
    kind: string,
    input: Partial<InstanceRow>,
    graphId: string | null
  ) => Effect.Effect<InstanceRow>

  readonly update: (
    kind: string,
    id: string,
    patch: Partial<InstanceRow>,
    graphId: string | null
  ) => Effect.Effect<InstanceRow>

  readonly delete: (
    kind: string,
    id: string,
    graphId: string | null
  ) => Effect.Effect<void>

  readonly link: (row: LinkRow) => Effect.Effect<void>
  readonly unlink: (row: LinkRow) => Effect.Effect<void>

  readonly listLinks: (
    source: Ref,
    linkName: string,
    graphId: string | null
  ) => Effect.Effect<LinkRow[]>
}
