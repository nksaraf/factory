import type { ProductModels } from "./model"

export abstract class ProductService {
  static listModules() {
    return { data: [], total: 0 }
  }

  static getModule(name: string) {
    return { data: null, name }
  }

  static registerModule(body: ProductModels["registerModuleBody"]) {
    return { data: { ...body, moduleId: null } }
  }

  static listWorkItems() {
    return { data: [], total: 0 }
  }

  static createWorkItem(body: ProductModels["createWorkItemBody"]) {
    return { data: { ...body, workItemId: null } }
  }

  static updateWorkItem(
    id: string,
    body: ProductModels["updateWorkItemBody"]
  ) {
    return { data: { id, ...body } }
  }
}
