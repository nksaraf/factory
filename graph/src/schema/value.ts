/**
 * Value types — semantic wrappers over primitives (EmailAddress over string,
 * USD over number, etc.). Mirrors Foundry's Value Type. They carry display
 * hints + validation predicates so consumers can render/validate uniformly.
 */

import type { ValueTypeIR } from "./ir"

export interface ValueTypeDefinition {
  readonly __kind: "valueType"
  readonly name: string
  readonly base: "string" | "number" | "boolean" | "date"
  readonly description?: string
  readonly display?: Record<string, unknown>
  readonly validation?: Record<string, unknown>
}

export interface DefineValueTypeOptions {
  readonly base: "string" | "number" | "boolean" | "date"
  readonly description?: string
  readonly display?: Record<string, unknown>
  readonly validation?: Record<string, unknown>
}

export function defineValueType(
  name: string,
  opts: DefineValueTypeOptions
): ValueTypeDefinition {
  return {
    __kind: "valueType",
    name,
    base: opts.base,
    description: opts.description,
    display: opts.display,
    validation: opts.validation,
  }
}

export function compileValueType(def: ValueTypeDefinition): ValueTypeIR {
  return {
    name: def.name,
    base: def.base,
    description: def.description,
    display: def.display,
    validation: def.validation,
  }
}
