import type {
  PreviewSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import { eq } from "drizzle-orm"

import type { GitHostAdapter } from "../adapters/git-host-adapter"
import type { Database } from "../db/connection"
import { realm } from "../db/schema/infra"
import { preview, site, systemDeployment, workbench } from "../db/schema/ops"
import type { KubeClient } from "../lib/kube-client"
import { emitEvent } from "../lib/events"
import { logger } from "../logger"
import {
  createRoute,
  lookupRouteByDomain,
  updateRoute,
} from "../modules/infra/gateway.service"
import * as previewSvc from "../services/preview/preview.service"
import { generatePreviewResources } from "./preview-resource-generator"

const DEFAULT_PREVIEW_PORT = 8080
const CHECK_NAME = "dx/preview"
const COMMENT_MARKER = (slug: string) => `<!-- dx-preview:${slug} -->`

type PreviewRow = typeof preview.$inferSelect

export class PreviewReconciler {
  constructor(
    private db: Database,
    private kube: KubeClient,
    private gitHost?: GitHostAdapter
  ) {}

  async reconcilePreview(previewId: string): Promise<void> {
    const prev = await this.loadPreview(previewId)
    if (!prev) throw new Error(`Preview not found: ${previewId}`)

    if (prev.strategy === "dev") {
      await this.reconcileDevStrategy(prev)
    } else {
      await this.reconcileDeployStrategy(prev)
    }
  }

  // ---------------------------------------------------------------------------
  // Deploy strategy state machine
  // ---------------------------------------------------------------------------

  private async reconcileDeployStrategy(prev: PreviewRow): Promise<void> {
    switch (prev.phase) {
      case "pending_image":
        await this.handlePendingImage(prev)
        break
      case "building":
        await this.handleBuilding(prev)
        break
      case "deploying":
        await this.handleDeploying(prev)
        break
      case "active":
      case "inactive":
      case "expired":
      case "failed":
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Dev strategy state machine
  // ---------------------------------------------------------------------------

  private async reconcileDevStrategy(prev: PreviewRow): Promise<void> {
    switch (prev.phase) {
      case "provisioning":
        await this.handleProvisioning(prev)
        break
      case "starting":
        await this.handleStarting(prev)
        break
      case "active":
      case "inactive":
      case "expired":
      case "failed":
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Deploy strategy handlers
  // ---------------------------------------------------------------------------

  private async handlePendingImage(prev: PreviewRow): Promise<void> {
    if (!prev.spec.githubDeploymentId) {
      await this.ensureGitHubDeployment(prev)
    }
    await this.createOrUpdateCheck(prev, "queued")
    await this.upsertPRComment(prev, this.buildPendingComment(prev))
    await this.updateDeploymentStatus(
      prev,
      "pending",
      "Waiting for CI to build image"
    )
  }

  private async handleBuilding(prev: PreviewRow): Promise<void> {
    const spec = prev.spec
    if (spec.imageRef) {
      await this.updatePhase(prev.id, "deploying")
      return
    }

    if (!prev.workbenchId) {
      const wb = await this.createPreviewWorkbench(
        prev,
        "preview-build",
        "provisioning"
      )
      if (!wb) return
      await this.db
        .update(preview)
        .set({ workbenchId: wb.id, updatedAt: new Date() })
        .where(eq(preview.id, prev.id))
      prev = (await this.loadPreview(prev.id))!
    }

    const wks = await this.loadWorkbench(prev.workbenchId!)
    if (!wks) return
    const wksSpec = (wks.spec ?? {}) as Record<string, any>
    if (!wksSpec.podName) return

    if (!wks.realmId) return
    const rt = await this.loadRealm(wks.realmId)
    if (!rt) return
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    if (!rtSpec.kubeconfigRef) return

    const kubeconfig = rtSpec.kubeconfigRef
    const ns = `workbench-${wks.slug}`
    const podName = wksSpec.podName

    await this.createOrUpdateCheck(prev, "in_progress")
    await this.upsertPRComment(prev, this.buildBuildingComment(prev))
    await this.updateDeploymentStatus(prev, "in_progress", "Building image")

    const repo = spec.repo ?? ""
    const slug = prev.slug ?? prev.id
    const imageTag = `${repo.split("/").pop() ?? "app"}:preview-${slug}`
    const registryPrefix = process.env.PREVIEW_REGISTRY ?? "registry.dx.dev"
    const fullImageRef = `${registryPrefix}/${imageTag}`

    try {
      const buildResult = await this.kube.execInPod(
        kubeconfig,
        ns,
        podName,
        "workbench",
        ["docker", "build", "-t", fullImageRef, "/workspaces"],
        { timeoutMs: 600_000 }
      )

      if (buildResult.exitCode !== 0) {
        await this.failPreview(
          prev,
          `Build failed: ${buildResult.stderr.slice(0, 500)}`
        )
        return
      }

      const pushResult = await this.kube.execInPod(
        kubeconfig,
        ns,
        podName,
        "workbench",
        ["docker", "push", fullImageRef],
        { timeoutMs: 300_000 }
      )

      if (pushResult.exitCode !== 0) {
        await this.failPreview(
          prev,
          `Push failed: ${pushResult.stderr.slice(0, 500)}`
        )
        return
      }

      await this.db
        .update(preview)
        .set({
          phase: "deploying",
          spec: { ...spec, imageRef: fullImageRef },
          updatedAt: new Date(),
        })
        .where(eq(preview.id, prev.id))

      logger.info(
        { previewId: prev.id, imageRef: fullImageRef },
        "Preview build complete, deploying"
      )
    } catch (err) {
      await this.failPreview(prev, `Build error: ${String(err).slice(0, 500)}`)
    }
  }

  private async handleDeploying(prev: PreviewRow): Promise<void> {
    const spec = prev.spec
    if (!spec.imageRef) {
      await this.failPreview(prev, "No image to deploy")
      return
    }

    const realmId =
      prev.realmId ?? (await this.resolveRealmId(prev.systemDeploymentId))
    if (!realmId) {
      await this.failPreview(prev, "No realm for deployment")
      return
    }

    const rt = await this.loadRealm(realmId)
    if (!rt) {
      await this.failPreview(prev, "Realm not found")
      return
    }
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    if (!rtSpec.kubeconfigRef) {
      await this.failPreview(prev, "No kubeconfig for realm")
      return
    }

    const kubeconfig = rtSpec.kubeconfigRef

    let port = DEFAULT_PREVIEW_PORT
    if (prev.siteId) {
      const [siteRow] = await this.db
        .select({ spec: site.spec })
        .from(site)
        .where(eq(site.id, prev.siteId))
        .limit(1)
      const siteSpec = siteRow?.spec as SiteSpec | undefined
      if (siteSpec?.previewConfig?.containerPort) {
        port = siteSpec.previewConfig.containerPort
      }
    }

    if (!prev.systemDeploymentId) {
      const sd = await this.createPreviewSystemDeployment(
        prev,
        realmId,
        "kubernetes"
      )
      if (sd) {
        await this.db
          .update(preview)
          .set({
            systemDeploymentId: sd.id,
            realmId,
            updatedAt: new Date(),
          })
          .where(eq(preview.id, prev.id))
        prev = (await this.loadPreview(prev.id))!
      }
    }

    await this.createOrUpdateCheck(prev, "in_progress")
    await this.upsertPRComment(prev, this.buildDeployingComment(prev))
    await this.updateDeploymentStatus(
      prev,
      "in_progress",
      `Deploying ${spec.imageRef}`
    )

    try {
      const slug = prev.slug ?? prev.id
      const resources = generatePreviewResources({
        previewSlug: slug,
        previewId: prev.id,
        imageRef: spec.imageRef,
        port,
      })

      for (const resource of resources) {
        await this.kube.apply(kubeconfig, resource)
      }

      const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "lepton.software"
      const previewDomain = `${slug}.preview.${gatewayDomain}`
      const existingRoute = await lookupRouteByDomain(this.db, previewDomain)
      const previewServiceHost = `preview-${slug}.preview-${slug}.svc.cluster.local`

      if (existingRoute) {
        await updateRoute(this.db, existingRoute.id, {
          targetService: previewServiceHost,
          targetPort: port,
          status: "active",
        })
      } else {
        await createRoute(this.db, {
          type: "preview",
          domain: previewDomain,
          targetService: previewServiceHost,
          targetPort: port,
          systemDeploymentId: prev.systemDeploymentId ?? undefined,
          status: "active",
          createdBy: "reconciler",
        })
      }

      await this.updatePhase(prev.id, "active")
      if (prev.systemDeploymentId) {
        const sdExisting = await this.db
          .select()
          .from(systemDeployment)
          .where(eq(systemDeployment.id, prev.systemDeploymentId))
          .limit(1)
          .then((r) => r[0])
        const sdSpec: SystemDeploymentSpec = {
          ...(sdExisting?.spec ?? ({} as SystemDeploymentSpec)),
          status: "active",
        }
        await this.db
          .update(systemDeployment)
          .set({ spec: sdSpec })
          .where(eq(systemDeployment.id, prev.systemDeploymentId))
      }

      logger.info(
        { previewId: prev.id, domain: previewDomain },
        "Preview deployed and active"
      )

      const previewUrl = `https://${previewDomain}`
      await this.onPreviewActive(prev, previewUrl)
    } catch (err) {
      await this.failPreview(prev, `Deploy error: ${String(err).slice(0, 500)}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Dev strategy handlers
  // ---------------------------------------------------------------------------

  private async handleProvisioning(prev: PreviewRow): Promise<void> {
    if (!prev.spec.githubDeploymentId) {
      await this.ensureGitHubDeployment(prev)
    }
    await this.createOrUpdateCheck(prev, "in_progress")
    await this.upsertPRComment(prev, this.buildProvisioningComment(prev))

    if (!prev.workbenchId) {
      const wb = await this.createPreviewWorkbench(
        prev,
        "preview-dev",
        "provisioning"
      )
      if (!wb) {
        await this.failPreview(prev, "Failed to create dev workbench")
        return
      }
      await this.db
        .update(preview)
        .set({ workbenchId: wb.id, updatedAt: new Date() })
        .where(eq(preview.id, prev.id))
      prev = (await this.loadPreview(prev.id))!
    }

    const wks = await this.loadWorkbench(prev.workbenchId!)
    if (!wks) return
    if (!wks.realmId) return

    const rt = await this.loadRealm(wks.realmId)
    if (!rt) return
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    if (!rtSpec.kubeconfigRef) return

    const kubeconfig = rtSpec.kubeconfigRef
    const wksSpec = (wks.spec ?? {}) as Record<string, any>
    const ns = `workbench-${wks.slug}`

    try {
      if (!wksSpec.podName) {
        logger.info(
          { previewId: prev.id, workbenchId: wks.id },
          "Waiting for workbench pod to be ready"
        )
        return
      }

      const repo = prev.spec.repo ?? ""
      const branch = prev.sourceBranch
      const cloneResult = await this.kube.execInPod(
        kubeconfig,
        ns,
        wksSpec.podName,
        "workbench",
        [
          "git",
          "clone",
          "--branch",
          branch,
          "--depth",
          "1",
          `https://github.com/${repo}.git`,
          "/workspaces/project",
        ],
        { timeoutMs: 300_000 }
      )

      if (cloneResult.exitCode !== 0) {
        await this.failPreview(
          prev,
          `Clone failed: ${cloneResult.stderr.slice(0, 500)}`
        )
        return
      }

      await this.db
        .update(preview)
        .set({
          phase: "starting",
          realmId: wks.realmId,
          updatedAt: new Date(),
        })
        .where(eq(preview.id, prev.id))

      logger.info(
        { previewId: prev.id, workbenchId: wks.id },
        "Dev workbench provisioned, starting dx dev"
      )
    } catch (err) {
      await this.failPreview(
        prev,
        `Provisioning error: ${String(err).slice(0, 500)}`
      )
    }
  }

  private async handleStarting(prev: PreviewRow): Promise<void> {
    const wks = prev.workbenchId
      ? await this.loadWorkbench(prev.workbenchId)
      : null
    if (!wks || !wks.realmId) {
      await this.failPreview(prev, "No workbench for dev preview")
      return
    }

    const rt = await this.loadRealm(wks.realmId)
    if (!rt) {
      await this.failPreview(prev, "Realm not found for dev preview")
      return
    }
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    if (!rtSpec.kubeconfigRef) {
      await this.failPreview(prev, "No kubeconfig for dev realm")
      return
    }

    const kubeconfig = rtSpec.kubeconfigRef
    const wksSpec = (wks.spec ?? {}) as Record<string, any>
    if (!wksSpec.podName) return

    const ns = `workbench-${wks.slug}`

    try {
      if (!prev.systemDeploymentId) {
        const sd = await this.createPreviewSystemDeployment(
          prev,
          wks.realmId,
          "native"
        )
        if (sd) {
          await this.db
            .update(preview)
            .set({ systemDeploymentId: sd.id, updatedAt: new Date() })
            .where(eq(preview.id, prev.id))
          prev = (await this.loadPreview(prev.id))!
        }
      }

      await this.kube.execInPod(
        kubeconfig,
        ns,
        wksSpec.podName,
        "workbench",
        [
          "sh",
          "-c",
          "cd /workspaces/project && nohup dx dev > /tmp/dx-dev.log 2>&1 &",
        ],
        { timeoutMs: 30_000 }
      )

      const slug = prev.slug ?? prev.id
      const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "lepton.software"
      const previewDomain = `${slug}.preview.${gatewayDomain}`
      const previewServiceHost = `preview-${slug}.preview-${slug}.svc.cluster.local`
      const port = DEFAULT_PREVIEW_PORT

      const existingRoute = await lookupRouteByDomain(this.db, previewDomain)
      if (existingRoute) {
        await updateRoute(this.db, existingRoute.id, {
          targetService: previewServiceHost,
          targetPort: port,
          status: "active",
        })
      } else {
        await createRoute(this.db, {
          type: "preview",
          domain: previewDomain,
          targetService: previewServiceHost,
          targetPort: port,
          systemDeploymentId: prev.systemDeploymentId ?? undefined,
          status: "active",
          createdBy: "reconciler",
        })
      }

      await this.updatePhase(prev.id, "active")

      if (prev.systemDeploymentId) {
        const sdExisting = await this.db
          .select()
          .from(systemDeployment)
          .where(eq(systemDeployment.id, prev.systemDeploymentId))
          .limit(1)
          .then((r) => r[0])
        const sdSpec: SystemDeploymentSpec = {
          ...(sdExisting?.spec ?? ({} as SystemDeploymentSpec)),
          status: "active",
        }
        await this.db
          .update(systemDeployment)
          .set({ spec: sdSpec })
          .where(eq(systemDeployment.id, prev.systemDeploymentId))
      }

      const previewUrl = `https://${previewDomain}`
      await this.onPreviewActive(prev, previewUrl)

      logger.info(
        { previewId: prev.id, domain: previewDomain },
        "Dev preview active"
      )
    } catch (err) {
      await this.failPreview(
        prev,
        `Starting error: ${String(err).slice(0, 500)}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Entity creation helpers
  // ---------------------------------------------------------------------------

  private async createPreviewWorkbench(
    prev: PreviewRow,
    type: string,
    lifecycle: string
  ) {
    try {
      const slug = `preview-${prev.slug ?? prev.id}`
      const [wb] = await this.db
        .insert(workbench)
        .values({
          slug,
          name: `Preview workbench: ${prev.slug ?? prev.id}`,
          type,
          siteId: prev.siteId,
          ownerId: prev.ownerId,
          spec: {
            lifecycle,
            trigger: "preview",
            sourceBranch: prev.sourceBranch,
            commitSha: prev.spec.commitSha,
          } as unknown as WorkbenchSpec,
        })
        .returning()
      return wb
    } catch (err) {
      logger.error(
        { previewId: prev.id, err },
        "Failed to create preview workbench"
      )
      return null
    }
  }

  private async createPreviewSystemDeployment(
    prev: PreviewRow,
    realmId: string,
    runtime: string
  ) {
    const systemId =
      prev.spec.systemId ?? (await this.resolveSystemIdFromRepo(prev.spec.repo))
    if (!systemId) {
      logger.warn(
        { previewId: prev.id },
        "No systemId found for preview, skipping SD creation"
      )
      return null
    }

    try {
      const slug = `preview-${prev.slug ?? prev.id}`
      const [sd] = await this.db
        .insert(systemDeployment)
        .values({
          slug,
          name: `Preview: ${prev.slug ?? prev.id}`,
          type: "preview",
          systemId,
          siteId: prev.siteId,
          realmId,
          workbenchId: prev.workbenchId,
          spec: {
            status: "provisioning",
            trigger: "preview",
            runtime,
          } as unknown as SystemDeploymentSpec,
        })
        .returning()
      return sd
    } catch (err) {
      logger.error(
        { previewId: prev.id, err },
        "Failed to create preview system deployment"
      )
      return null
    }
  }

  private async resolveSystemIdFromRepo(
    repoFullName?: string
  ): Promise<string | null> {
    if (!repoFullName) return null
    return previewSvc.resolveSystemIdFromRepo(this.db, repoFullName)
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: PR comments
  // ---------------------------------------------------------------------------

  private async upsertPRComment(prev: PreviewRow, body: string): Promise<void> {
    const spec = prev.spec
    if (!this.gitHost || !prev.prNumber || !spec.repo) return

    const slug = prev.slug ?? prev.id
    const marker = COMMENT_MARKER(slug)
    const fullBody = `${marker}\n${body}`

    try {
      if (spec.githubCommentId) {
        await this.gitHost.updatePRComment(
          spec.repo,
          spec.githubCommentId,
          fullBody
        )
      } else {
        const comments = await this.gitHost.listPRComments(
          spec.repo,
          prev.prNumber
        )
        const existing = comments.find((c) => c.body.includes(marker))

        if (existing) {
          await this.gitHost.updatePRComment(
            spec.repo,
            existing.commentId,
            fullBody
          )
          await this.db
            .update(preview)
            .set({ spec: { ...spec, githubCommentId: existing.commentId } })
            .where(eq(preview.id, prev.id))
        } else {
          const { commentId } = await this.gitHost.postPRComment(
            spec.repo,
            prev.prNumber,
            fullBody
          )
          await this.db
            .update(preview)
            .set({ spec: { ...spec, githubCommentId: Number(commentId) } })
            .where(eq(preview.id, prev.id))
        }
      }
    } catch (err) {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to upsert PR comment"
      )
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: Deployments API
  // ---------------------------------------------------------------------------

  private async ensureGitHubDeployment(prev: PreviewRow): Promise<void> {
    const spec = prev.spec
    if (!this.gitHost || !spec.repo) return

    try {
      const slug = prev.slug ?? prev.id
      const { deploymentId } = await this.gitHost.createDeployment(spec.repo, {
        ref: spec.commitSha ?? "",
        environment: `preview/${slug}`,
        description: `Preview for ${prev.sourceBranch}`,
        autoMerge: false,
        requiredContexts: [],
      })

      await this.db
        .update(preview)
        .set({ spec: { ...spec, githubDeploymentId: deploymentId } })
        .where(eq(preview.id, prev.id))
    } catch (err) {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to create GitHub deployment"
      )
    }
  }

  private async updateDeploymentStatus(
    prev: PreviewRow,
    state:
      | "pending"
      | "in_progress"
      | "success"
      | "failure"
      | "error"
      | "inactive",
    description: string,
    environmentUrl?: string
  ): Promise<void> {
    const spec = prev.spec
    if (!this.gitHost || !spec.repo || !spec.githubDeploymentId) return

    try {
      await this.gitHost.createDeploymentStatus(
        spec.repo,
        spec.githubDeploymentId,
        {
          state,
          description,
          environmentUrl,
        }
      )
    } catch (err) {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to update deployment status"
      )
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: Check runs
  // ---------------------------------------------------------------------------

  private async createOrUpdateCheck(
    prev: PreviewRow,
    status: "queued" | "in_progress"
  ): Promise<string | null> {
    const spec = prev.spec
    if (!this.gitHost || !prev.prNumber || !spec.repo) return null

    const commitSha = spec.commitSha ?? ""
    const summaries: Record<string, { title: string; summary: string }> = {
      queued: {
        title: "Preview Queued",
        summary: `Waiting for CI to build and push image for \`${prev.sourceBranch}\``,
      },
      in_progress: {
        title:
          prev.strategy === "dev"
            ? "Provisioning Dev Preview"
            : "Deploying Preview",
        summary: `${prev.strategy === "dev" ? "Provisioning dev environment" : "Deploying preview"} for \`${prev.sourceBranch}\` (\`${commitSha.slice(0, 7)}\`)${spec.imageRef ? `\n\n**Image:** \`${spec.imageRef}\`` : ""}`,
      },
    }

    try {
      const { checkRunId } = await this.gitHost.createCheckRun(spec.repo, {
        name: CHECK_NAME,
        headSha: commitSha,
        status,
        output: summaries[status],
      })
      return checkRunId
    } catch (err) {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to create check run"
      )
      return null
    }
  }

  private async completeCheck(
    prev: PreviewRow,
    conclusion: "success" | "failure",
    previewUrl?: string,
    errorMessage?: string
  ): Promise<void> {
    const spec = prev.spec
    if (!this.gitHost || !spec.repo) return

    const commitSha = spec.commitSha ?? ""
    const expiresAt = spec.expiresAt
      ? new Date(spec.expiresAt).toISOString().split("T")[0]
      : "N/A"

    const output =
      conclusion === "success"
        ? {
            title: "Preview Active",
            summary: [
              `Preview deployed successfully.`,
              "",
              `**URL:** ${previewUrl}`,
              prev.strategy === "deploy"
                ? `**Image:** \`${spec.imageRef}\``
                : `**Strategy:** dev (source-based)`,
              `**Commit:** \`${commitSha.slice(0, 7)}\``,
              `**Expires:** ${expiresAt}`,
            ].join("\n"),
          }
        : {
            title: "Preview Failed",
            summary: errorMessage ?? "Preview deployment failed",
          }

    try {
      await this.gitHost.createCheckRun(spec.repo, {
        name: CHECK_NAME,
        headSha: commitSha,
        status: "completed",
        conclusion,
        detailsUrl: previewUrl,
        output,
      })
    } catch (err) {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to complete check run"
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  private async onPreviewActive(
    prev: PreviewRow,
    previewUrl: string
  ): Promise<void> {
    await this.upsertPRComment(prev, this.buildActiveComment(prev, previewUrl))
    await this.completeCheck(prev, "success", previewUrl)
    await this.updateDeploymentStatus(
      prev,
      "success",
      "Preview is live",
      previewUrl
    )

    const spec = prev.spec
    await emitEvent(this.db, {
      topic: "ops.preview.ready",
      source: "reconciler",
      severity: "info",
      schemaVersion: 1,
      entityKind: "preview",
      data: {
        branchName: prev.sourceBranch,
        previewUrl,
        previewSlug: prev.slug ?? "",
        strategy: prev.strategy,
      },
    }).catch((err) => {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to emit preview.ready event"
      )
    })
  }

  private async failPreview(prev: PreviewRow, message: string): Promise<void> {
    await this.updatePhase(prev.id, "failed", message)
    await this.upsertPRComment(prev, this.buildFailedComment(prev, message))
    await this.completeCheck(prev, "failure", undefined, message)
    await this.updateDeploymentStatus(prev, "failure", message)
    logger.error({ previewId: prev.id }, message)
  }

  // ---------------------------------------------------------------------------
  // PR comment templates
  // ---------------------------------------------------------------------------

  private buildPendingComment(prev: PreviewRow): string {
    const spec = prev.spec
    const commitSha = spec.commitSha ?? ""
    return [
      `### \u23f3 Preview Deployment \u2014 Waiting for Build`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\udd04 Waiting for CI to build image |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      `| **Triggered** | ${this.timeAgo(prev.createdAt)} |`,
      "",
      `> \u26a1 Push an image via CI or \`dx preview deploy --image <ref>\``,
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private buildBuildingComment(prev: PreviewRow): string {
    const commitSha = prev.spec.commitSha ?? ""
    return [
      `### \ud83d\udd28 Preview Deployment \u2014 Building`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\udea7 Building image |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private buildDeployingComment(prev: PreviewRow): string {
    const spec = prev.spec
    const commitSha = spec.commitSha ?? ""
    return [
      `### \ud83d\udd28 Preview Deployment \u2014 Deploying`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\ude80 Deploying \`${spec.imageRef}\` |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private buildProvisioningComment(prev: PreviewRow): string {
    const commitSha = prev.spec.commitSha ?? ""
    return [
      `### \ud83d\udd28 Dev Preview \u2014 Provisioning`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\udea7 Setting up dev environment |`,
      `| **Strategy** | \`dev\` (source-based) |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private buildActiveComment(prev: PreviewRow, previewUrl: string): string {
    const spec = prev.spec
    const commitSha = spec.commitSha ?? ""
    const slug = prev.slug ?? prev.id
    const expiresAtDate = spec.expiresAt ? new Date(spec.expiresAt) : null
    const expiresAt = expiresAtDate
      ? `in ${Math.ceil((expiresAtDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} days`
      : "never"

    return [
      `### \u2705 Preview ${prev.strategy === "dev" ? "(Dev)" : "Deployment"} \u2014 Live`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Preview** | \ud83d\udd17 [${previewUrl.replace("https://", "")}](${previewUrl}) |`,
      `| **Status** | \u2705 Active |`,
      `| **Strategy** | \`${prev.strategy}\` |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      ...(prev.strategy === "deploy" && spec.imageRef
        ? [`| **Image** | \`${spec.imageRef}\` |`]
        : []),
      `| **Expires** | ${expiresAt} |`,
      "",
      `<details>`,
      `<summary>\ud83d\udee0 Quick Actions</summary>`,
      "",
      "```bash",
      `# Open in browser`,
      `dx preview open ${slug}`,
      "",
      `# View status`,
      `dx preview show ${slug}`,
      "",
      `# Extend TTL`,
      `dx preview extend ${slug} --days 14`,
      "",
      `# Destroy`,
      `dx preview destroy ${slug}`,
      "```",
      `</details>`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private buildFailedComment(prev: PreviewRow, errorMessage: string): string {
    const commitSha = prev.spec.commitSha ?? ""
    return [
      `### \u274c Preview ${prev.strategy === "dev" ? "(Dev)" : "Deployment"} \u2014 Failed`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \u274c ${prev.strategy === "dev" ? "Provisioning" : "Deploy"} failed |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      "",
      `<details>`,
      `<summary>\ud83d\udccb Error Details</summary>`,
      "",
      "```",
      errorMessage,
      "```",
      `</details>`,
      "",
      `> \ud83d\udd04 Push a fix or run \`dx preview deploy --image <new-ref>\` to retry`,
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n")
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  private async updatePhase(
    previewId: string,
    phase: string,
    statusMessage?: string
  ): Promise<void> {
    const existing = await this.loadPreview(previewId)
    if (!existing) return
    const specUpdate =
      statusMessage !== undefined
        ? { ...existing.spec, statusMessage }
        : existing.spec
    await this.db
      .update(preview)
      .set({
        phase,
        spec: specUpdate,
        updatedAt: new Date(),
      })
      .where(eq(preview.id, previewId))
  }

  private async loadPreview(previewId: string) {
    const [row] = await this.db
      .select()
      .from(preview)
      .where(eq(preview.id, previewId))
      .limit(1)
    return row ?? null
  }

  private async loadWorkbench(workbenchId: string) {
    const [row] = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.id, workbenchId))
      .limit(1)
    return row ?? null
  }

  private async loadRealm(realmId: string) {
    const [row] = await this.db
      .select()
      .from(realm)
      .where(eq(realm.id, realmId))
      .limit(1)
    return row ?? null
  }

  private async resolveRealmId(
    systemDeploymentId?: string | null
  ): Promise<string | null> {
    if (!systemDeploymentId) return null
    const [sd] = await this.db
      .select()
      .from(systemDeployment)
      .where(eq(systemDeployment.id, systemDeploymentId))
      .limit(1)
    return sd?.realmId ?? null
  }
}
