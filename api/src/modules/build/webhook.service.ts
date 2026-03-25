import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { webhookEvent } from "../../db/schema/build";
import type { GitHostAdapter } from "../../adapters/git-host-adapter";
import type { GitHostService } from "./git-host.service";

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly gitHostService: GitHostService,
  ) {}

  async processWebhook(
    providerId: string,
    headers: Record<string, string>,
    rawBody: string,
    adapter: GitHostAdapter,
  ): Promise<{ accepted: boolean; reason?: string }> {
    // 1. Verify webhook signature
    const verification = await adapter.verifyWebhook(headers, rawBody);
    if (!verification.valid) {
      return { accepted: false, reason: "invalid_signature" };
    }

    // 2. Check for duplicate by deliveryId
    const [existing] = await this.db
      .select()
      .from(webhookEvent)
      .where(
        and(
          eq(webhookEvent.gitHostProviderId, providerId),
          eq(webhookEvent.deliveryId, verification.deliveryId),
        ),
      )
      .limit(1);

    if (existing) {
      return { accepted: false, reason: "duplicate" };
    }

    // 3. Insert webhook event
    const [event] = await this.db
      .insert(webhookEvent)
      .values({
        gitHostProviderId: providerId,
        deliveryId: verification.deliveryId,
        eventType: verification.eventType,
        action: verification.action ?? null,
        payload: verification.payload,
        status: "processing",
      })
      .returning();

    // 4. Process by event type
    try {
      await this.dispatchEvent(
        verification.eventType,
        verification.action,
        verification.payload,
      );
      await this.db
        .update(webhookEvent)
        .set({ status: "completed", processedAt: new Date() })
        .where(eq(webhookEvent.webhookEventId, event.webhookEventId));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db
        .update(webhookEvent)
        .set({ status: "failed", errorMessage, processedAt: new Date() })
        .where(eq(webhookEvent.webhookEventId, event.webhookEventId));
    }

    return { accepted: true };
  }

  private async dispatchEvent(
    eventType: string,
    _action: string | undefined,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case "push":
        break;
      case "repository":
        break;
      case "installation":
      case "installation_repositories":
        break;
      default:
        break;
    }
  }
}
