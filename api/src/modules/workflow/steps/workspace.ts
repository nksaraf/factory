/**
 * Workbench provisioning steps.
 */
import { createStep } from "../../../lib/workflow-engine"
import { getWorkflowDb } from "../../../lib/workflow-helpers"
import { createWorkbench } from "../../fleet/workbench.service"

export const provisionWorkbench = createStep({
  name: "workbench.provision",
  fn: async (input: {
    name?: string
    ownerId?: string
    createdBy?: string
    trigger?: string
    type?: string
    ttl?: string
    labels?: Record<string, unknown>
  }) => {
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
  },
})
