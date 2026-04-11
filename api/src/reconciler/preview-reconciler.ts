import type {
  PreviewSpec,
  SiteSpec,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import { eq } from "drizzle-orm"

import type { GitHostAdapter } from "../adapters/git-host-adapter"
import type { Database } from "../db/connection"
import { realm } from "../db/schema/infra-v2"
import { preview, site, systemDeployment, workspace } from "../db/schema/ops"
import type { KubeClient } from "../lib/kube-client"
import { emitEvent } from "../lib/workflow-events"
import { logger } from "../logger"
import {
  createRoute,
  lookupRouteByDomain,
  updateRoute,
} from "../modules/infra/gateway.service"
import { generatePreviewResources } from "./preview-resource-generator"

const DEFAULT_PREVIEW_PORT = 8080
const CHECK_NAME = "dx/preview"
const COMMENT_MARKER = (slug: string) => `<!-- dx-preview:${slug} -->`

type PreviewRow = typeof preview.$inferSelect

// TODO: fix type — these fields are stored in preview.spec but not yet in PreviewSpec schema.
// Add them to PreviewSpecSchema in shared/src/schemas/ops.ts when the schema is updated.
type PreviewSpecStored = PreviewSpec & {
  slug?: string
  workspaceId?: string
  systemDeploymentId?: string
  realmId?: string
}

/** Helper: read preview.spec JSONB as PreviewSpecStored. */
function pspec(prev: PreviewRow): PreviewSpecStored {
  return (prev.spec ?? {}) as PreviewSpecStored
}

/**
 * Preview reconciler state machine.
 *
 * States:
 *   pending_image  → waiting for CI to deliver imageRef via API
 *   building       → internal build sandbox running (future)
 *   deploying      → create K8s Deployment + Service, create route, mark active
 *   active         → serving at {slug}.preview.dx.dev
 *   failed         → build or deploy error
 */
export class PreviewReconciler {
  constructor(
    private db: Database,
    private kube: KubeClient,
    private gitHost?: GitHostAdapter
  ) {}

  async reconcilePreview(previewId: string): Promise<void> {
    const prev = await this.loadPreview(previewId)
    if (!prev) throw new Error(`Preview not found: ${previewId}`)

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
        // Terminal/stable states — nothing to reconcile
        break
    }
  }

  // ---------------------------------------------------------------------------
  // State handlers
  // ---------------------------------------------------------------------------

  /**
   * Pending image: ensure GitHub knows we're waiting for a build.
   * Posts/updates PR comment and check run, creates GitHub Deployment.
   */
  private async handlePendingImage(prev: PreviewRow): Promise<void> {
    // Ensure we have a GitHub deployment created
    if (!pspec(prev).githubDeploymentId) {
      await this.ensureGitHubDeployment(prev)
    }

    // Ensure check run exists as "queued"
    await this.createOrUpdateCheck(prev, "queued")

    // Ensure PR comment exists in "waiting" state
    await this.upsertPRComment(prev, this.buildPendingComment(prev))

    // Update deployment status to pending
    await this.updateDeploymentStatus(
      prev,
      "pending",
      "Waiting for CI to build image"
    )
  }

  /**
   * Building: internal build via sandbox (kept for future use).
   * If imageRef is set, a prior build succeeded — transition to deploying.
   */
  private async handleBuilding(prev: PreviewRow): Promise<void> {
    const spec = pspec(prev)
    if (spec.imageRef) {
      await this.updateStatus(prev.id, "deploying")
      return
    }

    // No workspace linked yet — nothing we can do this cycle
    if (!spec.workspaceId) return

    const wks = await this.loadWorkspace(spec.workspaceId)
    if (!wks) return
    const wksSpec = (wks.spec ?? {}) as Record<string, any>
    if (!wksSpec.podName) return

    // Workspace has a direct realmId FK
    if (!wks.realmId) return

    const rt = await this.loadRealm(wks.realmId)
    if (!rt) return
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    if (!rtSpec.kubeconfigRef) return

    const kubeconfig = rtSpec.kubeconfigRef
    const ns = `workspace-${wks.slug}`
    const podName = wksSpec.podName

    await this.createOrUpdateCheck(prev, "in_progress")
    await this.upsertPRComment(prev, this.buildBuildingComment(prev))
    await this.updateDeploymentStatus(prev, "in_progress", "Building image")

    const repo = spec.repo ?? ""
    const slug = spec.slug ?? prev.id
    const imageTag = `${repo.split("/").pop() ?? "app"}:preview-${slug}`
    const registryPrefix = process.env.PREVIEW_REGISTRY ?? "registry.dx.dev"
    const fullImageRef = `${registryPrefix}/${imageTag}`

    try {
      const buildResult = await this.kube.execInPod(
        kubeconfig,
        ns,
        podName,
        "workspace",
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
        "workspace",
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

  /**
   * Deploying: create K8s Deployment + Service from the built image,
   * create/update the gateway route, mark active.
   */
  private async handleDeploying(prev: PreviewRow): Promise<void> {
    const spec = pspec(prev)
    if (!spec.imageRef) {
      await this.failPreview(prev, "No image to deploy")
      return
    }

    // In v2, preview can reference a realm directly via spec.realmId
    // or via spec.systemDeploymentId → systemDeployment.realmId
    const realmId =
      spec.realmId ?? (await this.resolveRealmId(spec.systemDeploymentId))
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

    // Load container port from site preview config, fallback to default
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

    // Update GitHub status to deploying
    await this.createOrUpdateCheck(prev, "in_progress")
    await this.upsertPRComment(prev, this.buildDeployingComment(prev))
    await this.updateDeploymentStatus(
      prev,
      "in_progress",
      `Deploying ${spec.imageRef}`
    )

    try {
      const slug = spec.slug ?? prev.id
      const resources = generatePreviewResources({
        previewSlug: slug,
        previewId: prev.id,
        imageRef: spec.imageRef,
        port,
      })

      for (const resource of resources) {
        await this.kube.apply(kubeconfig, resource)
      }

      // Create or update gateway route
      const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
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
          systemDeploymentId: spec.systemDeploymentId,
          status: "active",
          createdBy: "reconciler",
        })
      }

      // Mark preview as active
      await this.updateStatus(prev.id, "active")
      if (spec.systemDeploymentId) {
        const sdExisting = await this.db
          .select()
          .from(systemDeployment)
          .where(eq(systemDeployment.id, spec.systemDeploymentId))
          .limit(1)
          .then((r) => r[0])
        const sdSpec: SystemDeploymentSpec = {
          ...(sdExisting?.spec ?? ({} as SystemDeploymentSpec)),
          status: "active",
        }
        await this.db
          .update(systemDeployment)
          .set({ spec: sdSpec })
          .where(eq(systemDeployment.id, spec.systemDeploymentId))
      }

      logger.info(
        { previewId: prev.id, domain: previewDomain },
        "Preview deployed and active"
      )

      // Post success to GitHub
      const previewUrl = `https://${previewDomain}`
      await this.onPreviewActive(prev, previewUrl)
    } catch (err) {
      await this.failPreview(prev, `Deploy error: ${String(err).slice(0, 500)}`)
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: PR comments (auto-updating)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a PR comment using a hidden marker to find existing comments.
   * Creates on first call, updates on subsequent calls.
   */
  private async upsertPRComment(prev: PreviewRow, body: string): Promise<void> {
    const spec = pspec(prev)
    if (!this.gitHost || !prev.prNumber || !spec.repo) return

    const slug = spec.slug ?? prev.id
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
    const spec = pspec(prev)
    if (!this.gitHost || !spec.repo) return

    try {
      const slug = spec.slug ?? prev.id
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
    const spec = pspec(prev)
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
    const spec = pspec(prev)
    if (!this.gitHost || !prev.prNumber || !spec.repo) return null

    const commitSha = spec.commitSha ?? ""
    const summaries: Record<string, { title: string; summary: string }> = {
      queued: {
        title: "Preview Queued",
        summary: `Waiting for CI to build and push image for \`${prev.sourceBranch}\``,
      },
      in_progress: {
        title: "Deploying Preview",
        summary: `Deploying preview for \`${prev.sourceBranch}\` (\`${commitSha.slice(0, 7)}\`)${spec.imageRef ? `\n\n**Image:** \`${spec.imageRef}\`` : ""}`,
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
    const spec = pspec(prev)
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
              `**Image:** \`${spec.imageRef}\``,
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

    // Emit workflow event for preview activation
    const spec = pspec(prev)
    await emitEvent(this.db, "preview.ready", {
      branchName: prev.sourceBranch,
      previewUrl,
      previewSlug: spec.slug ?? "",
    }).catch((err) => {
      logger.warn(
        { previewId: prev.id, error: err },
        "Failed to emit preview.ready event"
      )
    })
  }

  private async failPreview(prev: PreviewRow, message: string): Promise<void> {
    await this.updateStatus(prev.id, "failed", message)
    await this.upsertPRComment(prev, this.buildFailedComment(prev, message))
    await this.completeCheck(prev, "failure", undefined, message)
    await this.updateDeploymentStatus(prev, "failure", message)
    logger.error({ previewId: prev.id }, message)
  }

  // ---------------------------------------------------------------------------
  // PR comment templates
  // ---------------------------------------------------------------------------

  private buildPendingComment(prev: PreviewRow): string {
    const spec = pspec(prev)
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
    const commitSha = pspec(prev).commitSha ?? ""
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
    const spec = pspec(prev)
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

  private buildActiveComment(prev: PreviewRow, previewUrl: string): string {
    const spec = pspec(prev)
    const commitSha = spec.commitSha ?? ""
    const slug = spec.slug ?? prev.id
    const expiresAtDate = spec.expiresAt ? new Date(spec.expiresAt) : null
    const expiresAt = expiresAtDate
      ? `in ${Math.ceil((expiresAtDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} days`
      : "never"

    return [
      `### \u2705 Preview Deployment \u2014 Live`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Preview** | \ud83d\udd17 [${previewUrl.replace("https://", "")}](${previewUrl}) |`,
      `| **Status** | \u2705 Active |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${commitSha.slice(0, 7)}\` |`,
      `| **Image** | \`${spec.imageRef}\` |`,
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
    const commitSha = pspec(prev).commitSha ?? ""
    return [
      `### \u274c Preview Deployment \u2014 Failed`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \u274c Deploy failed |`,
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

  private async updateStatus(
    previewId: string,
    phase: string,
    statusMessage?: string
  ): Promise<void> {
    const existing = await this.loadPreview(previewId)
    const existingSpec: PreviewSpecStored =
      (existing?.spec as PreviewSpecStored) ?? ({} as PreviewSpecStored)
    await this.db
      .update(preview)
      .set({
        phase,
        spec: {
          ...existingSpec,
          ...(statusMessage !== undefined ? { statusMessage } : {}),
        },
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

  private async loadWorkspace(workspaceId: string) {
    const [row] = await this.db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
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

  /** Resolve realmId from a systemDeployment's realmId FK. */
  private async resolveRealmId(
    systemDeploymentId?: string
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
