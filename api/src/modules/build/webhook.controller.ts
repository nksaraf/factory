import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import { GitHostService } from "./git-host.service";
import { WebhookService } from "./webhook.service";
import { NoopGitHostAdapter } from "../../adapters/git-host-adapter-noop";
import { getGitHostAdapter } from "../../adapters/adapter-registry";
import type { GitHostType } from "../../adapters/git-host-adapter";
import type { GitHostProviderSpec } from "@smp/factory-shared/schemas/build";
import { logger } from "../../logger";
import { recordWebhookEvent, updateWebhookEventStatus, resolveActorPrincipal } from "../../lib/webhook-events";
import type { WebhookEventActor, WebhookEventEntity } from "@smp/factory-shared/schemas/org";

const wlog = logger.child({ module: "webhook" });

/**
 * Map GitHub event+action to normalized event type.
 */
function normalizeGitHubEventType(event: string, action?: string, payload?: any): string {
  switch (event) {
    case "push":
      return "code.push";
    case "pull_request":
      switch (action) {
        case "opened": return "code.pr.opened";
        case "reopened": return "code.pr.reopened";
        case "synchronize": return "code.pr.updated";
        case "closed":
          return payload?.pull_request?.merged ? "code.pr.merged" : "code.pr.closed";
        default: return `code.pr.${action ?? "unknown"}`;
      }
    case "issue_comment":
      return action === "created" ? "code.pr.commented" : `code.comment.${action ?? "unknown"}`;
    case "ping":
      return "system.ping";
    default:
      return `code.${event}`;
  }
}

export function webhookController(db: Database) {
  const gitHostService = new GitHostService(db);
  const webhookService = new WebhookService(db, gitHostService);

  return new Elysia({ prefix: "/webhooks" }).post(
    "/github/:providerId",
    async ({ params, headers, body, set }) => {
      const event = headers["x-github-event"] as string | undefined;
      const deliveryId = headers["x-github-delivery"] as string | undefined;

      // Record every inbound webhook in org.webhook_event
      const payload = typeof body === "string" ? JSON.parse(body) : body;
      const action = (payload as any)?.action as string | undefined;
      const sender = (payload as any)?.sender as Record<string, unknown> | undefined;
      const repo = (payload as any)?.repository as Record<string, unknown> | undefined;
      const repoName = (repo?.full_name as string) ?? undefined;
      const senderLogin = (sender?.login as string) ?? undefined;

      wlog.info(
        { source: "github", providerId: params.providerId, event, action, deliveryId, repo: repoName, actor: senderLogin },
        `github ${event ?? "unknown"}${action ? `.${action}` : ""} from ${repoName ?? "unknown"}`,
      );

      // Resolve actor
      const senderIdStr = sender?.id != null ? String(sender.id) : undefined;
      let actorPrincipalId: string | null = null;
      if (senderIdStr) {
        actorPrincipalId = await resolveActorPrincipal(db, "github", senderIdStr).catch(() => null);
      }
      const actor: WebhookEventActor | undefined = senderIdStr ? {
        externalId: senderIdStr,
        externalUsername: (sender?.login as string) ?? undefined,
        principalId: actorPrincipalId ?? undefined,
      } : undefined;

      // Resolve entity (repo)
      const repoFullName = repo?.full_name as string | undefined;
      const entity: WebhookEventEntity | undefined = repoFullName ? {
        externalRef: repoFullName,
        kind: "repo",
      } : undefined;

      const normalizedEventType = normalizeGitHubEventType(event ?? "unknown", action, payload);

      const eventId = await recordWebhookEvent(db, {
        source: "github",
        providerId: params.providerId,
        deliveryId: deliveryId ?? crypto.randomUUID(),
        eventType: event ?? "unknown",
        normalizedEventType,
        action,
        payload,
        actor,
        entity,
        actorId: actorPrincipalId,
      });

      const provider = await gitHostService.getProvider(params.providerId);
      if (!provider) {
        wlog.warn({ source: "github", providerId: params.providerId, event, repo: repoName }, `github webhook provider not found: ${params.providerId}`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "provider_not_found" });
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      // v2: webhook secret is a dedicated field in spec, separate from the API credentials
      const spec = (provider.spec ?? {}) as GitHostProviderSpec;
      let adapter;
      try {
        adapter = getGitHostAdapter(provider.type as GitHostType, {
          webhookSecret: spec.webhookSecret ?? undefined,
        });
      } catch {
        adapter = new NoopGitHostAdapter();
      }

      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      const headerRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") headerRecord[key] = value;
      }

      if (eventId) await updateWebhookEventStatus(db, eventId, { status: "processing" });

      const result = await webhookService.processWebhook(
        params.providerId,
        headerRecord,
        rawBody,
        adapter,
      );

      if (!result.accepted) {
        if (result.reason === "invalid_signature") {
          wlog.warn({ source: "github", providerId: params.providerId, event, deliveryId, repo: repoName }, `github webhook signature invalid (${event ?? "unknown"} from ${repoName ?? "unknown"})`);
        } else {
          wlog.info({ source: "github", providerId: params.providerId, event, deliveryId, repo: repoName, reason: result.reason }, `github webhook rejected: ${result.reason}`);
        }
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "failed", reason: result.reason });
        set.status = result.reason === "duplicate" ? 200 : 400;
        return { success: false, reason: result.reason };
      }

      if (eventId) await updateWebhookEventStatus(db, eventId, { status: "processed" });

      wlog.info(
        { source: "github", providerId: params.providerId, event, deliveryId, repo: repoName, actor: senderLogin, normalizedEvent: normalizedEventType },
        `github ${event ?? "unknown"} processed → ${normalizedEventType}${repoName ? ` (${repoName})` : ""}`,
      );

      return { success: true };
    },
    {
      params: t.Object({ providerId: t.String() }),
      detail: {
        tags: ["Webhooks"],
        summary: "Receive GitHub webhook",
        security: [],
      },
    },
  );
}
