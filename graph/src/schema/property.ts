/**
 * Shared property types + special property kind helpers.
 *
 * `defineProperty(name, def)` registers a reusable property definition that
 * entities and links can reference by name — Foundry's "Shared Property
 * Type". The `property.*` helpers produce marker values for special kinds
 * the IR understands natively: attachment, media, time-series, geo,
 * encrypted. Phase A only models the types; runtime support (blob storage,
 * time-series queries) lands in later phases.
 */

import type { z } from "zod"
import type { JsonSchema, PropertyAnnotations } from "./types"
import type { SharedPropertyIR } from "./ir"
import { detectAdapter } from "./schema-adapter"

export interface SharedPropertyDefinition<T = unknown> {
  readonly __kind: "sharedProperty"
  readonly name: string
  readonly schema: z.ZodType<T> | JsonSchema
  readonly annotations?: PropertyAnnotations
  readonly display?: Record<string, unknown>
}

export interface DefinePropertyOptions<T> {
  readonly schema: z.ZodType<T> | JsonSchema
  readonly annotations?: PropertyAnnotations
  readonly display?: Record<string, unknown>
}

export function defineProperty<T>(
  name: string,
  opts: DefinePropertyOptions<T>
): SharedPropertyDefinition<T> {
  return {
    __kind: "sharedProperty",
    name,
    schema: opts.schema,
    annotations: opts.annotations,
    display: opts.display,
  }
}

export function compileSharedProperty(
  def: SharedPropertyDefinition<unknown>
): SharedPropertyIR {
  const adapter = detectAdapter(def.schema)
  return {
    name: def.name,
    schema: adapter.toJsonSchema(def.schema),
    annotations: def.annotations,
    display: def.display,
  }
}

// --- Special property-kind markers ---------------------------------------
// These are values you can drop into entity specs. Each carries a discriminator
// the IR compiler + runtime use to dispatch special handling.

export interface AttachmentMarker {
  readonly __propKind: "attachment"
  readonly mimeTypes?: readonly string[]
  readonly maxBytes?: number
}

export interface MediaMarker {
  readonly __propKind: "media"
  readonly mimeTypes?: readonly string[]
}

export interface TimeseriesMarker {
  readonly __propKind: "timeseries"
  readonly pointType: "number" | "string" | "boolean"
  readonly retention?: string
}

export interface GeoMarker {
  readonly __propKind: "geo"
  readonly shape: "point" | "line" | "polygon"
}

export interface EncryptedMarker {
  readonly __propKind: "encrypted"
  readonly base: "string" | "number"
}

export const property = {
  attachment(opts?: Omit<AttachmentMarker, "__propKind">): AttachmentMarker {
    return { __propKind: "attachment", ...opts }
  },
  media(opts?: Omit<MediaMarker, "__propKind">): MediaMarker {
    return { __propKind: "media", ...opts }
  },
  timeseries(opts: Omit<TimeseriesMarker, "__propKind">): TimeseriesMarker {
    return { __propKind: "timeseries", ...opts }
  },
  geo(opts: Omit<GeoMarker, "__propKind">): GeoMarker {
    return { __propKind: "geo", ...opts }
  },
  encrypted(opts: Omit<EncryptedMarker, "__propKind">): EncryptedMarker {
    return { __propKind: "encrypted", ...opts }
  },
}
