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
    .patch("/:slug/status", async ({ params, body, set }) => {
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

    // --- Delete (expire + cleanup) ---
    .delete("/:slug", async ({ params, set }) => {
      const row = await previewSvc.getPreviewBySlug(db, params.slug)
      if (!row) { set.status = 404; return { success: false, error: "not_found" } }
      await previewSvc.expirePreview(db, row.previewId)
      return { success: true, data: { previewId: row.previewId } }
    }, {
      params: PreviewModel.slugParams,
      detail: { tags: ["Preview"], summary: "Delete preview" },
    })
}
