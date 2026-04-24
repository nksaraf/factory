/**
 * Interface types — polymorphic shape contracts. Mirrors Foundry's Interface.
 *
 * An interface is a named bundle of properties that an entity can declare
 * it "implements". Distinct from traits: traits are concrete property+link
 * mixins that an entity inherits, while interfaces are abstract contracts
 * used for cross-entity polymorphism (e.g. HasLifecycle, HasOwner).
 */

import type { z } from "zod"
import type { JsonSchema } from "./types"
import type { InterfaceIR } from "./ir"
import { detectAdapter } from "./schema-adapter"

export interface InterfaceDefinition<T = unknown> {
  readonly __kind: "interface"
  readonly name: string
  readonly description?: string
  readonly properties: z.ZodType<T> | JsonSchema
}

export interface DefineInterfaceOptions<T> {
  readonly description?: string
  readonly properties: z.ZodType<T> | JsonSchema
}

export function defineInterface<T>(
  name: string,
  opts: DefineInterfaceOptions<T>
): InterfaceDefinition<T> {
  return {
    __kind: "interface",
    name,
    description: opts.description,
    properties: opts.properties,
  }
}

export function compileInterface(
  def: InterfaceDefinition<unknown>
): InterfaceIR {
  const adapter = detectAdapter(def.properties)
  return {
    name: def.name,
    description: def.description,
    properties: adapter.toJsonSchema(def.properties),
  }
}
