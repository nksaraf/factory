import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import * as previewSvc from "../../services/preview/preview.service"

/**
 * Unauthenticated CI integration endpoints for preview deployments.
 * Mounted outside the auth boundary so GitHub Actions can call them.
 */
export function previewCiController(db: Database) {
  return new Elysia({ prefix: "/api/v1/factory/build/ci/previews" })

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
      params: t.Object({ slug: t.String() }),
      body: t.Object({ imageRef: t.String() }),
      detail: { tags: ["CI"], summary: "Deliver built image for preview (unauthenticated, CI use)" },
    })
}
