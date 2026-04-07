/**
 * Workspace provisioning steps.
 */

import { createStep } from "../../../lib/workflow-engine";
import { getWorkflowDb } from "../../../lib/workflow-helpers";
import { createWorkspace } from "../../fleet/workspace.service";

export const provisionWorkspace = createStep({
  name: "workspace.provision",
  fn: async (input: {
    name?: string;
    ownerId?: string;
    createdBy?: string;
    trigger?: string;
    type?: string;
    ttl?: string;
    labels?: Record<string, unknown>;
  }) => {
    const db = getWorkflowDb();
    return createWorkspace(db, {
      name: input.name,
      ownerId: input.ownerId,
      createdBy: input.createdBy,
      trigger: input.trigger ?? "workflow",
      type: input.type ?? "agent",
      ttl: input.ttl ?? "2h",
      labels: input.labels,
    });
  },
});
