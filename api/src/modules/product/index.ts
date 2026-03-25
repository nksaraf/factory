import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { ProductModel } from "./model"
import * as productSvc from "./service"
import * as wtSvc from "../../services/product/work-tracker.service"

export function productController(db: Database) {
  return new Elysia({ prefix: "/product" })

    // --- Modules ---
    .get("/module", async () => ({
      success: true,
      ...(await productSvc.listModules(db)),
    }), {
      detail: { tags: ["Product"], summary: "List modules" },
    })
    .get("/module/:name", async ({ params, set }) => {
      const result = await productSvc.getModule(db, params.name)
      if (!result.data) {
        set.status = 404
        return { success: false, error: "not_found" }
      }
      return { success: true, ...result }
    }, {
      params: ProductModel.moduleNameParams,
      detail: { tags: ["Product"], summary: "Get module" },
    })
    .post("/module", async ({ body }) => ({
      success: true,
      ...(await productSvc.registerModule(db, body)),
    }), {
      body: ProductModel.registerModuleBody,
      detail: { tags: ["Product"], summary: "Register module" },
    })

    // --- Work Items ---
    .get("/work-item", async () => ({
      success: true,
      ...(await productSvc.listWorkItems(db)),
    }), {
      detail: { tags: ["Product"], summary: "List work items" },
    })
    .post("/work-item", async ({ body }) => ({
      success: true,
      ...(await productSvc.createWorkItem(db, body)),
    }), {
      body: ProductModel.createWorkItemBody,
      detail: { tags: ["Product"], summary: "Create work item" },
    })
    .put("/work-item/:id", async ({ params, body }) => ({
      success: true,
      ...(await productSvc.updateWorkItem(db, params.id, body)),
    }), {
      params: ProductModel.workItemIdParams,
      body: ProductModel.updateWorkItemBody,
      detail: { tags: ["Product"], summary: "Update work item" },
    })
    .post("/work-item/:id/push", async ({ params, body }) => ({
      success: true,
      data: await wtSvc.pushWorkItem(db, params.id, body.workTrackerProviderId),
    }), {
      params: ProductModel.workItemIdParams,
      body: ProductModel.pushWorkItemBody,
      detail: { tags: ["Product"], summary: "Push work item to external tracker" },
    })
    .post("/work-item/create-epic-from-prd", async ({ body }) => ({
      success: true,
      data: await wtSvc.createEpicFromPrd(
        db,
        body.workTrackerProviderId,
        body.moduleId,
        body.epic,
        body.stories
      ),
    }), {
      body: ProductModel.createEpicFromPrdBody,
      detail: { tags: ["Product"], summary: "Create epic + stories from PRD" },
    })

    // --- Work Tracker Providers ---
    .get("/work-tracker/provider", async ({ query }) => ({
      success: true,
      ...(await wtSvc.listWorkTrackerProviders(db, query)),
    }), {
      query: ProductModel.listWorkTrackerProvidersQuery,
      detail: { tags: ["Product"], summary: "List work tracker providers" },
    })
    .get("/work-tracker/provider/:id", async ({ params, set }) => {
      const row = await wtSvc.getWorkTrackerProvider(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: "not_found" }
      }
      return { success: true, data: row }
    }, {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "Get work tracker provider" },
    })
    .post("/work-tracker/provider", async ({ body }) => ({
      success: true,
      data: await wtSvc.createWorkTrackerProvider(db, body),
    }), {
      body: ProductModel.createWorkTrackerProviderBody,
      detail: { tags: ["Product"], summary: "Create work tracker provider" },
    })
    .patch("/work-tracker/provider/:id", async ({ params, body }) => ({
      success: true,
      data: await wtSvc.updateWorkTrackerProvider(db, params.id, body),
    }), {
      params: ProductModel.idParams,
      body: ProductModel.updateWorkTrackerProviderBody,
      detail: { tags: ["Product"], summary: "Update work tracker provider" },
    })
    .delete("/work-tracker/provider/:id", async ({ params }) => ({
      success: true,
      data: await wtSvc.deleteWorkTrackerProvider(db, params.id),
    }), {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "Delete work tracker provider" },
    })
    .post("/work-tracker/provider/:id/test-connection", async ({ params }) => ({
      success: true,
      ...(await wtSvc.testWorkTrackerConnection(db, params.id)),
    }), {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "Test work tracker connection" },
    })
    .post("/work-tracker/provider/:id/sync", async ({ params }) => ({
      success: true,
      data: await wtSvc.syncWorkTracker(db, params.id),
    }), {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "Trigger work tracker sync" },
    })
    .get("/work-tracker/provider/:id/project", async ({ params }) => ({
      success: true,
      data: await wtSvc.listExternalProjects(db, params.id),
    }), {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "List external projects" },
    })

    // --- Project Mappings ---
    .get("/work-tracker/project-mapping", async ({ query }) => ({
      success: true,
      ...(await wtSvc.listProjectMappings(db, query.workTrackerProviderId)),
    }), {
      query: ProductModel.listProjectMappingsQuery,
      detail: { tags: ["Product"], summary: "List project mappings" },
    })
    .post("/work-tracker/project-mapping", async ({ body }) => ({
      success: true,
      data: await wtSvc.createProjectMapping(db, body),
    }), {
      body: ProductModel.createProjectMappingBody,
      detail: { tags: ["Product"], summary: "Create project mapping" },
    })
    .delete("/work-tracker/project-mapping/:id", async ({ params }) => ({
      success: true,
      data: await wtSvc.deleteProjectMapping(db, params.id),
    }), {
      params: ProductModel.idParams,
      detail: { tags: ["Product"], summary: "Delete project mapping" },
    })
}
