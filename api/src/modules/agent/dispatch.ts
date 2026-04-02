/**
 * Agent dispatch — resolves which agent handles a message and routes it.
 *
 * Responsibilities:
 *   1. Thread-to-job lookup: if this Slack thread already has an active job, route to it
 *   2. Agent resolution: pick the right agent for the channel/entity context
 *   3. Job creation + start: create a new job and kick off the executor
 */
import { and, eq, notInArray } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { job } from "../../db/schema/agent";
import { agent } from "../../db/schema/agent";
import { createJob, startJob } from "./job.model";
import { executeAgentJob } from "./executor";
import { logger } from "../../logger";

export interface DispatchContext {
  /** Messaging provider ID (Slack workspace, etc.) */
  providerId: string;
  /** External channel ID (Slack channel) */
  channelId: string;
  /** External thread ID (Slack thread_ts) */
  threadId: string;
  /** Internal message thread ID */
  messageThreadId: string;
  /** The user's message text */
  text: string;
  /** Resolved principal ID (who sent the message) */
  principalId: string | null;
  /** Mapped entity context from channel mapping */
  entityContext: { entityKind: string; entityId: string } | null;
}

export interface DispatchResult {
  dispatched: boolean;
  jobId?: string;
  reason?: string;
}

/**
 * Dispatch an incoming message to an agent.
 *
 * 1. Check if this thread already has a running job → route message to that executor
 * 2. Otherwise, resolve which agent to use → create + start a new job
 */
export async function dispatchAgentJob(
  db: Database,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  // 1. Thread-to-job lookup: find an active job for this message thread
  const existingJob = await findActiveJobForThread(db, ctx.messageThreadId);

  if (existingJob) {
    // Route follow-up message to the existing executor
    logger.info(
      { jobId: existingJob.jobId, threadId: ctx.messageThreadId },
      "Routing follow-up message to existing job",
    );

    // Fire-and-forget: executor handles the follow-up asynchronously
    executeAgentJob(db, existingJob.jobId, {
      followUp: true,
      text: ctx.text,
      principalId: ctx.principalId,
    }).catch((err) => {
      logger.error({ jobId: existingJob.jobId, error: err }, "Follow-up execution failed");
    });

    return { dispatched: true, jobId: existingJob.jobId };
  }

  // 2. Resolve agent — find an active agent that matches the entity context
  const resolvedAgent = await resolveAgent(db, ctx.entityContext);
  if (!resolvedAgent) {
    logger.warn(
      { entityContext: ctx.entityContext },
      "No active agent found for dispatch",
    );
    return { dispatched: false, reason: "no_agent" };
  }

  // 3. Create and start a new job
  const newJob = await createJob(db, {
    agentId: resolvedAgent.agentId,
    mode: "conversational",
    trigger: "mention",
    task: ctx.text,
    entityKind: ctx.entityContext?.entityKind,
    entityId: ctx.entityContext?.entityId,
    channelKind: "slack",
    channelId: ctx.channelId,
    messageThreadId: ctx.messageThreadId,
    metadata: {
      providerId: ctx.providerId,
      threadId: ctx.threadId,
      initiatorPrincipalId: ctx.principalId,
    },
  });

  if (!newJob) {
    return { dispatched: false, reason: "job_creation_failed" };
  }

  await startJob(db, newJob.jobId);

  logger.info(
    { jobId: newJob.jobId, agentId: resolvedAgent.agentId, threadId: ctx.messageThreadId },
    "Dispatched new agent job",
  );

  // Fire-and-forget: executor runs asynchronously
  executeAgentJob(db, newJob.jobId, {
    followUp: false,
    text: ctx.text,
    principalId: ctx.principalId,
  }).catch((err) => {
    logger.error({ jobId: newJob.jobId, error: err }, "Job execution failed");
  });

  return { dispatched: true, jobId: newJob.jobId };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];

async function findActiveJobForThread(
  db: Database,
  messageThreadId: string,
) {
  const [row] = await db
    .select()
    .from(job)
    .where(
      and(
        eq(job.messageThreadId, messageThreadId),
        notInArray(job.status, TERMINAL_STATUSES),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolve which agent should handle a dispatch.
 *
 * Strategy (in order):
 *   1. If entity context has an entityKind/entityId, look for an agent
 *      with a matching relationship (team/org) and entityId.
 *   2. Fall back to the first active agent (org-level default).
 */
async function resolveAgent(
  db: Database,
  entityContext: { entityKind: string; entityId: string } | null,
) {
  // Try entity-scoped agent first
  if (entityContext) {
    const [scoped] = await db
      .select()
      .from(agent)
      .where(
        and(
          eq(agent.status, "active"),
          eq(agent.relationshipEntityId, entityContext.entityId),
        ),
      )
      .limit(1);
    if (scoped) return scoped;
  }

  // Fall back to first active agent
  const [defaultAgent] = await db
    .select()
    .from(agent)
    .where(eq(agent.status, "active"))
    .limit(1);
  return defaultAgent ?? null;
}
