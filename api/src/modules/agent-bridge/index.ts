/**
 * Agent Bridge — API for managing agent sessions.
 *
 * POST  /agent-bridge/sessions           — create a new session
 * POST  /agent-bridge/sessions/:id/input — send user input to agent
 * POST  /agent-bridge/sessions/:id/stop  — stop the agent
 * GET   /agent-bridge/sessions/:id       — get session status
 * GET   /agent-bridge/sessions           — list active sessions
 */
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { thread } from "../../db/schema/org"
import { newId } from "../../lib/id"
import { logger } from "../../logger"
import {
  createSession,
  endSession,
  getActiveSession,
  listActiveSessions,
  updateSessionStatus,
} from "./session-manager"

const log = logger.child({ module: "agent-bridge" })

export function agentBridgeController(db: Database) {
  return new Elysia({ prefix: "/agent-bridge" })

    .post(
      "/sessions",
      async ({ body, set }) => {
        const { threadId, principalId, mode, agentType, siteId, workbenchId } =
          body

        try {
          let resolvedThreadId: string = threadId ?? ""

          if (!resolvedThreadId) {
            const [newThread] = await (db as any)
              .insert(thread)
              .values({
                id: newId("thrd"),
                type: "agent-session",
                source: agentType ?? "claude-code",
                principalId,
                status: "active",
                siteId: siteId ?? null,
                workbenchId: workbenchId ?? null,
                startedAt: new Date(),
                spec: {} as any,
              })
              .returning({ id: thread.id })

            resolvedThreadId = newThread.id
            log.info(
              { threadId: resolvedThreadId },
              "created new thread for session"
            )
          }

          const sessionId = await createSession(db, {
            threadId: resolvedThreadId,
            principalId,
            mode: mode as "drive" | "follow" | "native",
            agentType: agentType ?? "claude-code",
            siteId,
            workbenchId,
          })

          await updateSessionStatus(db, sessionId, "starting")

          // TODO: spawn agent process here — actual drive/follow/native
          // session implementations come in the next step

          await updateSessionStatus(db, sessionId, "ready")

          set.status = 201
          return {
            sessionId,
            threadId: resolvedThreadId,
            status: "ready",
          }
        } catch (err) {
          log.error({ err }, "session creation failed")
          set.status = 500
          return { error: "Failed to create session" }
        }
      },
      {
        body: t.Object({
          threadId: t.Optional(t.String()),
          principalId: t.String(),
          mode: t.Optional(t.String()),
          agentType: t.Optional(t.String()),
          siteId: t.Optional(t.String()),
          workbenchId: t.Optional(t.String()),
          prompt: t.Optional(t.String()),
        }),
        detail: {
          tags: ["Agent Bridge"],
          summary: "Create a new agent session",
        },
      }
    )

    .post(
      "/sessions/:id/input",
      async ({ params, body, set }) => {
        const active = getActiveSession(params.id)
        if (!active) {
          set.status = 404
          return { error: "Session not found or not active" }
        }

        // TODO: write to agent stdin via process handle
        // For now, queue as a user message
        log.info(
          { sessionId: params.id, textLength: body.text.length },
          "input received (queued)"
        )

        set.status = 202
        return { accepted: true }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({ text: t.String() }),
        detail: {
          tags: ["Agent Bridge"],
          summary: "Send user input to a running agent session",
        },
      }
    )

    .post(
      "/sessions/:id/stop",
      async ({ params, set }) => {
        const active = getActiveSession(params.id)
        if (!active) {
          set.status = 404
          return { error: "Session not found" }
        }

        await endSession(db, params.id)
        return { stopped: true }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ["Agent Bridge"],
          summary: "Stop an active agent session",
        },
      }
    )

    .get(
      "/sessions/:id",
      async ({ params, set }) => {
        const active = getActiveSession(params.id)
        if (!active) {
          set.status = 404
          return { error: "Session not found" }
        }

        return {
          id: active.id,
          threadId: active.threadId,
          mode: active.mode,
          status: active.status,
          agentType: active.agentType,
          pid: active.process?.pid,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ["Agent Bridge"],
          summary: "Get session status",
        },
      }
    )

    .get(
      "/sessions",
      async () => {
        const sessions = listActiveSessions()
        return {
          sessions: sessions.map((s) => ({
            id: s.id,
            threadId: s.threadId,
            mode: s.mode,
            status: s.status,
            agentType: s.agentType,
          })),
          count: sessions.length,
        }
      },
      {
        detail: {
          tags: ["Agent Bridge"],
          summary: "List active agent sessions",
        },
      }
    )
}
