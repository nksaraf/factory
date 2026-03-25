import type { BuildModels } from "./model"

export abstract class BuildService {
  static triggerBuild(body: BuildModels["triggerBuildBody"]) {
    return { data: { buildId: null, ...body } }
  }

  static getBuild(id: string) {
    return { data: null, id }
  }

  static listArtifacts() {
    return { data: [], total: 0 }
  }

  static getArtifact(id: string) {
    return { data: null, id }
  }

  static listModuleVersions(module: string) {
    return { data: [], module }
  }

  static registerModuleVersion(
    name: string,
    body: BuildModels["registerVersionBody"]
  ) {
    return { data: { module: name, ...body, moduleVersionId: null } }
  }
}
