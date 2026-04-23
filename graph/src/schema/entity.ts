import type {
  EntityDefinition,
  TraitDefinition,
  LinkDefinition,
  PropertyAnnotations,
  JsonSchema,
} from "./types"
import type {
  EntityIR,
  GraphIR,
  TraitIR,
  LinkIR,
  ActionIR,
  DerivedIR,
} from "./ir"
import { detectAdapter } from "./schema-adapter"

function pluralize(s: string): string {
  if (s.endsWith("y") && !/[aeiou]y$/.test(s)) return s.slice(0, -1) + "ies"
  if (
    s.endsWith("s") ||
    s.endsWith("x") ||
    s.endsWith("ch") ||
    s.endsWith("sh")
  )
    return s + "es"
  return s + "s"
}

export function defineEntity<TSpec, TStatus = unknown>(
  kind: string,
  def: Omit<EntityDefinition<TSpec, TStatus>, "kind">
): EntityDefinition<TSpec, TStatus> & { readonly __kind: string } {
  return { kind, ...def, __kind: kind }
}

/** Compile an EntityDefinition into the serializable EntityIR. */
export function compileEntity(entity: EntityDefinition): EntityIR {
  const adapter = detectAdapter(entity.spec)

  // Merge trait properties
  let mergedAnnotations: PropertyAnnotations = { ...entity.annotations }
  let mergedLinks: Record<string, LinkDefinition> = { ...entity.links }
  let mergedDerived = { ...entity.derived }
  const traitNames: string[] = []

  if (entity.traits) {
    for (const trait of entity.traits) {
      traitNames.push(trait.name)
      if (trait.annotations) {
        mergedAnnotations = { ...mergedAnnotations, ...trait.annotations }
      }
      if (trait.links) {
        mergedLinks = { ...mergedLinks, ...trait.links }
      }
      if (trait.derived) {
        mergedDerived = { ...mergedDerived, ...trait.derived }
      }
    }
  }

  // Compile schemas to JSON Schema
  const specSchema = adapter.toJsonSchema(entity.spec)
  const statusSchema = entity.status
    ? adapter.toJsonSchema(entity.status)
    : { type: "object", properties: {} }
  const metadataSchema =
    entity.metadata === "standard"
      ? {
          type: "object" as const,
          properties: {
            labels: {
              type: "object" as const,
              additionalProperties: { type: "string" as const },
            },
            annotations: {
              type: "object" as const,
              additionalProperties: { type: "string" as const },
            },
            tags: {
              type: "array" as const,
              items: { type: "string" as const },
            },
          },
        }
      : entity.metadata
        ? adapter.toJsonSchema(entity.metadata)
        : { type: "object" as const, properties: {} }

  // Compile links to LinkIR
  const linksIR: Record<string, LinkIR> = {}
  for (const [name, linkDef] of Object.entries(mergedLinks)) {
    linksIR[name] = {
      cardinality: linkDef.cardinality,
      target: linkDef.target,
      fk: linkDef.fk,
      targetFk: linkDef.targetFk,
      junction: linkDef.junction,
      polymorphic: linkDef.polymorphic,
      inverse: linkDef.inverse,
      cascade: linkDef.cascade,
      required: linkDef.required,
      description: linkDef.description,
    }
  }

  // Compile actions to ActionIR
  const actionsIR: Record<string, ActionIR> = {}
  if (entity.actions) {
    for (const [name, action] of Object.entries(entity.actions)) {
      actionsIR[name] = {
        description: action.description,
        parameters: action.parameters
          ? detectAdapter(action.parameters).toJsonSchema(action.parameters)
          : { type: "object" },
        returns: action.returns
          ? detectAdapter(action.returns).toJsonSchema(action.returns)
          : undefined,
        edits: action.edits,
        targets: action.targets,
        permission: action.permission,
        dryRun: action.dryRun ?? true,
      }
    }
  }

  // Compile derived to DerivedIR
  const derivedIR: Record<string, DerivedIR> = {}
  for (const [name, derived] of Object.entries(mergedDerived ?? {})) {
    const { fn, ...serializableComputation } = derived.computation as any
    derivedIR[name] = {
      type: derived.type,
      description: derived.description,
      computation: fn
        ? { kind: (derived.computation as any).kind, hasFunction: true }
        : serializableComputation,
      materialized: derived.materialized ?? false,
    }
  }

  return {
    kind: entity.kind,
    namespace: entity.namespace,
    prefix: entity.prefix,
    plural: entity.plural ?? pluralize(entity.kind),
    description: entity.description,
    traits: traitNames,
    schemas: {
      spec: specSchema,
      status: statusSchema,
      metadata: metadataSchema as JsonSchema,
    },
    annotations: mergedAnnotations,
    identity: {
      slugScope: entity.identity?.slug?.scope ?? "global",
      titleProperty: entity.identity?.titleProperty,
    },
    reconciliation:
      entity.reconciliation === true ||
      typeof entity.reconciliation === "object",
    bitemporal: entity.bitemporal ?? false,
    softDelete: entity.softDelete ?? false,
    links: linksIR,
    derived: derivedIR,
    actions: actionsIR,
    access: entity.access,
    visibility: entity.visibility ?? "normal",
    lifecycle: entity.lifecycle ?? "production",
    icon: entity.icon,
  }
}

/** Compile all entity definitions into a full GraphIR. */
export function compileGraph(
  entities: EntityDefinition[],
  opts?: { traits?: TraitDefinition[] }
): GraphIR {
  // Collect namespaces
  const namespaces: Record<
    string,
    { description?: string; entityKinds: string[] }
  > = {}
  const compiledEntities: Record<string, EntityIR> = {}

  for (const entity of entities) {
    const ir = compileEntity(entity)
    compiledEntities[ir.kind] = ir

    if (!namespaces[ir.namespace]) {
      namespaces[ir.namespace] = { entityKinds: [] }
    }
    namespaces[ir.namespace].entityKinds.push(ir.kind)
  }

  // Compile traits
  const traitsIR: Record<string, TraitIR> = {}
  if (opts?.traits) {
    for (const trait of opts.traits) {
      traitsIR[trait.name] = {
        name: trait.name,
        description: trait.description,
        annotations: trait.annotations,
        links: trait.links
          ? Object.fromEntries(
              Object.entries(trait.links).map(([k, v]) => [k, v as LinkIR])
            )
          : undefined,
        derived: trait.derived
          ? Object.fromEntries(
              Object.entries(trait.derived).map(([k, v]) => [
                k,
                {
                  type: v.type,
                  computation: { kind: (v.computation as any).kind },
                  materialized: v.materialized ?? false,
                },
              ])
            )
          : undefined,
        requires: trait.requires,
      }
    }
  }

  return {
    $schema: "https://graph.dev/ir/v1",
    version: "1.0",
    namespaces,
    traits: traitsIR,
    entities: compiledEntities,
  }
}
