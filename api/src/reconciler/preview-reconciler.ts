import { eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { KubeClient } from "../lib/kube-client";
import type { GitHostAdapter } from "../adapters/git-host-adapter";
import { preview, deploymentTarget, sandbox } from "../db/schema/fleet";
import { cluster } from "../db/schema/infra";
import { createRoute, lookupRouteByDomain, updateRoute } from "../modules/infra/gateway.service";
import { generatePreviewResources } from "./preview-resource-generator";
import { logger } from "../logger";

const DEFAULT_PREVIEW_PORT = 8080;
const CHECK_NAME = "dx/preview";
const COMMENT_MARKER = (slug: string) => `<!-- dx-preview:${slug} -->`;

type PreviewRow = typeof preview.$inferSelect;

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
    private gitHost?: GitHostAdapter,
  ) {}

  async reconcilePreview(previewId: string): Promise<void> {
    const prev = await this.loadPreview(previewId);
    if (!prev) throw new Error(`Preview not found: ${previewId}`);

    switch (prev.status) {
      case "pending_image":
        await this.handlePendingImage(prev);
        break;
      case "building":
        await this.handleBuilding(prev);
        break;
      case "deploying":
        await this.handleDeploying(prev);
        break;
      case "active":
      case "inactive":
      case "expired":
      case "failed":
        // Terminal/stable states — nothing to reconcile
        break;
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
    if (!prev.githubDeploymentId) {
      await this.ensureGitHubDeployment(prev);
    }

    // Ensure check run exists as "queued"
    await this.createOrUpdateCheck(prev, "queued");

    // Ensure PR comment exists in "waiting" state
    await this.upsertPRComment(prev, this.buildPendingComment(prev));

    // Update deployment status to pending
    await this.updateDeploymentStatus(prev, "pending", "Waiting for CI to build image");
  }

  /**
   * Building: internal build via sandbox (kept for future use).
   * If imageRef is set, a prior build succeeded — transition to deploying.
   */
  private async handleBuilding(prev: PreviewRow): Promise<void> {
    if (prev.imageRef) {
      await this.updateStatus(prev.previewId, "deploying");
      return;
    }

    // No sandbox linked yet — nothing we can do this cycle
    if (!prev.sandboxId) return;

    const sbx = await this.loadSandbox(prev.sandboxId);
    if (!sbx || !sbx.podName) return;

    const dt = await this.loadDeploymentTarget(sbx.deploymentTargetId);
    if (!dt || !dt.clusterId) return;

    const cl = await this.loadCluster(dt.clusterId);
    if (!cl?.kubeconfigRef) return;

    const kubeconfig = cl.kubeconfigRef;
    const ns = `sandbox-${sbx.slug}`;
    const podName = sbx.podName;

    await this.createOrUpdateCheck(prev, "in_progress");
    await this.upsertPRComment(prev, this.buildBuildingComment(prev));
    await this.updateDeploymentStatus(prev, "in_progress", "Building image");

    const imageTag = `${prev.repo.split("/").pop() ?? "app"}:preview-${prev.slug}`;
    const registryPrefix = process.env.PREVIEW_REGISTRY ?? "registry.dx.dev";
    const fullImageRef = `${registryPrefix}/${imageTag}`;

    try {
      const buildResult = await this.kube.execInPod(
        kubeconfig, ns, podName, "workspace",
        ["docker", "build", "-t", fullImageRef, "/workspaces"],
        { timeoutMs: 600_000 },
      );

      if (buildResult.exitCode !== 0) {
        await this.failPreview(prev, `Build failed: ${buildResult.stderr.slice(0, 500)}`);
        return;
      }

      const pushResult = await this.kube.execInPod(
        kubeconfig, ns, podName, "workspace",
        ["docker", "push", fullImageRef],
        { timeoutMs: 300_000 },
      );

      if (pushResult.exitCode !== 0) {
        await this.failPreview(prev, `Push failed: ${pushResult.stderr.slice(0, 500)}`);
        return;
      }

      await this.db
        .update(preview)
        .set({ imageRef: fullImageRef, status: "deploying", updatedAt: new Date() })
        .where(eq(preview.previewId, prev.previewId));

      logger.info({ previewId: prev.previewId, imageRef: fullImageRef }, "Preview build complete, deploying");
    } catch (err) {
      await this.failPreview(prev, `Build error: ${String(err).slice(0, 500)}`);
    }
  }

  /**
   * Deploying: create K8s Deployment + Service from the built image,
   * create/update the gateway route, mark active.
   */
  private async handleDeploying(prev: PreviewRow): Promise<void> {
    if (!prev.imageRef) {
      await this.failPreview(prev, "No image to deploy");
      return;
    }

    const dt = await this.loadDeploymentTarget(prev.deploymentTargetId);
    if (!dt || !dt.clusterId) {
      await this.failPreview(prev, "No cluster for deployment");
      return;
    }

    const cl = await this.loadCluster(dt.clusterId);
    if (!cl?.kubeconfigRef) {
      await this.failPreview(prev, "No kubeconfig for cluster");
      return;
    }

    const kubeconfig = cl.kubeconfigRef;
    const port = DEFAULT_PREVIEW_PORT;

    // Update GitHub status to deploying
    await this.createOrUpdateCheck(prev, "in_progress");
    await this.upsertPRComment(prev, this.buildDeployingComment(prev));
    await this.updateDeploymentStatus(prev, "in_progress", `Deploying ${prev.imageRef}`);

    try {
      const resources = generatePreviewResources({
        previewSlug: prev.slug,
        previewId: prev.previewId,
        imageRef: prev.imageRef,
        port,
      });

      for (const resource of resources) {
        await this.kube.apply(kubeconfig, resource);
      }

      // Create or update gateway route
      const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev";
      const previewDomain = `${prev.slug}.preview.${gatewayDomain}`;
      const existingRoute = await lookupRouteByDomain(this.db, previewDomain);
      const previewServiceHost = `preview-${prev.slug}.preview-${prev.slug}.svc.cluster.local`;

      if (existingRoute) {
        await updateRoute(this.db, existingRoute.routeId, {
          targetService: previewServiceHost,
          targetPort: port,
          status: "active",
        });
      } else {
        await createRoute(this.db, {
          kind: "preview",
          domain: previewDomain,
          targetService: previewServiceHost,
          targetPort: port,
          deploymentTargetId: dt.deploymentTargetId,
          status: "active",
          createdBy: "reconciler",
        });
      }

      // Mark preview as active
      await this.updateStatus(prev.previewId, "active");
      await this.db
        .update(deploymentTarget)
        .set({ status: "active" })
        .where(eq(deploymentTarget.deploymentTargetId, dt.deploymentTargetId));

      logger.info({ previewId: prev.previewId, domain: previewDomain }, "Preview deployed and active");

      // Post success to GitHub
      const previewUrl = `https://${previewDomain}`;
      await this.onPreviewActive(prev, previewUrl);
    } catch (err) {
      await this.failPreview(prev, `Deploy error: ${String(err).slice(0, 500)}`);
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
    if (!this.gitHost || !prev.prNumber || !prev.repo) return;

    const marker = COMMENT_MARKER(prev.slug);
    const fullBody = `${marker}\n${body}`;

    try {
      if (prev.githubCommentId) {
        // Update existing comment
        await this.gitHost.updatePRComment(prev.repo, prev.githubCommentId, fullBody);
      } else {
        // Search for existing comment with our marker
        const comments = await this.gitHost.listPRComments(prev.repo, prev.prNumber);
        const existing = comments.find((c) => c.body.includes(marker));

        if (existing) {
          await this.gitHost.updatePRComment(prev.repo, existing.commentId, fullBody);
          await this.db
            .update(preview)
            .set({ githubCommentId: existing.commentId })
            .where(eq(preview.previewId, prev.previewId));
        } else {
          const { commentId } = await this.gitHost.postPRComment(prev.repo, prev.prNumber, fullBody);
          await this.db
            .update(preview)
            .set({ githubCommentId: Number(commentId) })
            .where(eq(preview.previewId, prev.previewId));
        }
      }
    } catch (err) {
      logger.warn({ previewId: prev.previewId, error: err }, "Failed to upsert PR comment");
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: Deployments API
  // ---------------------------------------------------------------------------

  private async ensureGitHubDeployment(prev: PreviewRow): Promise<void> {
    if (!this.gitHost || !prev.repo) return;

    try {
      const { deploymentId } = await this.gitHost.createDeployment(prev.repo, {
        ref: prev.commitSha,
        environment: `preview/${prev.slug}`,
        description: `Preview for ${prev.sourceBranch}`,
        autoMerge: false,
        requiredContexts: [],
      });

      await this.db
        .update(preview)
        .set({ githubDeploymentId: deploymentId })
        .where(eq(preview.previewId, prev.previewId));
    } catch (err) {
      logger.warn({ previewId: prev.previewId, error: err }, "Failed to create GitHub deployment");
    }
  }

  private async updateDeploymentStatus(
    prev: PreviewRow,
    state: "pending" | "in_progress" | "success" | "failure" | "error" | "inactive",
    description: string,
    environmentUrl?: string,
  ): Promise<void> {
    if (!this.gitHost || !prev.repo || !prev.githubDeploymentId) return;

    try {
      await this.gitHost.createDeploymentStatus(prev.repo, prev.githubDeploymentId, {
        state,
        description,
        environmentUrl,
      });
    } catch (err) {
      logger.warn({ previewId: prev.previewId, error: err }, "Failed to update deployment status");
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub integration: Check runs
  // ---------------------------------------------------------------------------

  private async createOrUpdateCheck(
    prev: PreviewRow,
    status: "queued" | "in_progress",
  ): Promise<string | null> {
    if (!this.gitHost || !prev.prNumber || !prev.repo) return null;

    const summaries: Record<string, { title: string; summary: string }> = {
      queued: {
        title: "Preview Queued",
        summary: `Waiting for CI to build and push image for \`${prev.sourceBranch}\``,
      },
      in_progress: {
        title: "Deploying Preview",
        summary: `Deploying preview for \`${prev.sourceBranch}\` (\`${prev.commitSha.slice(0, 7)}\`)${prev.imageRef ? `\n\n**Image:** \`${prev.imageRef}\`` : ""}`,
      },
    };

    try {
      const { checkRunId } = await this.gitHost.createCheckRun(prev.repo, {
        name: CHECK_NAME,
        headSha: prev.commitSha,
        status,
        output: summaries[status],
      });
      return checkRunId;
    } catch (err) {
      logger.warn({ previewId: prev.previewId, error: err }, "Failed to create check run");
      return null;
    }
  }

  private async completeCheck(
    prev: PreviewRow,
    conclusion: "success" | "failure",
    previewUrl?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.gitHost || !prev.repo) return;

    const expiresAt = prev.expiresAt
      ? prev.expiresAt.toISOString().split("T")[0]
      : "N/A";

    const output = conclusion === "success"
      ? {
          title: "Preview Active",
          summary: [
            `Preview deployed successfully.`,
            "",
            `**URL:** ${previewUrl}`,
            `**Image:** \`${prev.imageRef}\``,
            `**Commit:** \`${prev.commitSha.slice(0, 7)}\``,
            `**Expires:** ${expiresAt}`,
          ].join("\n"),
        }
      : {
          title: "Preview Failed",
          summary: errorMessage ?? "Preview deployment failed",
        };

    try {
      await this.gitHost.createCheckRun(prev.repo, {
        name: CHECK_NAME,
        headSha: prev.commitSha,
        status: "completed",
        conclusion,
        detailsUrl: previewUrl,
        output,
      });
    } catch (err) {
      logger.warn({ previewId: prev.previewId, error: err }, "Failed to complete check run");
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  private async onPreviewActive(prev: PreviewRow, previewUrl: string): Promise<void> {
    await this.upsertPRComment(prev, this.buildActiveComment(prev, previewUrl));
    await this.completeCheck(prev, "success", previewUrl);
    await this.updateDeploymentStatus(prev, "success", "Preview is live", previewUrl);
  }

  private async failPreview(prev: PreviewRow, message: string): Promise<void> {
    await this.updateStatus(prev.previewId, "failed", message);
    await this.upsertPRComment(prev, this.buildFailedComment(prev, message));
    await this.completeCheck(prev, "failure", undefined, message);
    await this.updateDeploymentStatus(prev, "failure", message);
    logger.error({ previewId: prev.previewId }, message);
  }

  // ---------------------------------------------------------------------------
  // PR comment templates
  // ---------------------------------------------------------------------------

  private buildPendingComment(prev: PreviewRow): string {
    return [
      `### \u23f3 Preview Deployment \u2014 Waiting for Build`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\udd04 Waiting for CI to build image |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${prev.commitSha.slice(0, 7)}\` |`,
      `| **Triggered** | ${this.timeAgo(prev.createdAt)} |`,
      "",
      `> \u26a1 Push an image via CI or \`dx preview deploy --image <ref>\``,
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n");
  }

  private buildBuildingComment(prev: PreviewRow): string {
    return [
      `### \ud83d\udd28 Preview Deployment \u2014 Building`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\udea7 Building image |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${prev.commitSha.slice(0, 7)}\` |`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n");
  }

  private buildDeployingComment(prev: PreviewRow): string {
    return [
      `### \ud83d\udd28 Preview Deployment \u2014 Deploying`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \ud83d\ude80 Deploying \`${prev.imageRef}\` |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${prev.commitSha.slice(0, 7)}\` |`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n");
  }

  private buildActiveComment(prev: PreviewRow, previewUrl: string): string {
    const expiresAt = prev.expiresAt
      ? `in ${Math.ceil((prev.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} days`
      : "never";

    return [
      `### \u2705 Preview Deployment \u2014 Live`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Preview** | \ud83d\udd17 [${previewUrl.replace("https://", "")}](${previewUrl}) |`,
      `| **Status** | \u2705 Active |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${prev.commitSha.slice(0, 7)}\` |`,
      `| **Image** | \`${prev.imageRef}\` |`,
      `| **Expires** | ${expiresAt} |`,
      "",
      `<details>`,
      `<summary>\ud83d\udee0 Quick Actions</summary>`,
      "",
      "```bash",
      `# Open in browser`,
      `dx preview open ${prev.slug}`,
      "",
      `# View status`,
      `dx preview show ${prev.slug}`,
      "",
      `# Extend TTL`,
      `dx preview extend ${prev.slug} --days 14`,
      "",
      `# Destroy`,
      `dx preview destroy ${prev.slug}`,
      "```",
      `</details>`,
      "",
      `> Powered by [dx.dev](https://dx.dev)`,
    ].join("\n");
  }

  private buildFailedComment(prev: PreviewRow, errorMessage: string): string {
    return [
      `### \u274c Preview Deployment \u2014 Failed`,
      "",
      `| | |`,
      `|---|---|`,
      `| **Status** | \u274c Deploy failed |`,
      `| **Branch** | \`${prev.sourceBranch}\` |`,
      `| **Commit** | \`${prev.commitSha.slice(0, 7)}\` |`,
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
    ].join("\n");
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  private async updateStatus(previewId: string, status: string, statusMessage?: string): Promise<void> {
    await this.db
      .update(preview)
      .set({ status, statusMessage: statusMessage ?? null, updatedAt: new Date() })
      .where(eq(preview.previewId, previewId));
  }

  private async loadPreview(previewId: string) {
    const [row] = await this.db
      .select()
      .from(preview)
      .where(eq(preview.previewId, previewId))
      .limit(1);
    return row ?? null;
  }

  private async loadSandbox(sandboxId: string) {
    const [row] = await this.db
      .select()
      .from(sandbox)
      .where(eq(sandbox.sandboxId, sandboxId))
      .limit(1);
    return row ?? null;
  }

  private async loadDeploymentTarget(dtId: string) {
    const [row] = await this.db
      .select()
      .from(deploymentTarget)
      .where(eq(deploymentTarget.deploymentTargetId, dtId))
      .limit(1);
    return row ?? null;
  }

  private async loadCluster(clusterId: string) {
    const [row] = await this.db
      .select()
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId))
      .limit(1);
    return row ?? null;
  }
}
