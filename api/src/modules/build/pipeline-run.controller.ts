import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { BuildModel } from "./model"
import * as pipelineRunSvc from "../../services/build/pipeline-run.service"

export function pipelineRunController(db: Database) {
  return (
    new Elysia({ prefix: "/runs" })

      // --- Create pipeline run ---
      .post(
        "/",
        async ({ body }) => {
          const run = await pipelineRunSvc.createPipelineRun(db, body)
          return { success: true, data: run }
        },
        {
          body: BuildModel.createPipelineRunBody,
          detail: { tags: ["Pipeline"], summary: "Create pipeline run" },
        }
      )

      // --- List pipeline runs ---
      .get(
        "/",
        async ({ query }) => ({
          success: true,
          data: await pipelineRunSvc.listPipelineRuns(db, query),
        }),
        {
          query: BuildModel.listPipelineRunsQuery,
          detail: { tags: ["Pipeline"], summary: "List pipeline runs" },
        }
      )

      // --- Get pipeline run with steps ---
      .get(
        "/:id",
        async ({ params, set }) => {
          const run = await pipelineRunSvc.getPipelineRunWithSteps(
            db,
            params.id
          )
          if (!run) {
            set.status = 404
            return { success: false, error: "not_found" }
          }
          return { success: true, data: run }
        },
        {
          params: BuildModel.pipelineRunIdParams,
          detail: { tags: ["Pipeline"], summary: "Get pipeline run" },
        }
      )

      // --- Update pipeline run ---
      .post(
        "/:id/update",
        async ({ params, body, set }) => {
          const updated = await pipelineRunSvc.updatePipelineRun(
            db,
            params.id,
            {
              ...body,
              startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
              completedAt: body.completedAt
                ? new Date(body.completedAt)
                : undefined,
            }
          )
          if (!updated) {
            set.status = 404
            return { success: false, error: "not_found" }
          }
          return { success: true, data: updated }
        },
        {
          params: BuildModel.pipelineRunIdParams,
          body: BuildModel.updatePipelineRunBody,
          detail: { tags: ["Pipeline"], summary: "Update pipeline run" },
        }
      )

      // --- Cancel pipeline run ---
      .post(
        "/:id/cancel",
        async ({ params, set }) => {
          const cancelled = await pipelineRunSvc.cancelPipelineRun(
            db,
            params.id
          )
          if (!cancelled) {
            set.status = 404
            return { success: false, error: "not_found_or_not_cancellable" }
          }
          return { success: true, data: cancelled }
        },
        {
          params: BuildModel.pipelineRunIdParams,
          detail: { tags: ["Pipeline"], summary: "Cancel pipeline run" },
        }
      )

      // --- Create step run ---
      .post(
        "/:id/steps",
        async ({ params, body, set }) => {
          const run = await pipelineRunSvc.getPipelineRun(db, params.id)
          if (!run) {
            set.status = 404
            return { success: false, error: "run_not_found" }
          }
          const step = await pipelineRunSvc.createStepRun(db, {
            pipelineRunId: params.id,
            ...body,
          })
          return { success: true, data: step }
        },
        {
          params: BuildModel.pipelineRunIdParams,
          body: BuildModel.createStepRunBody,
          detail: { tags: ["Pipeline"], summary: "Create step run" },
        }
      )

      // --- Update step run ---
      .post(
        "/:id/steps/:stepId/update",
        async ({ params, body, set }) => {
          const updated = await pipelineRunSvc.updateStepRun(
            db,
            params.stepId,
            {
              ...body,
              startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
              completedAt: body.completedAt
                ? new Date(body.completedAt)
                : undefined,
            }
          )
          if (!updated) {
            set.status = 404
            return { success: false, error: "not_found" }
          }
          return { success: true, data: updated }
        },
        {
          params: BuildModel.stepRunIdParams,
          body: BuildModel.updateStepRunBody,
          detail: { tags: ["Pipeline"], summary: "Update step run" },
        }
      )
  )
}
