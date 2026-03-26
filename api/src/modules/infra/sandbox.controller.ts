import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { SandboxModel } from "./sandbox.model"
import * as sandboxSvc from "../../services/sandbox/sandbox.service"
import type { CreateSandboxInput } from "../../services/sandbox/sandbox.service"
import * as templateSvc from "../../services/sandbox/sandbox-template.service"

export function sandboxController(db: Database) {
  return new Elysia({ prefix: "/sandbox" })

    // --- Sandbox lifecycle ---
    .post("/sandboxes", async ({ body }) => ({
      success: true,
      data: await sandboxSvc.createSandbox(db, body as CreateSandboxInput),
    }), {
      body: SandboxModel.createSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Create sandbox" },
    })
    .get("/sandboxes", async ({ query }) => ({
      success: true,
      data: await sandboxSvc.listSandboxes(db, query),
    }), {
      query: SandboxModel.listSandboxesQuery,
      detail: { tags: ["Sandbox"], summary: "List sandboxes" },
    })
    .get("/sandboxes/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get sandbox" },
    })
    .delete("/sandboxes/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await sandboxSvc.deleteSandbox(db, params.id)
      return { success: true, data: { sandboxId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox" },
    })
    .post("/sandboxes/:id/start", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.startSandbox(db, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Start sandbox" },
    })
    .post("/sandboxes/:id/stop", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.stopSandbox(db, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Stop sandbox" },
    })
    .post("/sandboxes/:id/resize", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.resizeSandbox(db, params.id, body) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.resizeSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Resize sandbox" },
    })
    .post("/sandboxes/:id/extend", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.extendSandbox(db, params.id, body.additionalMinutes) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.extendSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Extend sandbox TTL" },
    })

    // --- Snapshots ---
    .get("/sandboxes/:id/snapshots", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.listSnapshots(db, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "List snapshots for sandbox" },
    })
    .post("/sandboxes/:id/snapshots", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.snapshotSandbox(db, params.id, body) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.createSnapshotBody,
      detail: { tags: ["Sandbox"], summary: "Create snapshot" },
    })
    .get("/sandbox-snapshots/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get snapshot" },
    })
    .delete("/sandbox-snapshots/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await sandboxSvc.deleteSnapshot(db, params.id)
      return { success: true, data: { snapshotId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete snapshot" },
    })
    .post("/sandbox-snapshots/:id/restore", async ({ params, set }) => {
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.restoreSandbox(db, snap.sandboxId, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Restore sandbox to snapshot" },
    })
    .post("/sandbox-snapshots/:id/clone", async ({ params, body, set }) => {
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.cloneSandbox(db, params.id, body as { name: string; ownerId: string; ownerType: "user" | "agent" }) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.cloneSnapshotBody,
      detail: { tags: ["Sandbox"], summary: "Clone sandbox from snapshot" },
    })

    // --- Templates ---
    .get("/sandbox-templates", async ({ query }) => ({
      success: true,
      data: await templateSvc.listTemplates(db, query),
    }), {
      query: SandboxModel.listTemplatesQuery,
      detail: { tags: ["Sandbox"], summary: "List sandbox templates" },
    })
    .get("/sandbox-templates/:id", async ({ params, set }) => {
      const row = await templateSvc.getTemplate(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get sandbox template" },
    })
    .post("/sandbox-templates", async ({ body }) => ({
      success: true,
      data: await templateSvc.createTemplate(db, body as Parameters<typeof templateSvc.createTemplate>[1]),
    }), {
      body: SandboxModel.createTemplateBody,
      detail: { tags: ["Sandbox"], summary: "Create sandbox template" },
    })
    .delete("/sandbox-templates/:id", async ({ params, set }) => {
      const row = await templateSvc.getTemplate(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await templateSvc.deleteTemplate(db, params.id)
      return { success: true, data: { templateId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox template" },
    })
}
