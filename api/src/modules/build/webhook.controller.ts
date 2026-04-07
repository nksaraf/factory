import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import { GitHostService } from "./git-host.service";
import { WebhookService } from "./webhook.service";
import { NoopGitHostAdapter } from "../../adapters/git-host-adapter-noop";
import { getGitHostAdapter } from "../../adapters/adapter-registry";
import type { GitHostType } from "../../adapters/git-host-adapter";

export function webhookController(db: Database) {
  const gitHostService = new GitHostService(db);
  const webhookService = new WebhookService(db, gitHostService);

  return new Elysia({ prefix: "/webhooks" }).post(
    "/github/:providerId",
    async ({ params, headers, body, set }) => {
      const provider = await gitHostService.getProvider(params.providerId);
      if (!provider) {
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      let adapter;
      try {
        adapter = getGitHostAdapter(provider.hostType as GitHostType, {
          webhookSecret: provider.credentialsEnc ?? undefined,
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
        set.status = result.reason === "duplicate" ? 200 : 400;
        return { success: false, reason: result.reason };
      }

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
