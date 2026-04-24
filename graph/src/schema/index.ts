export type {
  JsonSchema,
  PropertyAnnotation,
  PropertyAnnotations,
  LinkDefinition,
  ActionDefinition,
  DerivedPropertyDefinition,
  TraitDefinition,
  EntityDefinition,
  AccessDefinition,
} from "./types"

export type {
  GraphIR,
  EntityIR,
  TraitIR,
  LinkIR,
  ActionIR,
  DerivedIR,
  StructIR,
  SharedPropertyIR,
  ValueTypeIR,
  InterfaceIR,
} from "./ir"

export { defineEntity, compileEntity, compileGraph } from "./entity"
export { defineStruct, compileStruct } from "./struct"
export type { StructDefinition } from "./struct"
export { defineProperty, compileSharedProperty, property } from "./property"
export type { SharedPropertyDefinition } from "./property"
export { defineValueType, compileValueType } from "./value"
export type { ValueTypeDefinition } from "./value"
export { defineInterface, compileInterface } from "./interface"
export type { InterfaceDefinition } from "./interface"
export {
  defineTrait,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Lifecycled,
  Addressable,
} from "./trait"
export { link } from "./link"
export {
  detectAdapter,
  createZodAdapter,
  createRawAdapter,
  type SchemaAdapter,
  type ValidationResult,
} from "./schema-adapter"
