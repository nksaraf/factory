/**
 * Unauthenticated CI integration endpoint for deploy image notifications.
 * Mounted outside the auth boundary so GitHub Actions can call them.
 *
 * When CI pushes a new image, it notifies Factory which then updates
 * all component deployments that track that image ref, triggering
 * site controllers to pick up the change on their next reconcile cycle.
 */
import type { ComponentDeploymentSpec } from "@smp/factory-shared/schemas/ops"
import { eq, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { componentDeployment } from "../../db/schema/ops"
import { logger } from "../../logger"

export function deployCiController(db: Database) {
  return new Elysia({ prefix: "/api/v1/factory/build/ci" }).post(
    "/image",
    async ({ body, set, request }) => {
      const ciToken = process.env.FACTORY_CI_TOKEN
      if (ciToken) {
        const provided = request.headers.get("x-ci-token")
        if (provided !== ciToken) {
          set.status = 401
          return {
            success: false,
            error: "Invalid or missing x-ci-token header",
          }
        }
      }

      const { imageRef, baseTag, branch, commitSha } = body

      const rows = await db
        .select()
        .from(componentDeployment)
        .where(
          sql`${componentDeployment.spec}->>'trackedImageRef' = ${baseTag}`
        )

      if (rows.length === 0) {
        set.status = 200
        return {
          success: true,
          affected: 0,
          componentDeploymentIds: [],
          message: `No component deployments track ${baseTag}`,
        }
      }

      const updatedIds: string[] = []

      for (const row of rows) {
        const spec = (row.spec ?? {}) as ComponentDeploymentSpec
        const updatedSpec: ComponentDeploymentSpec = {
          ...spec,
          desiredImage: imageRef,
          status: "provisioning",
          statusMessage: `CI image push: ${branch ?? "unknown"}@${commitSha?.slice(0, 8) ?? "unknown"}`,
        }

        await db
          .update(componentDeployment)
          .set({
            spec: updatedSpec,
            updatedAt: new Date(),
          })
          .where(eq(componentDeployment.id, row.id))

        updatedIds.push(row.id)
      }

      logger.info(
        {
          imageRef,
          baseTag,
          branch,
          affected: updatedIds.length,
        },
        "CI image notification: updated component deployments"
      )

      return {
        success: true,
        affected: updatedIds.length,
        componentDeploymentIds: updatedIds,
      }
    },
    {
      body: t.Object({
        imageRef: t.String(),
        baseTag: t.String(),
        branch: t.Optional(t.String()),
        commitSha: t.Optional(t.String()),
      }),
      detail: {
        tags: ["CI"],
        summary: "Notify Factory of a new image push (unauthenticated, CI use)",
      },
    }
  )
}
