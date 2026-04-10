/**
 * Thread Surfaces controller — manual connect/detach endpoints
 * for Slack surface mirroring.
 *
 * POST /thread-surfaces/connect  — manually attach a Slack surface to a thread
 * POST /thread-surfaces/:id/detach — detach a surface
 */
import { eq } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { threadChannel } from "../../db/schema/org-v2"
import { logger } from "../../logger"
import { autoAttachSlackSurface, findThreadBySessionId } from "./slack-surface"

const log = logger.child({ module: "thread-surfaces" })

export function threadSurfacesController(db: Database) {
  return new Elysia({ prefix: "/thread-surfaces" })

    .post(
      "/connect",
      async (ctx) => {
        const { body, set } = ctx
        const principalId = (ctx as any).principalId as string

        if (!principalId) {
          set.status = 401
          return { success: false, error: "unauthenticated" }
        }

        // Resolve thread
        let threadId = body.threadId
        if (!threadId && body.sessionId) {
          const thrd = await findThreadBySessionId(db, body.sessionId)
          if (!thrd) {
            set.status = 404
            return { success: false, error: "thread not found for session" }
          }
          threadId = thrd.id
        }

        if (!threadId) {
          set.status = 400
          return {
            success: false,
            error: "provide threadId or sessionId",
          }
        }

        try {
          const tcId = await autoAttachSlackSurface(
            db,
            threadId,
            principalId,
            "manual",
            { slackChannelId: body.slackChannelId }
          )

          if (!tcId) {
            set.status = 422
            return {
              success: false,
              error:
                "could not attach — no Slack identity or adapter not configured",
            }
          }

          return { success: true, threadChannelId: tcId }
        } catch (err) {
          log.error({ err }, "Failed to connect surface")
          set.status = 500
          return { success: false, error: "internal error" }
        }
      },
      {
        body: t.Object({
          sessionId: t.Optional(t.String()),
          threadId: t.Optional(t.String()),
          slackChannelId: t.Optional(t.String()),
        }),
        detail: {
          tags: ["Thread Surfaces"],
          summary: "Manually attach a Slack surface to a thread",
        },
      }
    )

    .post(
      "/:id/detach",
      async (ctx) => {
        const { params, set } = ctx
        const principalId = (ctx as any).principalId as string

        if (!principalId) {
          set.status = 401
          return { success: false, error: "unauthenticated" }
        }

        const existing = await db
          .select({ id: threadChannel.id, status: threadChannel.status })
          .from(threadChannel)
          .where(eq(threadChannel.id, params.id))
          .limit(1)

        if (existing.length === 0) {
          set.status = 404
          return { success: false, error: "surface not found" }
        }

        if (existing[0].status === "detached") {
          return { success: true, alreadyDetached: true }
        }

        await db
          .update(threadChannel)
          .set({ status: "detached", updatedAt: new Date() })
          .where(eq(threadChannel.id, params.id))

        return { success: true }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ["Thread Surfaces"],
          summary: "Detach a thread surface",
        },
      }
    )
}
