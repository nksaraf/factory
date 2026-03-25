import { Elysia } from "elysia"

import { ProductModel } from "./model"
import { ProductService } from "./service"

export const productController = new Elysia({ prefix: "/api/v1/product" })
  .get("/modules", () => ProductService.listModules(), {
    detail: { tags: ["Product"], summary: "List modules" },
  })
  .get(
    "/modules/:name",
    ({ params }) => ProductService.getModule(params.name),
    {
      params: ProductModel.moduleNameParams,
      detail: { tags: ["Product"], summary: "Get module" },
    }
  )
  .post(
    "/modules",
    ({ body }) => ProductService.registerModule(body),
    {
      body: ProductModel.registerModuleBody,
      detail: { tags: ["Product"], summary: "Register module" },
    }
  )
  .get("/work-items", () => ProductService.listWorkItems(), {
    detail: { tags: ["Product"], summary: "List work items" },
  })
  .post(
    "/work-items",
    ({ body }) => ProductService.createWorkItem(body),
    {
      body: ProductModel.createWorkItemBody,
      detail: { tags: ["Product"], summary: "Create work item" },
    }
  )
  .put(
    "/work-items/:id",
    ({ params, body }) => ProductService.updateWorkItem(params.id, body),
    {
      params: ProductModel.workItemIdParams,
      body: ProductModel.updateWorkItemBody,
      detail: { tags: ["Product"], summary: "Update work item" },
    }
  )
