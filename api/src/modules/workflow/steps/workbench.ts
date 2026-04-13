/**
 * Workbench provisioning steps.
 */
import { getWorkflowDb } from "../../../lib/workflow-helpers"
import { createWorkbench } from "../../ops/workbench.service"

export async function provisionWorkbench(input: {
  name?: string
  ownerId?: string
  createdBy?: string
  trigger?: string
  type?: string
  ttl?: string
  labels?: Record<string, unknown>
}) {
  "use step"
  const db = getWorkflowDb()
  return createWorkbench(db, {
    name: input.name,
    ownerId: input.ownerId,
    createdBy: input.createdBy,
    trigger: input.trigger ?? "workflow",
    type: input.type ?? "agent",
    ttl: input.ttl ?? "2h",
    labels: input.labels,
  })
}
