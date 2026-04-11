/**
 * Workflow REST API controller.
 *
 * Provides endpoints for managing workflows:
 *   GET    /workflow/definitions           — list registered workflows
 *   POST   /workflow/runs                  — start a workflow
 *   GET    /workflow/runs                  — list workflow runs
 *   GET    /workflow/runs/:id              — get run details
 *   POST   /workflow/runs/:id/cancel       — cancel a run
 *   POST   /workflow/events                — emit an event (for testing/manual progression)
 *   GET    /workflow/subscriptions          — list pending event subscriptions
 */

import { Elysia, t } from "elysia"
import { desc, eq, and } from "drizzle-orm"

import type { Database } from "../../../db/connection"
import { workflowRun } from "../../../db/schema/org-v2"
import { newId } from "../../../lib/id"
import {
  listWorkflowDefinitions,
  getWorkflowDefinition,
  startWorkflow,
} from "../../../lib/workflow-engine"
import { createWorkflowRun, updateRun } from "../../../lib/workflow-helpers"
import { emitEvent } from "../../../lib/workflow-events"
import { eventSubscription } from "../../../db/schema/org-v2"

export function workflowController(db: Database) {
  return (
    new Elysia({ prefix: "/workflow" })

      // ── List workflow definitions ──
      .get(
        "/definitions",
        () => {
          const defs = listWorkflowDefinitions()
          return {
            data: defs.map((d) => ({
              name: d.name,
              description: d.description,
              triggerTypes: d.triggerTypes,
            })),
          }
        },
        {
          detail: {
            tags: ["Workflow"],
            summary: "List registered workflow definitions",
          },
        }
      )

      // ── Start a workflow run ──
      .post(
        "/runs",
        async ({ body, set }) => {
          const { workflowName, input } = body as {
            workflowName: string
            input: Record<string, unknown>
          }

          const def = getWorkflowDefinition(workflowName)
          if (!def) {
            set.status = 404
            return {
              success: false,
              error: `Unknown workflow: ${workflowName}`,
            }
          }

          // Validate input against schema
          const parsed = def.inputSchema.safeParse(input)
          if (!parsed.success) {
            set.status = 400
            return {
              success: false,
              error: "Invalid input",
              details: parsed.error.format(),
            }
          }

          const workflowRunId = newId("wfr")
          await createWorkflowRun(db, {
            workflowRunId,
            workflowName,
            trigger: "cli",
            input: parsed.data,
          })

          await startWorkflow(def.fn, parsed.data, workflowRunId)

          return { success: true, workflowRunId }
        },
        {
          body: t.Object({
            workflowName: t.String(),
            input: t.Record(t.String(), t.Unknown()),
          }),
          detail: { tags: ["Workflow"], summary: "Start a new workflow run" },
        }
      )

      // ── List workflow runs ──
      .get(
        "/runs",
        async ({ query }) => {
          const conditions = []
          if (query.workflowName) {
            conditions.push(eq(workflowRun.workflowName, query.workflowName))
          }
          if (query.status) {
            conditions.push(eq(workflowRun.status, query.status))
          }

          const limit = Math.min(Number(query.limit) || 50, 200)
          const offset = Number(query.offset) || 0

          const rows = await db
            .select()
            .from(workflowRun)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(workflowRun.createdAt))
            .limit(limit)
            .offset(offset)

          return { data: rows, total: rows.length }
        },
        {
          query: t.Object({
            workflowName: t.Optional(t.String()),
            status: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
          detail: { tags: ["Workflow"], summary: "List workflow runs" },
        }
      )

      // ── Get run details ──
      .get(
        "/runs/:id",
        async ({ params, set }) => {
          const [row] = await db
            .select()
            .from(workflowRun)
            .where(eq(workflowRun.workflowRunId, params.id))
            .limit(1)

          if (!row) {
            set.status = 404
            return { success: false, error: "Run not found" }
          }

          return { data: row }
        },
        {
          detail: { tags: ["Workflow"], summary: "Get workflow run details" },
        }
      )

      // ── Cancel a run ──
      .post(
        "/runs/:id/cancel",
        async ({ params, set }) => {
          const [row] = await db
            .select()
            .from(workflowRun)
            .where(eq(workflowRun.workflowRunId, params.id))
            .limit(1)

          if (!row) {
            set.status = 404
            return { success: false, error: "Run not found" }
          }

          if (row.status !== "running") {
            set.status = 409
            return {
              success: false,
              error: `Cannot cancel run in status: ${row.status}`,
            }
          }

          await updateRun(db, params.id, {
            status: "cancelled",
            phase: "cancelled",
            completedAt: new Date(),
          })

          return { success: true }
        },
        {
          detail: { tags: ["Workflow"], summary: "Cancel a workflow run" },
        }
      )

      // ── Emit an event (for testing / manual progression) ──
      .post(
        "/events",
        async ({ body }) => {
          const { eventName, data } = body as {
            eventName: string
            data: Record<string, unknown>
          }

          await emitEvent(db, eventName, data)

          return { success: true, eventName }
        },
        {
          body: t.Object({
            eventName: t.String(),
            data: t.Record(t.String(), t.Unknown()),
          }),
          detail: {
            tags: ["Workflow"],
            summary: "Emit a workflow event (for testing)",
          },
        }
      )

      // ── List pending event subscriptions ──
      .get(
        "/subscriptions",
        async ({ query }) => {
          const conditions = []
          if (query.workflowRunId) {
            conditions.push(
              eq(eventSubscription.workflowRunId, query.workflowRunId)
            )
          }

          const rows = await db
            .select()
            .from(eventSubscription)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .limit(100)

          return { data: rows, total: rows.length }
        },
        {
          query: t.Object({
            workflowRunId: t.Optional(t.String()),
          }),
          detail: {
            tags: ["Workflow"],
            summary: "List pending event subscriptions",
          },
        }
      )
  )
}
