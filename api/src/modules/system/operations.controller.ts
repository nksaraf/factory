/**
 * System Operations Controller
 *
 * Exposes background operation runner status, history, and manual triggers.
 */

import { eq } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { operationRun } from "../../db/schema/ops"
import { allRunners, getRunner } from "../../lib/operations"

export function operationsController(db: Database) {
  return new Elysia({ prefix: "/system/operations" })
    .get(
      "/",
      async () => {
        const runners = allRunners()
        const results = await Promise.all(
          runners.map(async (r) => {
            const last = await r.lastRun()
            return {
              name: r.name,
              intervalMs: r.intervalMs,
              lastRun: last
                ? {
                    id: last.id,
                    status: last.status,
                    startedAt: last.startedAt,
                    completedAt: last.completedAt,
                    durationMs: last.durationMs,
                    summary: last.summary,
                    error: last.error,
                  }
                : null,
            }
          })
        )
        return { operations: results }
      },
      {
        detail: {
          tags: ["System"],
          summary: "List all operations with last run status",
        },
      }
    )
    .get(
      "/runs/:runId",
      async ({ params, set }) => {
        const [row] = await db
          .select()
          .from(operationRun)
          .where(eq(operationRun.id, params.runId))
          .limit(1)
        if (!row) {
          set.status = 404
          return { error: "Run not found" }
        }
        return {
          run: {
            id: row.id,
            name: row.name,
            trigger: row.trigger,
            status: row.status,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            durationMs: row.durationMs,
            summary: row.summary,
            error: row.error,
          },
        }
      },
      {
        params: t.Object({ runId: t.String() }),
        detail: {
          tags: ["System"],
          summary: "Get a single operation run by id (for polling)",
        },
      }
    )
    .get(
      "/:name",
      async ({ params, set }) => {
        const runner = getRunner(params.name)
        if (!runner) {
          set.status = 404
          return { error: `Operation "${params.name}" not found` }
        }
        const runs = await runner.history({ limit: 5, offset: 0 })
        return {
          name: runner.name,
          intervalMs: runner.intervalMs,
          runs,
        }
      },
      {
        params: t.Object({ name: t.String() }),
        detail: {
          tags: ["System"],
          summary: "Get operation detail with recent runs",
        },
      }
    )
    .get(
      "/:name/runs",
      async ({ params, query, set }) => {
        const runner = getRunner(params.name)
        if (!runner) {
          set.status = 404
          return { error: `Operation "${params.name}" not found` }
        }
        const limit = query.limit ? Number(query.limit) : 20
        const offset = query.offset ? Number(query.offset) : 0
        const runs = await runner.history({ limit, offset })
        return { runs }
      },
      {
        params: t.Object({ name: t.String() }),
        query: t.Object({
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
        detail: {
          tags: ["System"],
          summary: "Get paginated run history for an operation",
        },
      }
    )
    .post(
      "/:name/trigger",
      async ({ params, set }) => {
        const runner = getRunner(params.name)
        if (!runner) {
          set.status = 404
          return { error: `Operation "${params.name}" not found` }
        }
        try {
          const runId = await runner.trigger()
          return { runId }
        } catch (err) {
          set.status = 409
          return {
            error:
              err instanceof Error ? err.message : "Operation already running",
          }
        }
      },
      {
        params: t.Object({ name: t.String() }),
        detail: {
          tags: ["System"],
          summary: "Manually trigger an operation run",
        },
      }
    )
}
