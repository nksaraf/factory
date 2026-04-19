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
  OntologyIR,
  EntityIR,
  TraitIR,
  LinkIR,
  ActionIR,
  DerivedIR,
} from "./ir"

export { defineEntity, compileEntity, compileOntology } from "./entity"
export {
  defineTrait,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Lifecycled,
  Addressable,
  Junction,
} from "./trait"
export { link } from "./link"
export {
  detectAdapter,
  createZodAdapter,
  createRawAdapter,
  type SchemaAdapter,
  type ValidationResult,
} from "./schema-adapter"
