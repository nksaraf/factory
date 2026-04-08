/**
 * Jira webhook trigger — starts workflows when Jira issues transition.
 *
 * POST /webhooks/jira/:providerId
 */

import { Elysia } from "elysia";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/connection";
import { workTrackerProvider } from "../../../db/schema/build-v2";
import { getWorkTrackerAdapter } from "../../../adapters/adapter-registry";
import type { WorkTrackerType } from "../../../adapters/work-tracker-adapter";
import { newId } from "../../../lib/id";
import { logger } from "../../../logger";
import { recordWebhookEvent, updateWebhookEventStatus, resolveActorPrincipal } from "../../../lib/webhook-events";
import { startWorkflow } from "../../../lib/workflow-engine";
import { createWorkflowRun } from "../../../lib/workflow-helpers";
import { godWorkflow, type GodWorkflowInput } from "../workflows/god-workflow";
import type { WebhookEventActor, WebhookEventEntity } from "@smp/factory-shared/schemas/org";

const wlog = logger.child({ module: "webhook" });

/**
 * Map Jira webhook event to normalized event type.
 */
function normalizeJiraEventType(webhookEvent: string, changelog?: any): string {
  switch (webhookEvent) {
    case "jira:issue_created":
      return "task.created";
    case "jira:issue_updated": {
      if (!changelog?.items) return "task.updated";
      const hasStatus = changelog.items.some((i: any) => i.field === "status");
      const hasAssignee = changelog.items.some((i: any) => i.field === "assignee");
      if (hasStatus) return "task.status_changed";
      if (hasAssignee) return "task.assigned";
      return "task.updated";
    }
    case "jira:issue_deleted":
      return "task.deleted";
    case "issue_property_set":
      return "task.updated";
    default:
      return `task.${webhookEvent.replace("jira:", "")}`;
  }
}

export function jiraWebhookTrigger(db: Database) {
  return new Elysia({ prefix: "/webhooks" }).post(
    "/jira/:providerId",
    async ({ params, headers, body, set }) => {
      // Record every inbound webhook in org.webhook_event
      const jiraPayload = typeof body === "string" ? JSON.parse(body) : body;
      const jiraEventType = (jiraPayload as any)?.webhookEvent ?? "unknown";
      const jiraDeliveryId = (jiraPayload as any)?.timestamp
        ? `${jiraEventType}-${(jiraPayload as any).timestamp}`
        : crypto.randomUUID();

      // Extract actor from Jira payload
      const jiraUser = (jiraPayload as any)?.user as Record<string, unknown> | undefined;
      const jiraAccountId = jiraUser?.accountId as string | undefined;
      const jiraDisplayName = (jiraUser?.displayName as string) ?? undefined;
      const jiraIssueKey = ((jiraPayload as any)?.issue?.key as string) ?? undefined;

      wlog.info(
        { source: "jira", providerId: params.providerId, event: jiraEventType, issue: jiraIssueKey, actor: jiraDisplayName },
        `jira ${jiraEventType.replace("jira:", "")}${jiraIssueKey ? ` ${jiraIssueKey}` : ""}${jiraDisplayName ? ` by ${jiraDisplayName}` : ""}`,
      );
      let jiraActorPrincipalId: string | null = null;
      if (jiraAccountId) {
        jiraActorPrincipalId = await resolveActorPrincipal(db, "jira", jiraAccountId).catch(() => null);
      }
      const jiraActor: WebhookEventActor | undefined = jiraAccountId ? {
        externalId: jiraAccountId,
        externalUsername: (jiraUser?.displayName as string) ?? undefined,
        principalId: jiraActorPrincipalId ?? undefined,
      } : undefined;

      // Extract entity (issue)
      const jiraEntity: WebhookEventEntity | undefined = jiraIssueKey ? {
        externalRef: jiraIssueKey,
        kind: "ticket",
      } : undefined;

      const normalizedEventType = normalizeJiraEventType(jiraEventType, (jiraPayload as any)?.changelog);

      const eventId = await recordWebhookEvent(db, {
        source: "jira",
        providerId: params.providerId,
        deliveryId: jiraDeliveryId,
        eventType: jiraEventType,
        normalizedEventType,
        payload: jiraPayload,
        actor: jiraActor,
        entity: jiraEntity,
        actorId: jiraActorPrincipalId,
      });

      // 1. Look up provider
      const [provider] = await db
        .select()
        .from(workTrackerProvider)
        .where(eq(workTrackerProvider.id, params.providerId))
        .limit(1);

      if (!provider) {
        wlog.warn({ source: "jira", providerId: params.providerId }, "webhook provider not found");
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "provider_not_found" });
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      // 2. Verify webhook
      const adapter = getWorkTrackerAdapter(provider.type as WorkTrackerType);
      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      const headerRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") headerRecord[key] = value;
      }

      if (adapter.verifyWebhook) {
        const verification = await adapter.verifyWebhook(headerRecord, rawBody);
        if (!verification.valid) {
          wlog.warn({ source: "jira", providerId: params.providerId, event: jiraEventType, issue: jiraIssueKey }, `jira webhook signature invalid (${jiraEventType.replace("jira:", "")}${jiraIssueKey ? ` ${jiraIssueKey}` : ""})`);
          if (eventId) await updateWebhookEventStatus(db, eventId, { status: "failed", reason: "invalid_signature" });
          set.status = 401;
          return { success: false, error: "webhook_verification_failed" };
        }
      }

      // 3. Parse payload — look for issue status transitions
      const payload = typeof body === "string" ? JSON.parse(body) : body;
      const webhookEvent = (payload as any)?.webhookEvent ?? "unknown";

      // Only trigger on issue_updated with status change to "In Progress"
      if (webhookEvent !== "jira:issue_updated") {
        wlog.info({ source: "jira", providerId: params.providerId, event: webhookEvent, issue: jiraIssueKey, reason: "not_a_status_transition" }, `jira ${webhookEvent.replace("jira:", "")} ignored — not a status transition${jiraIssueKey ? ` (${jiraIssueKey})` : ""}`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "not_a_status_transition" });
        return { success: true, action: "ignored", reason: "not_a_status_transition" };
      }

      const changelog = (payload as any)?.changelog;
      const statusChange = changelog?.items?.find(
        (item: any) => item.field === "status",
      );

      if (!statusChange) {
        wlog.info({ source: "jira", providerId: params.providerId, event: webhookEvent, issue: jiraIssueKey, reason: "no_status_change" }, `jira issue_updated ignored — no status change${jiraIssueKey ? ` (${jiraIssueKey})` : ""}`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "no_status_change" });
        return { success: true, action: "ignored", reason: "no_status_change" };
      }

      // Jira changelog items have a "toString" *property* (target status name)
      // which is shadowed by JS Object.prototype.toString — use bracket notation.
      const toStatus = ((statusChange as Record<string, unknown>)["toString"] as string ?? "").toLowerCase();
      if (toStatus !== "in progress") {
        wlog.info({ source: "jira", providerId: params.providerId, event: webhookEvent, issue: jiraIssueKey, reason: `status_changed_to_${toStatus}` }, `jira status → ${toStatus} ignored — not "in progress"${jiraIssueKey ? ` (${jiraIssueKey})` : ""}`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: `status_changed_to_${toStatus}` });
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
        wlog.info({ source: "jira", providerId: params.providerId, event: webhookEvent, issue: jiraIssueKey, reason: "no_repo_mapping" }, `jira ${issueKey} ignored — no repo mapping configured`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "no_repo_mapping" });
        return { success: true, action: "ignored", reason: "no_repo_mapping" };
      }

      // 6. Build workflow input
      const gitHostConfig = (spec?.gitHost as Record<string, unknown>) ?? {};
      const workflowInput: GodWorkflowInput = {
        issueKey,
        repoFullName,
        workTracker: {
          type: provider.type as "jira" | "linear" | "noop",
          apiUrl: (spec as any)?.apiUrl ?? "",
          credentialsRef: (spec as any)?.credentialsRef ?? "",
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

      if (eventId) await updateWebhookEventStatus(db, eventId, { status: "processed" });

      wlog.info(
        { source: "jira", providerId: params.providerId, event: webhookEvent, issue: issueKey, workflowRunId, repo: repoFullName },
        `jira ${issueKey} → workflow started (${workflowRunId})`,
      );

      return { success: true, action: "workflow_started", workflowRunId };
    },
    {
      detail: { tags: ["Webhooks"], summary: "Jira webhook — triggers workflows on issue transitions" },
    },
  );
}
