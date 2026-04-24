/**
 * Struct types — composite typed values (addresses, money, ranges, etc.).
 *
 * Mirrors Palantir Foundry's Struct Type. A struct has a name, a set of
 * fields (as a JSON schema), and optionally a `mainField` hint for display.
 * Structs are referenced by name from entity properties and link properties.
 */

import type { z } from "zod"
import type { JsonSchema } from "./types"
import type { StructIR } from "./ir"
import { detectAdapter } from "./schema-adapter"

export interface StructDefinition<TFields = unknown> {
  readonly __kind: "struct"
  readonly name: string
  readonly description?: string
  readonly fields: z.ZodType<TFields> | JsonSchema
  readonly mainField?: string
}

export interface DefineStructOptions<TFields> {
  readonly description?: string
  readonly fields: z.ZodType<TFields> | JsonSchema
  readonly mainField?: string
}

export function defineStruct<TFields>(
  name: string,
  opts: DefineStructOptions<TFields>
): StructDefinition<TFields> {
  return {
    __kind: "struct",
    name,
    description: opts.description,
    fields: opts.fields,
    mainField: opts.mainField,
  }
}

export function compileStruct(def: StructDefinition<unknown>): StructIR {
  const adapter = detectAdapter(def.fields)
  const fieldsSchema = adapter.toJsonSchema(def.fields)
  return {
    name: def.name,
    description: def.description,
    fields: fieldsSchema,
    mainField: def.mainField,
  }
}
