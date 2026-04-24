import type { JsonSchema, PropertyAnnotations, AccessDefinition } from "./types"

export interface GraphIR {
  $schema: "https://graph.dev/ir/v1"
  version: "1.0"
  namespaces: Record<string, { description?: string; entityKinds: string[] }>
  traits: Record<string, TraitIR>
  entities: Record<string, EntityIR>
  structs?: Record<string, StructIR>
  sharedProperties?: Record<string, SharedPropertyIR>
  valueTypes?: Record<string, ValueTypeIR>
  interfaces?: Record<string, InterfaceIR>
}

export interface StructIR {
  name: string
  description?: string
  fields: JsonSchema
  mainField?: string
}

export interface SharedPropertyIR {
  name: string
  schema: JsonSchema
  annotations?: PropertyAnnotations
  display?: Record<string, unknown>
}

export interface ValueTypeIR {
  name: string
  base: "string" | "number" | "boolean" | "date"
  description?: string
  display?: Record<string, unknown>
  validation?: Record<string, unknown>
}

export interface InterfaceIR {
  name: string
  description?: string
  properties: JsonSchema
}

export interface TraitIR {
  name: string
  description?: string
  properties?: { spec?: JsonSchema; status?: JsonSchema }
  annotations?: PropertyAnnotations
  links?: Record<string, LinkIR>
  derived?: Record<string, DerivedIR>
  requires?: string[]
}

export interface EntityIR {
  kind: string
  namespace: string
  prefix: string
  plural: string
  description?: string
  traits: string[]
  implements?: string[]

  schemas: {
    spec: JsonSchema
    status: JsonSchema
    metadata: JsonSchema
  }

  annotations: PropertyAnnotations

  identity: {
    slugScope: "global" | "namespace" | string
    titleProperty?: string
  }

  reconciliation: boolean
  bitemporal: boolean
  softDelete: "bitemporal" | "timestamp" | false

  links: Record<string, LinkIR>
  derived: Record<string, DerivedIR>
  actions: Record<string, ActionIR>

  access?: AccessDefinition

  visibility: "prominent" | "normal" | "hidden"
  lifecycle: "experimental" | "production" | "deprecated"
  icon?: string
}

export interface LinkIR {
  cardinality: "many-to-one" | "one-to-many" | "many-to-many" | "one-to-one"
  target: string
  fk?: string
  targetFk?: string
  junction?: {
    entity?: string
    table?: string
    sourceFk: string
    targetFk: string
  }
  polymorphic?: { kindColumn: string; kindValue?: string }
  inverse?: string
  cascade?: "delete" | "nullify" | "restrict"
  required?: boolean
  description?: string
}

export interface ActionIR {
  description?: string
  parameters: JsonSchema
  returns?: JsonSchema
  edits?: string[]
  targets?: string[]
  permission?: string
  dryRun: boolean
}

export interface DerivedIR {
  type: string
  description?: string
  computation: Record<string, unknown> // serialized computation
  materialized: false | { refreshOn?: string[]; staleAfter?: string }
}
