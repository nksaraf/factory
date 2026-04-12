import type { SiteSpec } from "@smp/factory-shared/schemas/ops"
import type { WebhookEventSpec } from "@smp/factory-shared/schemas/org"
import { and, eq, sql } from "drizzle-orm"

import type { GitHostAdapter } from "../../adapters/git-host-adapter"
import type { Database } from "../../db/connection"
import { webhookEvent } from "../../db/schema/build"
import { site } from "../../db/schema/ops"
import { logger } from "../../logger"
import * as pipelineRunSvc from "../../services/build/pipeline-run.service"
import * as previewSvc from "../../services/preview/preview.service"
import type { GitHostService } from "./git-host.service"

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly gitHostService: GitHostService
  ) {}

  async processWebhook(
    providerId: string,
    headers: Record<string, string>,
    rawBody: string,
    adapter: GitHostAdapter
  ): Promise<{ accepted: boolean; reason?: string }> {
    // 1. Verify webhook signature
    const verification = await adapter.verifyWebhook(headers, rawBody)
    if (!verification.valid) {
      return { accepted: false, reason: "invalid_signature" }
    }

    // 2. Check for duplicate by deliveryId
    const [existing] = await this.db
      .select()
      .from(webhookEvent)
      .where(
        and(
          eq(webhookEvent.gitHostProviderId, providerId),
          eq(webhookEvent.deliveryId, verification.deliveryId)
        )
      )
      .limit(1)

    if (existing) {
      return { accepted: false, reason: "duplicate" }
    }

    // 3. Insert webhook event — eventType, action, payload, status → spec JSONB
    const [event] = await this.db
      .insert(webhookEvent)
      .values({
        gitHostProviderId: providerId,
        deliveryId: verification.deliveryId,
        spec: {
          eventType: verification.eventType,
          payload: verification.payload,
          status: "processing",
        } satisfies Partial<WebhookEventSpec>,
      })
      .returning()

    // 4. Process by event type
    try {
      await this.dispatchEvent(
        verification.eventType,
        verification.action,
        verification.payload
      )
      // status and processedAt in spec JSONB
      const updatedSpec: WebhookEventSpec = {
        ...(event.spec as WebhookEventSpec),
        status: "processed",
        processedAt: new Date(),
      }
      await this.db
        .update(webhookEvent)
        .set({ spec: updatedSpec })
        .where(eq(webhookEvent.id, event.id))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const updatedSpec: WebhookEventSpec = {
        ...(event.spec as WebhookEventSpec),
        status: "failed",
        error: errorMessage,
        processedAt: new Date(),
      }
      await this.db
        .update(webhookEvent)
        .set({ spec: updatedSpec })
        .where(eq(webhookEvent.id, event.id))
    }

    return { accepted: true }
  }

  private async dispatchEvent(
    eventType: string,
    action: string | undefined,
    payload: Record<string, unknown>
  ): Promise<void> {
    switch (eventType) {
      case "pull_request":
        await this.handlePullRequestEvent(action, payload)
        break
      case "push":
        await this.handlePushEvent(payload)
        break
      case "repository":
        break
      case "installation":
      case "installation_repositories":
        break
      default:
        break
    }
  }

  /**
   * Find a site with preview deployments enabled.
   * Site uses spec JSONB, no separate previewConfig/clusterId columns.
   */
  private async findPreviewSite(repoFullName: string): Promise<{
    siteId: string
    previewConfig: {
      enabled: boolean
      defaultAuthMode?: string
      ttlDays?: number
      maxConcurrent?: number
    }
  } | null> {
    // preview config is in site spec JSONB
    const sites = await this.db.select().from(site)

    // TODO: fix type — previewConfig is not yet in SiteSpec (belongs in TenantSpec);
    // access via intersection until the schema is updated.
    type SiteSpecWithPreviewConfig = SiteSpec & {
      previewConfig?: {
        enabled: boolean
        defaultAuthMode?: string
        ttlDays?: number
        maxConcurrent?: number
      }
    }
    const enabled = sites.find((s) => {
      const spec = s.spec as SiteSpecWithPreviewConfig
      return spec?.previewConfig?.enabled === true
    })

    if (!enabled) return null

    return {
      siteId: enabled.id,
      previewConfig: (enabled.spec as SiteSpecWithPreviewConfig).previewConfig!,
    }
  }

  /**
   * Handle pull_request webhook events for preview deployments.
   *
   * - opened/reopened → create preview (if site has previews enabled)
   * - synchronize → update preview commit SHA, reset to building
   * - closed → expire preview
   */
  private async handlePullRequestEvent(
    action: string | undefined,
    payload: Record<string, unknown>
  ): Promise<void> {
    const pr = payload.pull_request as Record<string, unknown> | undefined
    if (!pr) return

    const repo = payload.repository as Record<string, unknown> | undefined
    const repoFullName = (repo?.full_name as string) ?? ""
    const prNumber = pr.number as number
    const headBranch =
      ((pr.head as Record<string, unknown>)?.ref as string) ?? ""
    const headSha = ((pr.head as Record<string, unknown>)?.sha as string) ?? ""
    const senderLogin =
      ((payload.sender as Record<string, unknown>)?.login as string) ??
      "unknown"

    switch (action) {
      case "opened":
      case "reopened": {
        // Always create pipeline run for CI tracking
        await pipelineRunSvc.createPipelineRun(this.db, {
          triggerEvent: "pull_request",
          triggerRef: `refs/pull/${prNumber}/head`,
          commitSha: headSha,
          triggerActor: senderLogin,
        })

        // Gate preview creation on site previewConfig
        const siteResult = await this.findPreviewSite(repoFullName)
        if (!siteResult) {
          logger.info(
            { repo: repoFullName, pr: prNumber },
            "No site with previews enabled, skipping preview creation"
          )
          break
        }

        const ttlDays = siteResult.previewConfig.ttlDays ?? 7

        // Check for existing preview to handle PR reopen without duplicate slug crash
        const slug = previewSvc.buildPreviewSlug({
          prNumber,
          sourceBranch: headBranch,
          siteName: "default",
        })
        const existing = await previewSvc.getPreviewBySlug(this.db, slug)
        if (existing) {
          logger.info(
            {
              repo: repoFullName,
              pr: prNumber,
              slug,
              prevPhase: existing.phase,
            },
            "Resetting existing preview for reopened PR"
          )
          await previewSvc.updatePreviewStatus(this.db, existing.id, {
            status: "pending_image",
            commitSha: headSha,
            imageRef: null,
          })
          break
        }

        logger.info(
          {
            repo: repoFullName,
            pr: prNumber,
            branch: headBranch,
            siteId: siteResult.siteId,
          },
          "Creating preview for PR"
        )
        await previewSvc.createPreview(this.db, {
          name: `PR #${prNumber}: ${(pr.title as string) ?? headBranch}`,
          sourceBranch: headBranch,
          commitSha: headSha,
          repo: repoFullName,
          prNumber,
          siteName: "default",
          siteId: siteResult.siteId,
          ownerId: senderLogin,
          createdBy: senderLogin,
          authMode: siteResult.previewConfig.defaultAuthMode ?? "team",
          expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        })
        break
      }

      case "synchronize": {
        // PR was pushed to — update commit SHA and reset to pending_image
        const syncPreviews = await previewSvc.listPreviews(this.db, {
          repo: repoFullName,
          sourceBranch: headBranch,
        })
        const activeSyncPreviews = syncPreviews.filter(
          (p) =>
            p.prNumber === prNumber &&
            p.phase !== "expired" &&
            p.phase !== "inactive"
        )
        if (activeSyncPreviews.length > 0) {
          for (const p of activeSyncPreviews) {
            logger.info(
              { previewId: p.id, newSha: headSha },
              "Resetting preview for new commit"
            )
            await previewSvc.updatePreviewStatus(this.db, p.id, {
              commitSha: headSha,
              status: "pending_image",
              imageRef: null,
            })
          }
        } else {
          // No preview exists — bootstrap one (handles missed "opened" events)
          const syncSite = await this.findPreviewSite(repoFullName)
          if (syncSite) {
            const syncSlug = previewSvc.buildPreviewSlug({
              prNumber,
              sourceBranch: headBranch,
              siteName: "default",
            })
            const existingSync = await previewSvc.getPreviewBySlug(
              this.db,
              syncSlug
            )
            if (existingSync) {
              logger.info(
                {
                  repo: repoFullName,
                  pr: prNumber,
                  slug: syncSlug,
                  prevPhase: existingSync.phase,
                },
                "Resetting existing preview on synchronize bootstrap"
              )
              await previewSvc.updatePreviewStatus(this.db, existingSync.id, {
                status: "pending_image",
                commitSha: headSha,
                imageRef: null,
              })
            } else {
              const syncTtlDays = syncSite.previewConfig.ttlDays ?? 7
              logger.info(
                { repo: repoFullName, pr: prNumber, branch: headBranch },
                "Creating preview on synchronize (no existing preview found)"
              )
              await previewSvc.createPreview(this.db, {
                name: `PR #${prNumber}: ${(pr.title as string) ?? headBranch}`,
                sourceBranch: headBranch,
                commitSha: headSha,
                repo: repoFullName,
                prNumber,
                siteName: "default",
                siteId: syncSite.siteId,
                ownerId: senderLogin,
                createdBy: senderLogin,
                authMode: syncSite.previewConfig.defaultAuthMode ?? "team",
                expiresAt: new Date(
                  Date.now() + syncTtlDays * 24 * 60 * 60 * 1000
                ),
              })
            }
          }
        }
        break
      }

      case "closed": {
        // PR closed or merged — expire all previews for this PR
        const previews = await previewSvc.listPreviews(this.db, {
          repo: repoFullName,
          sourceBranch: headBranch,
        })
        const activePreviews = previews.filter(
          (p) =>
            p.prNumber === prNumber &&
            p.phase !== "expired" &&
            p.phase !== "inactive"
        )
        for (const p of activePreviews) {
          logger.info(
            { previewId: p.id, pr: prNumber },
            "Expiring preview for closed PR"
          )
          await previewSvc.expirePreview(this.db, p.id)
        }
        break
      }

      default:
        // Other PR actions (labeled, assigned, etc.) — no-op for now
        break
    }
  }

  /**
   * Handle push events — create a pipeline run to track CI execution.
   */
  private async handlePushEvent(
    payload: Record<string, unknown>
  ): Promise<void> {
    const ref = payload.ref as string | undefined
    const commitSha = (payload.after as string) ?? ""
    const repo = payload.repository as Record<string, unknown> | undefined
    const repoFullName = (repo?.full_name as string) ?? ""
    const senderLogin =
      ((payload.sender as Record<string, unknown>)?.login as string) ??
      "unknown"

    if (
      !ref ||
      !commitSha ||
      commitSha === "0000000000000000000000000000000000000000"
    ) {
      // Branch deletion or empty push — skip
      return
    }

    logger.info(
      { repo: repoFullName, ref, sha: commitSha },
      "Creating pipeline run for push event"
    )

    await pipelineRunSvc.createPipelineRun(this.db, {
      triggerEvent: "push",
      triggerRef: ref,
      commitSha,
      triggerActor: senderLogin,
    })
  }
}
