import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { SandboxModel } from "./sandbox.model"
import * as sandboxSvc from "../../services/sandbox/sandbox.service"
import type { CreateSandboxInput } from "../../services/sandbox/sandbox.service"
import * as templateSvc from "../../services/sandbox/sandbox-template.service"
import type { Reconciler } from "../../reconciler/reconciler"
import { logger } from "../../logger"

export function sandboxController(db: Database, getReconciler?: () => Reconciler | null) {
  function triggerReconcile(sandboxId: string) {
    const reconciler = getReconciler?.()
    if (!reconciler) return
    reconciler.reconcileSandbox(sandboxId).catch((err) => {
      logger.error({ sandboxId, error: String(err), stack: err?.stack }, "Background sandbox reconciliation failed")
    })
  }

  function triggerSnapshotCreate(snapshotId: string) {
    const reconciler = getReconciler?.()
    if (!reconciler) return
    reconciler.reconcileSnapshotCreate(snapshotId).catch((err) => {
      logger.error({ snapshotId, error: String(err), stack: err?.stack }, "Background snapshot creation failed")
    })
  }

  function triggerSnapshotRestore(sandboxId: string, snapshotId: string) {
    const reconciler = getReconciler?.()
    if (!reconciler) return
    reconciler.reconcileSnapshotRestore(sandboxId, snapshotId).catch((err) => {
      logger.error({ sandboxId, snapshotId, error: String(err), stack: err?.stack }, "Background snapshot restore failed")
    })
  }

  function triggerSnapshotDelete(snapshotId: string) {
    const reconciler = getReconciler?.()
    if (!reconciler) return
    reconciler.reconcileSnapshotDelete(snapshotId).catch((err) => {
      logger.error({ snapshotId, error: String(err), stack: err?.stack }, "Background snapshot deletion failed")
    })
  }

  return new Elysia({ prefix: "/sandboxes" })

    // --- Sandbox CRUD ---
    .post("/", async ({ body }) => {
      const sbx = await sandboxSvc.createSandbox(db, body as CreateSandboxInput)
      triggerReconcile(sbx.sandboxId)
      return { success: true, data: sbx }
    }, {
      body: SandboxModel.createSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Create sandbox" },
    })
    .get("/", async ({ query }) => ({
      success: true,
      data: await sandboxSvc.listSandboxes(db, query),
    }), {
      query: SandboxModel.listSandboxesQuery,
      detail: { tags: ["Sandbox"], summary: "List sandboxes" },
    })
    .get("/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get sandbox" },
    })
    .delete("/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await sandboxSvc.deleteSandbox(db, params.id)
      triggerReconcile(params.id)
      return { success: true, data: { sandboxId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox" },
    })

    // --- Lifecycle ---
    .post("/:id/start", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      const result = await sandboxSvc.startSandbox(db, params.id)
      triggerReconcile(params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Start sandbox" },
    })
    .post("/:id/stop", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      const result = await sandboxSvc.stopSandbox(db, params.id)
      triggerReconcile(params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Stop sandbox" },
    })
    .post("/:id/resize", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.resizeSandbox(db, params.id, body) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.resizeSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Resize sandbox" },
    })
    .post("/:id/extend", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.extendSandbox(db, params.id, body.additionalMinutes) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.extendSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Extend sandbox TTL" },
    })

    // --- Snapshots (nested under sandbox) ---
    .get("/:id/snapshots", async ({ params, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.listSnapshots(db, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "List snapshots for sandbox" },
    })
    .post("/:id/snapshots", async ({ params, body, set }) => {
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      const snap = await sandboxSvc.snapshotSandbox(db, params.id, body)
      triggerSnapshotCreate(snap.sandboxSnapshotId)
      return { success: true, data: snap }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.createSnapshotBody,
      detail: { tags: ["Sandbox"], summary: "Create snapshot" },
    })

    // --- Snapshots (by snapshot ID) ---
    .get("/snapshots/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get snapshot" },
    })
    .delete("/snapshots/:id", async ({ params, set }) => {
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await sandboxSvc.deleteSnapshot(db, params.id)
      triggerSnapshotDelete(params.id)
      return { success: true, data: { snapshotId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete snapshot" },
    })
    .post("/snapshots/:id/restore", async ({ params, set }) => {
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      const result = await sandboxSvc.restoreSandbox(db, snap.sandboxId, params.id)
      triggerSnapshotRestore(snap.sandboxId, params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Restore sandbox to snapshot" },
    })
    .post("/snapshots/:id/clone", async ({ params, body, set }) => {
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: await sandboxSvc.cloneSandbox(db, params.id, body as { name: string; ownerId: string; ownerType: "user" | "agent" }) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.cloneSnapshotBody,
      detail: { tags: ["Sandbox"], summary: "Clone sandbox from snapshot" },
    })

    // --- Templates ---
    .get("/templates", async ({ query }) => ({
      success: true,
      data: await templateSvc.listTemplates(db, query),
    }), {
      query: SandboxModel.listTemplatesQuery,
      detail: { tags: ["Sandbox"], summary: "List sandbox templates" },
    })
    .get("/templates/:id", async ({ params, set }) => {
      const row = await templateSvc.getTemplate(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get sandbox template" },
    })
    .post("/templates", async ({ body }) => ({
      success: true,
      data: await templateSvc.createTemplate(db, body as Parameters<typeof templateSvc.createTemplate>[1]),
    }), {
      body: SandboxModel.createTemplateBody,
      detail: { tags: ["Sandbox"], summary: "Create sandbox template" },
    })
    .delete("/templates/:id", async ({ params, set }) => {
      const row = await templateSvc.getTemplate(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await templateSvc.deleteTemplate(db, params.id)
      return { success: true, data: { templateId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox template" },
    })
}
