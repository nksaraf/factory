import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import * as memorySvc from "./memory.model";

// ---------------------------------------------------------------------------
// Validation models
// ---------------------------------------------------------------------------

const MemoryModel = {
  idParams: t.Object({ id: t.String() }),
  createBody: t.Object({
    orgId: t.String(),
    layer: t.String(),
    layerEntityId: t.String(),
    type: t.String(),
    content: t.String(),
    tags: t.Optional(t.Array(t.Unknown())),
    sourceJobId: t.Optional(t.String()),
    sourceAgentId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    confidence: t.Optional(t.Number()),
    approvedByPrincipalId: t.Optional(t.String()),
  }),
  updateBody: t.Object({
    content: t.Optional(t.String()),
    type: t.Optional(t.String()),
    tags: t.Optional(t.Array(t.Unknown())),
    status: t.Optional(t.String()),
    confidence: t.Optional(t.Number()),
  }),
  listQuery: t.Object({
    orgId: t.Optional(t.String()),
    layer: t.Optional(t.String()),
    layerEntityId: t.Optional(t.String()),
    type: t.Optional(t.String()),
    status: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
  approveBody: t.Object({
    approvedByPrincipalId: t.String(),
  }),
  supersedeBody: t.Object({
    replacementId: t.Optional(t.String()),
  }),
  promoteBody: t.Object({
    targetOrgId: t.String(),
  }),
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function memoryController(db: Database) {
  return new Elysia({ prefix: "/memory" })

    .get("/memories", async ({ query }) => ({
      success: true,
      ...(await memorySvc.listMemories(db, query)),
    }), {
      query: MemoryModel.listQuery,
      detail: { tags: ["Memory"], summary: "List memories" },
    })
    .post("/memories", async ({ body }) => ({
      success: true,
      data: await memorySvc.createMemory(db, body),
    }), {
      body: MemoryModel.createBody,
      detail: { tags: ["Memory"], summary: "Create memory" },
    })
    .get("/memories/:id", async ({ params, set }) => {
      const data = await memorySvc.getMemory(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      detail: { tags: ["Memory"], summary: "Get memory" },
    })
    .post("/memories/:id/update", async ({ params, body, set }) => {
      const data = await memorySvc.updateMemory(db, params.id, body);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      body: MemoryModel.updateBody,
      detail: { tags: ["Memory"], summary: "Update memory" },
    })
    .post("/memories/:id/delete", async ({ params, set }) => {
      const data = await memorySvc.archiveMemory(db, params.id);
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      detail: { tags: ["Memory"], summary: "Archive memory" },
    })
    .post("/memories/:id/approve", async ({ params, body, set }) => {
      const data = await memorySvc.approveMemory(
        db,
        params.id,
        body.approvedByPrincipalId,
      );
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      body: MemoryModel.approveBody,
      detail: { tags: ["Memory"], summary: "Approve proposed memory" },
    })
    .post("/memories/:id/supersede", async ({ params, body, set }) => {
      const data = await memorySvc.supersedeMemory(
        db,
        params.id,
        body.replacementId,
      );
      if (!data) {
        set.status = 404;
        return { success: false, error: "not_found" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      body: MemoryModel.supersedeBody,
      detail: { tags: ["Memory"], summary: "Supersede memory" },
    })
    .post("/memories/:id/promote", async ({ params, body, set }) => {
      const data = await memorySvc.promoteMemory(
        db,
        params.id,
        body.targetOrgId,
      );
      if (!data) {
        set.status = 400;
        return { success: false, error: "cannot_promote" };
      }
      return { success: true, data };
    }, {
      params: MemoryModel.idParams,
      body: MemoryModel.promoteBody,
      detail: { tags: ["Memory"], summary: "Promote team memory to org" },
    });
}
