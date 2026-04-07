/**
 * Jira webhook trigger — starts workflows when Jira issues transition.
 *
 * POST /webhooks/jira/:providerId
 */

import { Elysia } from "elysia";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/connection";
import { workTrackerProvider } from "../../../db/schema/product";
import { getWorkTrackerAdapter } from "../../../adapters/adapter-registry";
import type { WorkTrackerType } from "../../../adapters/work-tracker-adapter";
import { newId } from "../../../lib/id";
import { logger } from "../../../logger";
import { startWorkflow } from "../../../lib/workflow-engine";
import { createWorkflowRun } from "../../../lib/workflow-helpers";
import { godWorkflow, type GodWorkflowInput } from "../workflows/god-workflow";

export function jiraWebhookTrigger(db: Database) {
  return new Elysia({ prefix: "/webhooks" }).post(
    "/jira/:providerId",
    async ({ params, headers, body, set }) => {
      // 1. Look up provider
      const [provider] = await db
        .select()
        .from(workTrackerProvider)
        .where(eq(workTrackerProvider.workTrackerProviderId, params.providerId))
        .limit(1);

      if (!provider) {
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      // 2. Verify webhook
      const adapter = getWorkTrackerAdapter(provider.kind as WorkTrackerType);
      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      const headerRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") headerRecord[key] = value;
      }

      if (adapter.verifyWebhook) {
        const verification = await adapter.verifyWebhook(headerRecord, rawBody);
        if (!verification.valid) {
          set.status = 401;
          return { success: false, error: "webhook_verification_failed" };
        }
      }

      // 3. Parse payload — look for issue status transitions
      const payload = typeof body === "string" ? JSON.parse(body) : body;
      const webhookEvent = (payload as any)?.webhookEvent ?? "unknown";

      // Only trigger on issue_updated with status change to "In Progress"
      if (webhookEvent !== "jira:issue_updated") {
        return { success: true, action: "ignored", reason: "not_a_status_transition" };
      }

      const changelog = (payload as any)?.changelog;
      const statusChange = changelog?.items?.find(
        (item: any) => item.field === "status",
      );

      if (!statusChange) {
        return { success: true, action: "ignored", reason: "no_status_change" };
      }

      // Jira changelog items have a "toString" *property* (target status name)
      // which is shadowed by JS Object.prototype.toString — use bracket notation.
      const toStatus = ((statusChange as Record<string, unknown>)["toString"] as string ?? "").toLowerCase();
      if (toStatus !== "in progress") {
        return { success: true, action: "ignored", reason: `status_changed_to_${toStatus}` };
      }

      // 4. Extract issue details
      const issue = (payload as any)?.issue;
      if (!issue?.key) {
        set.status = 400;
        return { success: false, error: "missing_issue_key" };
      }

      const issueKey = issue.key as string;

      // 5. Determine repo — stored in provider spec or requires mapping
      const spec = provider.spec as Record<string, unknown> | null;
      const repoFullName = (spec?.defaultRepoFullName as string) ?? null;
      const agentId = (spec?.defaultAgentId as string) ?? null;

      if (!repoFullName) {
        logger.warn({ issueKey, providerId: params.providerId }, "No default repo configured for Jira provider");
        return { success: true, action: "ignored", reason: "no_repo_mapping" };
      }

      // 6. Build workflow input
      const gitHostConfig = (spec?.gitHost as Record<string, unknown>) ?? {};
      const workflowInput: GodWorkflowInput = {
        issueKey,
        repoFullName,
        workTracker: {
          type: provider.kind as "jira" | "linear" | "noop",
          apiUrl: provider.apiUrl,
          credentialsRef: provider.credentialsRef ?? "",
        },
        gitHost: {
          type: (gitHostConfig.type as string ?? "github") as any,
          config: gitHostConfig.config as Record<string, unknown> ?? {},
        },
        agentId: agentId ?? "default",
        baseBranch: (spec?.defaultBaseBranch as string) ?? "main",
        workspaceTtl: (spec?.workspaceTtl as string) ?? "4h",
      };

      // 7. Create workflow run + start DBOS workflow
      const workflowRunId = newId("wfr");
      await createWorkflowRun(db, {
        workflowRunId,
        workflowName: "god-workflow",
        trigger: "jira_webhook",
        input: workflowInput,
        triggerPayload: payload,
      });

      await startWorkflow(godWorkflow, workflowInput, workflowRunId);

      logger.info(
        { workflowRunId, issueKey, repoFullName },
        "God workflow started from Jira webhook",
      );

      return { success: true, action: "workflow_started", workflowRunId };
    },
    {
      detail: { tags: ["Webhooks"], summary: "Jira webhook — triggers workflows on issue transitions" },
    },
  );
}
