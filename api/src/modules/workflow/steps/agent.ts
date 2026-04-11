/**
 * Agent job steps — create jobs, route follow-up comments.
 */

import { createStep } from "../../../lib/workflow-engine"
import { getWorkflowDb } from "../../../lib/workflow-helpers"
import { job } from "../../../db/schema/org"
import type { JobSpec } from "@smp/factory-shared/schemas/org"

export const createAgentJob = createStep({
  name: "agent.createJob",
  fn: async (input: {
    agentId: string
    task: string
    entityKind?: string
    entityId?: string
    metadata?: Record<string, unknown>
  }) => {
    const db = getWorkflowDb()
    const [row] = await db
      .insert(job)
      .values({
        agentId: input.agentId,
        mode: "autonomous",
        trigger: "workflow",
        entityKind: input.entityKind,
        entityId: input.entityId,
        spec: {
          title: input.task,
          metadata: input.metadata ?? {},
        } satisfies JobSpec,
      })
      .returning()
    return row
  },
})

export const routeCommentToAgent = createStep({
  name: "agent.routeComment",
  fn: async (input: {
    agentId: string
    parentJobId: string
    comment: string
  }) => {
    const db = getWorkflowDb()
    const [row] = await db
      .insert(job)
      .values({
        agentId: input.agentId,
        mode: "autonomous",
        trigger: "workflow",
        parentJobId: input.parentJobId,
        spec: {
          title: input.comment,
          metadata: {},
        } satisfies JobSpec,
      })
      .returning()
    return row
  },
})
