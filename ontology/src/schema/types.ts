// JSON Schema subset we care about
export interface JsonSchema {
  $schema?: string
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  $ref?: string
  description?: string
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  additionalProperties?: boolean | JsonSchema
  [key: string]: unknown // extensible
}

// Property annotations — ontology metadata on top of schema properties
export interface PropertyAnnotation {
  searchable?: boolean
  sortable?: boolean
  visibility?: "prominent" | "normal" | "hidden"
  redactUnless?: string
  readOnly?: boolean
  displayName?: string
  description?: string
  format?: string
  kind?: "timeseries"
  timeseriesConfig?: {
    valueType: "float" | "integer"
    resolution?: string
    retention?: string
    interpolation?: "linear" | "step" | "none"
  }
}

export type PropertyAnnotations = Record<string, PropertyAnnotation>

// Link definitions
export interface LinkDefinition {
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
  polymorphic?: {
    kindColumn: string
    kindValue?: string
  }
  inverse?: string
  cascade?: "delete" | "nullify" | "restrict"
  required?: boolean
  description?: string
}

// Action definitions
export interface ActionDefinition {
  description?: string
  parameters?: unknown // any schema-producing type
  returns?: unknown
  edits?: ("create" | "update" | "delete" | "link" | "unlink")[]
  targets?: string[]
  permission?: string
  dryRun?: boolean
}

// Derived property definitions
export interface DerivedPropertyDefinition {
  type: string // JSON Schema type
  description?: string
  computation:
    | { kind: "count"; path: string }
    | { kind: "sum"; path: string; field: string }
    | { kind: "avg"; path: string; field: string }
    | { kind: "min"; path: string; field: string }
    | { kind: "max"; path: string; field: string }
    | { kind: "exists"; path: string; where?: Record<string, unknown> }
    | {
        kind: "first"
        path: string
        orderBy?: string
        direction?: "asc" | "desc"
      }
    | { kind: "expr"; fn: (entity: any) => unknown }
    | { kind: "custom"; compute: string }
  materialized?:
    | false
    | {
        refreshOn?: ("create" | "update" | "delete")[]
        staleAfter?: string
      }
}

// Trait definitions
export interface TraitDefinition {
  name: string
  description?: string
  spec?: unknown // schema
  status?: unknown // schema
  annotations?: PropertyAnnotations
  links?: Record<string, LinkDefinition>
  derived?: Record<string, DerivedPropertyDefinition>
  requires?: string[] // trait names
}

// Entity definitions
export interface EntityDefinition<TSpec = unknown, TStatus = unknown> {
  kind: string
  namespace: string
  prefix: string
  plural?: string
  description?: string

  traits?: TraitDefinition[]

  spec: TSpec
  status?: TStatus
  metadata?: "standard" | unknown

  annotations?: PropertyAnnotations

  identity?: {
    slug?: { scope?: "global" | "namespace" | string }
    titleProperty?: string
  }

  links?: Record<string, LinkDefinition>
  derived?: Record<string, DerivedPropertyDefinition>
  actions?: Record<string, ActionDefinition>

  reconciliation?: boolean | { statusSchema?: unknown }
  bitemporal?: boolean
  softDelete?: "bitemporal" | "timestamp" | false

  visibility?: "prominent" | "normal" | "hidden"
  lifecycle?: "experimental" | "production" | "deprecated"
  icon?: string

  access?: AccessDefinition
}

// Access control shorthand
export interface AccessDefinition {
  resourceType: string
  permissions: Record<string, string>
  propertyPolicies?: Record<string, { requires: string; redactTo?: unknown }>
}
