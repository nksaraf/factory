import type {
  SiteObservedStatus,
  SiteSpec,
  SiteTrigger,
  SystemDeploymentObservedStatus,
} from "@smp/factory-shared/schemas/ops"
import type { WebhookEventSpec } from "@smp/factory-shared/schemas/org"
import { and, eq, sql } from "drizzle-orm"

import type { GitHostAdapter } from "../../adapters/git-host-adapter"
import type { Database } from "../../db/connection"
import { webhookEvent } from "../../db/schema/build"
import { site, systemDeployment } from "../../db/schema/ops"
import { system } from "../../db/schema/software"
import { newId } from "../../lib/id"
import { logger } from "../../logger"
import * as pipelineRunSvc from "../../services/build/pipeline-run.service"
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

  private async findPreviewParentSite(): Promise<{
    siteId: string
    previewConfig: SiteSpec["previewConfig"]
  } | null> {
    const sites = await this.db.select().from(site)
    const enabled = sites.find(
      (s) => (s.spec as SiteSpec)?.previewConfig?.enabled === true
    )
    if (!enabled) return null
    return {
      siteId: enabled.id,
      previewConfig: (enabled.spec as SiteSpec).previewConfig!,
    }
  }

  private buildPreviewSiteSlug(prNumber: number, branch: string): string {
    const safeBranch = branch
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 40)
    return `preview-pr-${prNumber}-${safeBranch}`
  }

  private async findPreviewSiteByTrigger(
    prNumber: number
  ): Promise<typeof site.$inferSelect | null> {
    const [s] = await this.db
      .select()
      .from(site)
      .where(
        and(
          eq(site.type, "preview"),
          sql`(${site.spec}->'trigger'->>'prNumber')::int = ${prNumber}`
        )
      )
      .limit(1)
    return s ?? null
  }

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
        await pipelineRunSvc.createPipelineRun(this.db, {
          triggerEvent: "pull_request",
          triggerRef: `refs/pull/${prNumber}/head`,
          commitSha: headSha,
          triggerActor: senderLogin,
        })

        const parentSite = await this.findPreviewParentSite()
        if (!parentSite) {
          logger.info(
            { repo: repoFullName, pr: prNumber },
            "No site with previews enabled, skipping"
          )
          break
        }

        const slug = this.buildPreviewSiteSlug(prNumber, headBranch)
        const existing = await this.findPreviewSiteByTrigger(prNumber)

        if (existing) {
          logger.info(
            { repo: repoFullName, pr: prNumber, slug },
            "Resetting existing preview site for reopened PR"
          )
          const trigger: SiteTrigger = {
            ...(existing.spec as SiteSpec).trigger,
            type: "pull_request",
            commitSha: headSha,
          }
          await this.db
            .update(site)
            .set({
              spec: { ...(existing.spec as SiteSpec), trigger },
              status: { phase: "pending_image" },
              updatedAt: new Date(),
            })
            .where(eq(site.id, existing.id))
          break
        }

        const ttlDays = parentSite.previewConfig?.ttlDays ?? 7
        const trigger: SiteTrigger = {
          type: "pull_request",
          repo: repoFullName,
          branch: headBranch,
          prNumber,
          commitSha: headSha,
          createdBy: senderLogin,
        }
        const siteSpec: SiteSpec = {
          parentSiteId: parentSite.siteId,
          lifecycle: "ephemeral",
          updatePolicy: "auto",
          authMode: parentSite.previewConfig?.defaultAuthMode ?? "team",
          ttl: `${ttlDays}d`,
          trigger,
          previewConfig: parentSite.previewConfig,
        }

        logger.info(
          { repo: repoFullName, pr: prNumber, branch: headBranch },
          "Creating preview site for PR"
        )

        const [newSite] = await this.db
          .insert(site)
          .values({
            slug,
            name: `PR #${prNumber}: ${(pr.title as string) ?? headBranch}`,
            type: "preview",
            parentSiteId: parentSite.siteId,
            spec: siteSpec,
            status: { phase: "pending_image" } satisfies SiteObservedStatus,
          } as typeof site.$inferInsert)
          .returning()

        const [sys] = await this.db.select().from(system).limit(1)

        if (sys) {
          await this.db.insert(systemDeployment).values({
            id: newId("sdp"),
            slug: `${slug}-${sys.slug}`,
            name: `${newSite.name} — ${sys.name}`,
            type: "preview",
            systemId: sys.id,
            siteId: newSite.id,
            spec: {
              trigger: "pr",
              createdBy: senderLogin,
              namespace: slug,
            },
            status: {
              phase: "provisioning",
            } satisfies SystemDeploymentObservedStatus,
          } as typeof systemDeployment.$inferInsert)
        }
        break
      }

      case "synchronize": {
        const existing = await this.findPreviewSiteByTrigger(prNumber)
        if (existing) {
          const trigger: SiteTrigger = {
            ...(existing.spec as SiteSpec).trigger,
            type: "pull_request",
            commitSha: headSha,
          }
          await this.db
            .update(site)
            .set({
              spec: { ...(existing.spec as SiteSpec), trigger },
              status: { phase: "pending_image" },
              updatedAt: new Date(),
            })
            .where(eq(site.id, existing.id))
          logger.info(
            { siteId: existing.id, newSha: headSha },
            "Updated preview site for new commit"
          )
        } else {
          await this.handlePullRequestEvent("opened", payload)
        }
        break
      }

      case "closed": {
        const existing = await this.findPreviewSiteByTrigger(prNumber)
        if (existing) {
          await this.db
            .update(site)
            .set({
              status: { phase: "decommissioned" },
              updatedAt: new Date(),
            })
            .where(eq(site.id, existing.id))

          const sds = await this.db
            .select()
            .from(systemDeployment)
            .where(eq(systemDeployment.siteId, existing.id))
          for (const sd of sds) {
            await this.db
              .update(systemDeployment)
              .set({
                status: { phase: "destroying" },
                updatedAt: new Date(),
              })
              .where(eq(systemDeployment.id, sd.id))
          }

          logger.info(
            { siteId: existing.id, pr: prNumber },
            "Decommissioned preview site for closed PR"
          )
        }
        break
      }

      default:
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
