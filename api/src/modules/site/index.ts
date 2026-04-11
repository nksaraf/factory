import { Elysia } from "elysia"
import type { SiteReconciler } from "./reconciler"
import { SiteModel } from "./model"

export function siteController(reconciler: SiteReconciler) {
  return new Elysia({ prefix: "/site" })

    .get(
      "/status",
      () => {
        return { data: reconciler.getStatus() }
      },
      {
        detail: { tags: ["Site"], summary: "Site agent status" },
      }
    )

    .post(
      "/manifest",
      async ({ body }) => {
        const result = await reconciler.pushManifest(body)
        return { data: result }
      },
      {
        body: SiteModel.pushManifestBody,
        detail: { tags: ["Site"], summary: "Push manifest (air-gapped)" },
      }
    )

    .post(
      "/reconcile",
      async () => {
        const manifest = reconciler.getCurrentManifest()
        if (!manifest) {
          return {
            error: "No manifest loaded — push one first or wait for poll",
          }
        }
        const result = await reconciler.pushManifest(manifest)
        return { data: result }
      },
      {
        detail: { tags: ["Site"], summary: "Force re-reconcile" },
      }
    )

    .get(
      "/crds",
      async () => {
        const crds = await reconciler.getCRDs()
        return { data: crds }
      },
      {
        detail: { tags: ["Site"], summary: "Currently applied CRDs" },
      }
    )
}
