import type { StandaloneType, TemplateVars, GeneratedFile } from "./types"
import { generate as generateProjectFiles } from "./project"
import { generate as generateStandaloneFiles } from "./standalone/index"

// New composable type model
export type {
  InitType,
  Runtime,
  Framework,
  ComponentSpec,
  FrameworkEntry,
  TemplateVars,
  GeneratedFile,
} from "./types"
export {
  INIT_TYPES,
  FRAMEWORKS,
  parseLegacyType,
  resolveTemplateKey,
  getFrameworksForTypeAndRuntime,
  getRuntimesForType,
  toJavaPackage,
} from "./types"

// Resource templates
export {
  generateResource,
  isResourceName,
  RESOURCE_CATALOG,
} from "./resource/index"
export type {
  ResourceName,
  ResourceCatalogType,
  ResourceEntry,
} from "./resource/index"

// Legacy exports kept for internal use and tests
export type { StandaloneType } from "./types"
export { STANDALONE_TYPES } from "./types"
export { componentLabels, resourceLabels, labelsToYaml } from "./compose-labels"

export function generateProject(vars: TemplateVars): GeneratedFile[] {
  return generateProjectFiles(vars)
}

export function generateStandalone(
  type: StandaloneType,
  vars: TemplateVars
): GeneratedFile[] {
  return generateStandaloneFiles(type, vars)
}
