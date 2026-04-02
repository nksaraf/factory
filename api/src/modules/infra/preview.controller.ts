import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { PreviewModel } from "./preview.model"
import * as previewSvc from "../../services/preview/preview.service"

export function previewController(db: Database) {
  return new Elysia({ prefix: "/previews" })

    // --- Create ---
    .post("/", async ({ body }) => {
      const result = await previewSvc.createPreview(db, {
        ...body,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      })
      return { success: true, data: result }
    }, {
      body: PreviewModel.createPreviewBody,
      detail: { tags: ["Preview"], summary: "Create preview" },
    })

    // --- List ---
    .get("/", async ({ query }) => ({
      success: true,
      data: await previewSvc.listPreviews(db, query),
    }), {
      query: PreviewModel.listPreviewsQuery,
      detail: { tags: ["Preview"], summary: "List previews" },
    })

    // --- Get by slug ---
    .get("/:slug", async ({ params, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      return { success: true, data: row }
    }, {
      params: PreviewModel.slugParams,
      detail: { tags: ["Preview"], summary: "Get preview by slug" },
    })

    // --- Update status ---
    .post("/:slug/status/update", async ({ params, body, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      const updated = await previewSvc.updatePreviewStatus(db, row.previewId, {
        ...body,
        lastAccessedAt: new Date(),
      })
      return { success: true, data: updated }
    }, {
      params: PreviewModel.slugParams,
      body: PreviewModel.updatePreviewStatusBody,
      detail: { tags: ["Preview"], summary: "Update preview status" },
    })

    // --- Expire ---
    .post("/:slug/expire", async ({ params, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      const expired = await previewSvc.expirePreview(db, row.previewId)
      return { success: true, data: expired }
    }, {
      params: PreviewModel.slugParams,
      detail: { tags: ["Preview"], summary: "Expire preview" },
    })

    // --- Deliver image (CI integration point) ---
    .post("/:slug/image", async ({ params, body, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (row.status !== "pending_image" && row.status !== "building") {
        set.status = 409
        return {
          success: false,
          error: "invalid_status",
          message: `Preview is in '${row.status}' status, expected 'pending_image'`,
        }
      }
      const updated = await previewSvc.updatePreviewStatus(db, row.previewId, {
        imageRef: body.imageRef,
        status: "deploying",
      })
      return { success: true, data: updated }
    }, {
      params: PreviewModel.slugParams,
      body: PreviewModel.deliverImageBody,
      detail: { tags: ["Preview"], summary: "Deliver built image for preview deployment" },
    })

    // --- Extend TTL ---
    .post("/:slug/extend", async ({ params, body, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      if (row.status === "expired" || row.status === "failed") {
        set.status = 409
        return { success: false, error: "invalid_status", message: `Cannot extend ${row.status} preview` }
      }
      const updated = await previewSvc.extendPreview(db, row.previewId, body.days)
      return { success: true, data: updated }
    }, {
      params: PreviewModel.slugParams,
      body: PreviewModel.extendBody,
      detail: { tags: ["Preview"], summary: "Extend preview TTL" },
    })

    // --- Delete (expire + cleanup) ---
    .post("/:slug/delete", async ({ params, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await previewSvc.expirePreview(db, row.previewId)
      return { success: true, data: { previewId: row.previewId } }
    }, {
      params: PreviewModel.slugParams,
      detail: { tags: ["Preview"], summary: "Delete preview" },
    })
}
