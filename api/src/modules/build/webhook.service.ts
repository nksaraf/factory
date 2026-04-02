import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { webhookEvent } from "../../db/schema/build";
import { fleetSite } from "../../db/schema/fleet";
import type { GitHostAdapter } from "../../adapters/git-host-adapter";
import type { GitHostService } from "./git-host.service";
import * as previewSvc from "../../services/preview/preview.service";
import * as pipelineRunSvc from "../../services/build/pipeline-run.service";
import { logger } from "../../logger";

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
    action: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case "pull_request":
        await this.handlePullRequestEvent(action, payload);
        break;
      case "push":
        await this.handlePushEvent(payload);
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

  /**
   * Find a site with preview deployments enabled.
   * Returns the site and its preview config, or null if not found or not enabled.
   */
  private async findPreviewSite(repoFullName: string): Promise<{
    siteId: string;
    clusterId: string;
    previewConfig: { enabled: boolean; defaultAuthMode?: string; ttlDays?: number; maxConcurrent?: number };
  } | null> {
    // Look for sites with previews enabled — match by product name containing the repo name
    // or find any site with previews enabled (for MVP, any enabled site can host previews)
    const sites = await this.db
      .select()
      .from(fleetSite)
      .where(sql`(${fleetSite.previewConfig}->>'enabled')::boolean = true`);

    if (sites.length === 0) return null;

    // Return the first enabled site (in future: match by repo → module → site linkage)
    const site = sites[0];
    return {
      siteId: site.siteId,
      clusterId: site.clusterId,
      previewConfig: site.previewConfig as any,
    };
  }

  /**
   * Handle pull_request webhook events for preview deployments.
   *
   * - opened/reopened → create preview (if site has previews enabled)
   * - synchronize → update preview commit SHA, reset to pending_image
   * - closed → expire preview
   */
  private async handlePullRequestEvent(
    action: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!pr) return;

    const repo = payload.repository as Record<string, unknown> | undefined;
    const repoFullName = (repo?.full_name as string) ?? "";
    const prNumber = pr.number as number;
    const headBranch = (pr.head as Record<string, unknown>)?.ref as string ?? "";
    const headSha = (pr.head as Record<string, unknown>)?.sha as string ?? "";
    const senderLogin = ((payload.sender as Record<string, unknown>)?.login as string) ?? "unknown";

    switch (action) {
      case "opened":
      case "reopened": {
        // Always create pipeline run for CI tracking
        await pipelineRunSvc.createPipelineRun(this.db, {
          triggerEvent: "pull_request",
          triggerRef: `refs/pull/${prNumber}/head`,
          commitSha: headSha,
          triggerActor: senderLogin,
        });

        // Gate preview creation on site previewConfig
        const site = await this.findPreviewSite(repoFullName);
        if (!site) {
          logger.info(
            { repo: repoFullName, pr: prNumber },
            "No site with previews enabled, skipping preview creation",
          );
          break;
        }

        const ttlDays = site.previewConfig.ttlDays ?? 7;

        // Check for existing preview to handle PR reopen without duplicate slug crash
        const slug = previewSvc.buildPreviewSlug({ prNumber, sourceBranch: headBranch, siteName: "default" });
        const existing = await previewSvc.getPreviewBySlug(this.db, slug);
        if (existing) {
          logger.info(
            { repo: repoFullName, pr: prNumber, slug, prevStatus: existing.status },
            "Resetting existing preview for reopened PR",
          );
          await previewSvc.updatePreviewStatus(this.db, existing.previewId, {
            status: "pending_image",
            commitSha: headSha,
            imageRef: null,
          });
          break;
        }

        logger.info(
          { repo: repoFullName, pr: prNumber, branch: headBranch, siteId: site.siteId },
          "Creating preview for PR",
        );
        await previewSvc.createPreview(this.db, {
          name: `PR #${prNumber}: ${(pr.title as string) ?? headBranch}`,
          sourceBranch: headBranch,
          commitSha: headSha,
          repo: repoFullName,
          prNumber,
          siteName: "default",
          siteId: site.siteId,
          clusterId: site.clusterId,
          ownerId: senderLogin,
          createdBy: senderLogin,
          authMode: site.previewConfig.defaultAuthMode ?? "team",
          expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        });
        break;
      }

      case "synchronize": {
        // PR was pushed to — update commit SHA and reset to pending_image
        const previews = await previewSvc.listPreviews(this.db, {
          repo: repoFullName,
          sourceBranch: headBranch,
        });
        const activePreviews = previews.filter(
          (p) => p.prNumber === prNumber && p.status !== "expired" && p.status !== "inactive",
        );
        if (activePreviews.length > 0) {
          for (const p of activePreviews) {
            logger.info(
              { previewId: p.previewId, newSha: headSha },
              "Resetting preview for new commit",
            );
            await previewSvc.updatePreviewStatus(this.db, p.previewId, {
              commitSha: headSha,
              status: "pending_image",
              imageRef: null,
            });
          }
        } else {
          // No preview exists — bootstrap one (handles missed "opened" events)
          const site = await this.findPreviewSite(repoFullName);
          if (site) {
            const ttlDays = site.previewConfig.ttlDays ?? 7;
            logger.info(
              { repo: repoFullName, pr: prNumber, branch: headBranch },
              "Creating preview on synchronize (no existing preview found)",
            );
            await previewSvc.createPreview(this.db, {
              name: `PR #${prNumber}: ${(pr.title as string) ?? headBranch}`,
              sourceBranch: headBranch,
              commitSha: headSha,
              repo: repoFullName,
              prNumber,
              siteName: "default",
              siteId: site.siteId,
              clusterId: site.clusterId,
              ownerId: senderLogin,
              createdBy: senderLogin,
              authMode: site.previewConfig.defaultAuthMode ?? "team",
              expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
            });
          }
        }
        break;
      }

      case "closed": {
        // PR closed or merged — expire all previews for this PR
        const previews = await previewSvc.listPreviews(this.db, {
          repo: repoFullName,
          sourceBranch: headBranch,
        });
        const activePreviews = previews.filter(
          (p) => p.prNumber === prNumber && p.status !== "expired" && p.status !== "inactive",
        );
        for (const p of activePreviews) {
          logger.info(
            { previewId: p.previewId, pr: prNumber },
            "Expiring preview for closed PR",
          );
          await previewSvc.expirePreview(this.db, p.previewId);
        }
        break;
      }

      default:
        // Other PR actions (labeled, assigned, etc.) — no-op for now
        break;
    }
  }

  /**
   * Handle push events — create a pipeline run to track CI execution.
   */
  private async handlePushEvent(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const ref = payload.ref as string | undefined;
    const commitSha = (payload.after as string) ?? "";
    const repo = payload.repository as Record<string, unknown> | undefined;
    const repoFullName = (repo?.full_name as string) ?? "";
    const senderLogin = ((payload.sender as Record<string, unknown>)?.login as string) ?? "unknown";

    if (!ref || !commitSha || commitSha === "0000000000000000000000000000000000000000") {
      // Branch deletion or empty push — skip
      return;
    }

    logger.info(
      { repo: repoFullName, ref, sha: commitSha },
      "Creating pipeline run for push event",
    );

    await pipelineRunSvc.createPipelineRun(this.db, {
      triggerEvent: "push",
      triggerRef: ref,
      commitSha,
      triggerActor: senderLogin,
    });
  }
}
