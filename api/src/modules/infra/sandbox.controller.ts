import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import type { FactoryAuthzClient } from "../../lib/authz-client"
import type { AuthUser } from "../../plugins/auth.plugin"
import { SandboxModel } from "./sandbox.model"
import * as sandboxSvc from "../../services/sandbox/sandbox.service"
import type { CreateSandboxInput } from "../../services/sandbox/sandbox.service"
import * as templateSvc from "../../services/sandbox/sandbox-template.service"
import type { Reconciler } from "../../reconciler/reconciler"
import { logger } from "../../logger"

export function sandboxController(
  db: Database,
  authzClient: FactoryAuthzClient | null,
  getReconciler?: () => Reconciler | null,
) {
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

  /** Extract principalId from the Elysia context (populated by auth plugins). */
  function getPrincipal(ctx: unknown): string {
    return (ctx as { principalId?: string }).principalId ?? ""
  }

  /** Extract organizationId from the Elysia context (populated by authPlugin). */
  function getOrgId(ctx: unknown): string {
    return ((ctx as { user?: AuthUser }).user?.organizationId) ?? ""
  }

  /** Check if the principal can perform `action` on sandbox `resourceId`. */
  async function checkSandboxPermission(
    ctx: unknown,
    action: string,
    resourceId: string,
  ): Promise<boolean> {
    if (!authzClient) return true
    const principal = getPrincipal(ctx)
    if (!principal) return false
    return authzClient.checkPermission({
      principal,
      action,
      resourceType: "sandbox",
      resourceId,
    })
  }

  return new Elysia({ prefix: "/sandboxes" })

    // --- Sandbox CRUD ---
    .post("/", async (ctx) => {
      const { body } = ctx
      const sbx = await sandboxSvc.createSandbox(db, body as CreateSandboxInput)
      // Sync resource to authz service
      if (authzClient) {
        const orgId = getOrgId(ctx)
        authzClient.registerResource({
          id: sbx.sandboxId,
          resourceTypeId: "sandbox",
          orgId,
          createdBy: body.ownerId,
        }).catch((err) => logger.warn({ err, sandboxId: sbx.sandboxId }, "authz resource register failed"))
      }
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
    .get("/:id", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "read", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get sandbox" },
    })
    .post("/:id/delete", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "delete", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      await sandboxSvc.deleteSandbox(db, params.id)
      if (authzClient) {
        authzClient.deleteResource(row.sandboxId).catch((err) =>
          logger.warn({ err, sandboxId: row.sandboxId }, "authz resource delete failed"))
      }
      triggerReconcile(params.id)
      return { success: true, data: { sandboxId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox" },
    })
    .get("/:id/health", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "read", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      const reconciler = getReconciler?.()
      if (!reconciler) {
        return { success: true, data: { status: row.healthStatus ?? "unknown", checkedAt: row.healthCheckedAt } }
      }
      try {
        const health = await reconciler.reconcileSandboxHealth(row.sandboxId)
        return { success: true, data: health }
      } catch (err: any) {
        logger.error({ sandboxId: params.id, error: String(err) }, "Health check failed")
        return { success: true, data: { status: row.healthStatus ?? "unknown", checkedAt: row.healthCheckedAt } }
      }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Check sandbox health" },
    })

    // --- Lifecycle ---
    .post("/:id/start", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      const result = await sandboxSvc.startSandbox(db, params.id)
      triggerReconcile(params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Start sandbox" },
    })
    .post("/:id/stop", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      const result = await sandboxSvc.stopSandbox(db, params.id)
      triggerReconcile(params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Stop sandbox" },
    })
    .post("/:id/resize", async (ctx) => {
      const { params, body, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      return { success: true, data: await sandboxSvc.resizeSandbox(db, params.id, body) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.resizeSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Resize sandbox" },
    })
    .post("/:id/extend", async (ctx) => {
      const { params, body, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      return { success: true, data: await sandboxSvc.extendSandbox(db, params.id, body.additionalMinutes) }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.extendSandboxBody,
      detail: { tags: ["Sandbox"], summary: "Extend sandbox TTL" },
    })

    // --- Snapshots (nested under sandbox) ---
    .get("/:id/snapshots", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "read", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      return { success: true, data: await sandboxSvc.listSnapshots(db, params.id) }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "List snapshots for sandbox" },
    })
    .post("/:id/snapshots", async (ctx) => {
      const { params, body, set } = ctx
      const row = await sandboxSvc.getSandbox(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      const snap = await sandboxSvc.snapshotSandbox(db, params.id, body)
      triggerSnapshotCreate(snap.sandboxSnapshotId)
      return { success: true, data: snap }
    }, {
      params: SandboxModel.idParams,
      body: SandboxModel.createSnapshotBody,
      detail: { tags: ["Sandbox"], summary: "Create snapshot" },
    })

    // --- Snapshots (by snapshot ID) ---
    .get("/snapshots/:id", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "read", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      return { success: true, data: row }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Get snapshot" },
    })
    .post("/snapshots/:id/delete", async (ctx) => {
      const { params, set } = ctx
      const row = await sandboxSvc.getSnapshot(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "delete", row.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      await sandboxSvc.deleteSnapshot(db, params.id)
      triggerSnapshotDelete(params.id)
      return { success: true, data: { snapshotId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete snapshot" },
    })
    .post("/snapshots/:id/restore", async (ctx) => {
      const { params, set } = ctx
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "update", snap.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
      const result = await sandboxSvc.restoreSandbox(db, snap.sandboxId, params.id)
      triggerSnapshotRestore(snap.sandboxId, params.id)
      return { success: true, data: result }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Restore sandbox to snapshot" },
    })
    .post("/snapshots/:id/clone", async (ctx) => {
      const { params, body, set } = ctx
      const snap = await sandboxSvc.getSnapshot(db, params.id)
      if (!snap) { set.status = 404; return { success: false, error: "not_found" } }
      if (!(await checkSandboxPermission(ctx, "read", snap.sandboxId))) {
        set.status = 403; return { success: false, error: "forbidden" }
      }
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
    .post("/templates/:id/delete", async ({ params, set }) => {
      const row = await templateSvc.getTemplate(db, params.id)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await templateSvc.deleteTemplate(db, params.id)
      return { success: true, data: { templateId: params.id } }
    }, {
      params: SandboxModel.idParams,
      detail: { tags: ["Sandbox"], summary: "Delete sandbox template" },
    })
}
