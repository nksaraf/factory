import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import { GitHostService } from "./git-host.service";
import { WebhookService } from "./webhook.service";
import { NoopGitHostAdapter } from "../../adapters/git-host-adapter-noop";
import { getGitHostAdapter } from "../../adapters/adapter-registry";
import type { GitHostType } from "../../adapters/git-host-adapter";
import type { GitHostProviderSpec } from "@smp/factory-shared/schemas/build";
import { logger } from "../../logger";

const wlog = logger.child({ module: "webhook" });

export function webhookController(db: Database) {
  const gitHostService = new GitHostService(db);
  const webhookService = new WebhookService(db, gitHostService);

  return new Elysia({ prefix: "/webhooks" }).post(
    "/github/:providerId",
    async ({ params, headers, body, set }) => {
      const event = headers["x-github-event"] as string | undefined;
      const deliveryId = headers["x-github-delivery"] as string | undefined;

      wlog.info(
        { source: "github", providerId: params.providerId, event, deliveryId },
        "webhook received",
      );

      const provider = await gitHostService.getProvider(params.providerId);
      if (!provider) {
        wlog.warn({ source: "github", providerId: params.providerId }, "webhook provider not found");
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

      const result = await webhookService.processWebhook(
        params.providerId,
        headerRecord,
        rawBody,
        adapter,
      );

      if (!result.accepted) {
        if (result.reason === "invalid_signature") {
          wlog.warn({ source: "github", providerId: params.providerId, event, deliveryId }, "webhook signature invalid");
        }
        set.status = result.reason === "duplicate" ? 200 : 400;
        return { success: false, reason: result.reason };
      }

      wlog.info(
        { source: "github", providerId: params.providerId, event, deliveryId },
        "webhook processed",
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
