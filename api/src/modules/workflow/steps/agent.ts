/**
 * Agent job steps — create jobs, route follow-up comments.
 */

import { getWorkflowDb } from "../../../lib/workflow-helpers"
import { job } from "../../../db/schema/org"
import type { JobSpec } from "@smp/factory-shared/schemas/org"

export async function createAgentJob(input: {
  agentId: string
  task: string
  entityKind?: string
  entityId?: string
  metadata?: Record<string, unknown>
}) {
  "use step"
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
}

export async function routeCommentToAgent(input: {
  agentId: string
  parentJobId: string
  comment: string
}) {
  "use step"
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
}
