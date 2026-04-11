import type { StandaloneType, TemplateVars, GeneratedFile } from "../types.js"
import { generate as webApp } from "./web-app.js"
import { generate as nodeApi } from "./node-api.js"
import { generate as javaApi } from "./java-api.js"
import { generate as pythonApi } from "./python-api.js"
import { generate as nodeLib } from "./node-lib.js"
import { generate as javaLib } from "./java-lib.js"
import { generate as pythonLib } from "./python-lib.js"
import { generate as uiLib } from "./ui-lib.js"

const generators: Record<
  StandaloneType,
  (vars: TemplateVars) => GeneratedFile[]
> = {
  "web-app": webApp,
  "node-api": nodeApi,
  "java-api": javaApi,
  "python-api": pythonApi,
  "node-lib": nodeLib,
  "java-lib": javaLib,
  "python-lib": pythonLib,
  "ui-lib": uiLib,
}

export function generate(
  type: StandaloneType,
  vars: TemplateVars
): GeneratedFile[] {
  const gen = generators[type]
  if (!gen) throw new Error(`Unknown standalone type: ${type}`)
  return gen(vars)
}
