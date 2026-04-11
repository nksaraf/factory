/**
 * God Workflow — Jira ticket → branch → workbench → agent → PR → preview
 *
 * Triggered when a Jira issue transitions to "In Progress" (via webhook or CLI).
 * Composes shared steps + durable event waits into a linear pipeline.
 */
import { z } from "zod"

import type {
  GitHostAdapterConfig,
  GitHostType,
} from "../../../adapters/git-host-adapter"
import type { WorkTrackerType } from "../../../adapters/work-tracker-adapter"
import { slugifyFromLabel } from "../../../lib/slug"
import { createWorkflow, getWorkflowId } from "../../../lib/workflow-engine"
import { waitForEvent } from "../../../lib/workflow-events"
import { getWorkflowDb, updateRun } from "../../../lib/workflow-helpers"
import { createAgentJob, routeCommentToAgent } from "../steps/agent"
import { createBranch, postPRComment } from "../steps/git"
import { fetchIssue, updateIssueStatus } from "../steps/work-tracker"
import { provisionWorkbench } from "../steps/workbench"

// ── Input schema ─────────────────────────────────────────

const godWorkflowInputSchema = z.object({
  /** Jira/Linear issue key, e.g. "PROJ-123" */
  issueKey: z.string(),

  /** GitHub repo, e.g. "org/repo" */
  repoFullName: z.string(),

  /** Work tracker connection info */
  workTracker: z.object({
    type: z.enum(["jira", "linear", "noop"]),
    apiUrl: z.string(),
    credentialsRef: z.string(),
  }),

  /** Git host connection info */
  gitHost: z.object({
    type: z.enum(["github", "gitlab", "gitea", "bitbucket", "noop"]),
    config: z.record(z.unknown()),
  }),

  /** Agent to assign the work to */
  agentId: z.string(),

  /** Optional overrides */
  baseBranch: z.string().default("main"),
  workbenchTtl: z.string().default("4h"),
})

export type GodWorkflowInput = z.infer<typeof godWorkflowInputSchema>

// ── Workflow ─────────────────────────────────────────────

export const godWorkflow = createWorkflow({
  name: "god-workflow",
  description: "Jira ticket → branch → workbench → agent → PR → preview",
  triggerTypes: ["jira_webhook", "cli", "manual"],
  inputSchema: godWorkflowInputSchema as z.ZodType<GodWorkflowInput>,
  fn: async (input: GodWorkflowInput) => {
    // DB is resolved from the module-level accessor (not passed in input)
    // because DBOS serializes workflow inputs and Database is not serializable.
    const db = getWorkflowDb()
    const wfId = getWorkflowId()

    // ── Phase 1: Fetch issue details ──
    const issue = await fetchIssue({
      issueId: input.issueKey,
      apiUrl: input.workTracker.apiUrl,
      credentialsRef: input.workTracker.credentialsRef,
      trackerType: input.workTracker.type as WorkTrackerType,
    })

    const branchName = `feat/${input.issueKey}-${slugifyFromLabel(issue.title)}`
    await updateRun(db, wfId, {
      phase: "branch_creating",
      state: { issueTitle: issue.title },
    })

    // ── Phase 2: Create branch ──
    await createBranch({
      repoFullName: input.repoFullName,
      branchName,
      fromRef: input.baseBranch,
      hostType: input.gitHost.type as GitHostType,
      hostConfig: input.gitHost.config as GitHostAdapterConfig,
    })
    await updateRun(db, wfId, {
      phase: "workbench_provisioning",
      state: { branchName },
    })

    // ── Phase 3: Provision workbench, wait for ready ──
    const workbench = await provisionWorkbench({
      name: `ws-${input.issueKey}`,
      trigger: "workflow",
      type: "agent",
      ttl: input.workbenchTtl,
      labels: {
        workflowRunId: wfId,
        issueKey: input.issueKey,
        branchName,
        repoFullName: input.repoFullName,
      },
    })
    await updateRun(db, wfId, { state: { workbenchId: workbench.id } })

    const wsEvent = await waitForEvent<{ workbenchId: string; status: string }>(
      "workbench.ready",
      { workbenchId: workbench.id },
      600
    )
    if (!wsEvent)
      throw new Error("Workbench provisioning timed out after 10 minutes")
    await updateRun(db, wfId, { phase: "agent_working" })

    // ── Phase 4: Start agent, wait for PR ──
    const job = await createAgentJob({
      agentId: input.agentId,
      task: `${issue.title}\n\n${issue.description ?? ""}`,
      entityKind: "work_item",
      entityId: input.issueKey,
      metadata: {
        workflowRunId: wfId,
        branchName,
        repoFullName: input.repoFullName,
      },
    })
    await updateRun(db, wfId, { state: { jobId: job.id } })

    const prEvent = await waitForEvent<{
      prNumber: number
      prUrl: string
      branchName: string
    }>("pr.opened", { repoFullName: input.repoFullName, branchName }, 3600)
    if (!prEvent) throw new Error("Agent did not create PR within 1 hour")
    await updateRun(db, wfId, {
      phase: "preview_deploying",
      state: { prNumber: prEvent.prNumber, prUrl: prEvent.prUrl },
    })

    // ── Phase 5: Wait for preview ──
    const pvEvent = await waitForEvent<{
      previewUrl: string
      previewSlug: string
    }>("preview.ready", { branchName }, 600)
    if (pvEvent) {
      await updateRun(db, wfId, {
        phase: "preview_active",
        state: { previewUrl: pvEvent.previewUrl },
      })

      // Post preview URL as PR comment
      await postPRComment({
        repoFullName: input.repoFullName,
        prNumber: prEvent.prNumber,
        body: `🔗 **Preview:** ${pvEvent.previewUrl}`,
        hostType: input.gitHost.type as GitHostType,
        hostConfig: input.gitHost.config as GitHostAdapterConfig,
      })
    } else {
      await updateRun(db, wfId, { phase: "preview_skipped" })
    }

    // ── Phase 6: Update issue status ──
    await updateIssueStatus({
      issueId: input.issueKey,
      transitionName: "In Review",
      apiUrl: input.workTracker.apiUrl,
      credentialsRef: input.workTracker.credentialsRef,
      trackerType: input.workTracker.type as WorkTrackerType,
    })
    await updateRun(db, wfId, { phase: "awaiting_review" })

    // ── Phase 7: Review loop — route PR comments to agent ──
    while (true) {
      const comment = await waitForEvent<{
        comment: string
        author: string
        prNumber: number
      }>(
        "pr.comment",
        {
          repoFullName: input.repoFullName,
          prNumber: String(prEvent.prNumber),
        },
        86400 // 24h timeout
      )

      if (!comment) break // timeout = review complete

      await updateRun(db, wfId, { phase: "agent_iterating" })
      await routeCommentToAgent({
        agentId: input.agentId,
        parentJobId: job.id,
        comment: comment.comment,
      })
      await updateRun(db, wfId, { phase: "awaiting_review" })
    }

    // ── Done ──
    const output = {
      branchName,
      prUrl: prEvent.prUrl,
      prNumber: prEvent.prNumber,
      previewUrl: pvEvent?.previewUrl ?? null,
    }
    await updateRun(db, wfId, {
      phase: "completed",
      status: "succeeded",
      output,
      completedAt: new Date(),
    })

    return output
  },
})
