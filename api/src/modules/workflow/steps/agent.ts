/**
 * Agent job steps — create jobs, route follow-up comments.
 */

import { createStep } from "../../../lib/workflow-engine";
import { getWorkflowDb } from "../../../lib/workflow-helpers";
import { createJob } from "../../agent/job.model";

export const createAgentJob = createStep({
  name: "agent.createJob",
  fn: async (input: {
    agentId: string;
    task: string;
    entityKind?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const db = getWorkflowDb();
    return createJob(db, {
      agentId: input.agentId,
      mode: "autonomous",
      trigger: "workflow",
      task: input.task,
      entityKind: input.entityKind,
      entityId: input.entityId,
      metadata: input.metadata,
    });
  },
});

export const routeCommentToAgent = createStep({
  name: "agent.routeComment",
  fn: async (input: {
    agentId: string;
    parentJobId: string;
    comment: string;
  }) => {
    const db = getWorkflowDb();
    return createJob(db, {
      agentId: input.agentId,
      mode: "autonomous",
      trigger: "workflow",
      task: input.comment,
      parentJobId: input.parentJobId,
    });
  },
});
