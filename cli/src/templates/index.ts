import type { StandaloneType, TemplateVars, GeneratedFile } from "./types";
import { generate as generateProjectFiles } from "./project";
import { generate as generateStandaloneFiles } from "./standalone/index";

export type { InitMode, StandaloneType, TemplateVars, GeneratedFile } from "./types";
export { STANDALONE_TYPES, toJavaPackage } from "./types";
export { componentLabels, resourceLabels, labelsToYaml } from "./compose-labels";

export function generateProject(vars: TemplateVars): GeneratedFile[] {
  return generateProjectFiles(vars);
}

export function generateStandalone(type: StandaloneType, vars: TemplateVars): GeneratedFile[] {
  return generateStandaloneFiles(type, vars);
}
