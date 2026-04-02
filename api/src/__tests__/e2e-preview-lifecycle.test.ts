/**
 * E2E test: Preview deployment lifecycle
 *
 * Uses real PGlite + real k3d cluster + spy GitHostAdapter.
 * Tests the full flow: sandbox provisioning → preview deploy → PR comment.
 *
 * Prerequisites:
 *   - k3d cluster "dx-test" running
 *   - kubectl accessible
 *   - kubeconfig at /tmp/k3d-direct.yaml
 *
 * Run: cd api && ./node_modules/.bin/vitest run src/__tests__/e2e-preview-lifecycle.test.ts --timeout 120000
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import type { Database } from "../db/connection";
import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostCollaborator,
  GitHostCommitStatus,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  GitHostRepoInfo,
  WebhookVerification,
} from "../adapters/git-host-adapter";
import { createPgliteDb, migrateWithPglite } from "../factory-core";
import { KubeClientImpl } from "../lib/kube-client-impl";
import { Reconciler } from "../reconciler/reconciler";
import { PreviewReconciler } from "../reconciler/preview-reconciler";
import { createSandbox } from "../services/sandbox/sandbox.service";
import { provider, cluster } from "../db/schema/infra";
import {
  sandbox,
  preview,
  deploymentTarget,
} from "../db/schema/fleet";
import { lookupRouteByDomain } from "../modules/infra/gateway.service";

// ---------------------------------------------------------------------------
// Spy GitHostAdapter — records all calls
// ---------------------------------------------------------------------------

interface SpyCall {
  method: string;
  args: unknown[];
}

class SpyGitHostAdapter implements GitHostAdapter {
  readonly hostType = "spy";
  calls: SpyCall[] = [];
  comments: Array<{ repo: string; prNumber: number; body: string }> = [];
  checkRuns: Array<{ repo: string; check: Partial<GitHostCheckRun> }> = [];

  async getAccessToken() { return "spy-token"; }
  async listRepos() { return []; }
  async getRepo() { return null; }
  async listOrgMembers() { return []; }
  async listCollaborators() { return []; }
  async verifyWebhook(_h: Record<string, string>, body: string): Promise<WebhookVerification> {
    return { valid: true, eventType: "push", deliveryId: "spy", payload: JSON.parse(body) };
  }
  async createWebhook() { return { webhookId: "spy-wh" }; }
  async deleteWebhook() {}
  async postCommitStatus() {}

  async createCheckRun(repoFullName: string, check: GitHostCheckRun) {
    const id = `check-${this.checkRuns.length + 1}`;
    this.checkRuns.push({ repo: repoFullName, check });
    this.calls.push({ method: "createCheckRun", args: [repoFullName, check] });
    return { checkRunId: id };
  }

  async updateCheckRun(repoFullName: string, checkRunId: string, update: Partial<GitHostCheckRun>) {
    this.checkRuns.push({ repo: repoFullName, check: { ...update, name: checkRunId } });
    this.calls.push({ method: "updateCheckRun", args: [repoFullName, checkRunId, update] });
  }

  async listPullRequests() { return []; }
  async getPullRequest() { return null; }
  async createPullRequest(_r: string, _pr: GitHostPullRequestCreate): Promise<GitHostPullRequest> {
    return {
      number: 0, title: "", body: "", state: "open", head: "", base: "",
      url: "", draft: false, createdAt: "", updatedAt: "", author: { login: "spy" },
    };
  }
  async mergePullRequest() {}
  async getPullRequestChecks() { return []; }

  async postPRComment(repoFullName: string, prNumber: number, body: string) {
    this.comments.push({ repo: repoFullName, prNumber, body });
    this.calls.push({ method: "postPRComment", args: [repoFullName, prNumber, body] });
    return { commentId: `comment-${this.comments.length}` };
  }

  async listPRComments() { return []; }
  async updatePRComment() {}
  async createDeployment() { return { deploymentId: 0 }; }
  async createDeploymentStatus() {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KUBECONFIG_PATH = "/tmp/k3d-direct.yaml";
const TEST_TIMEOUT = 120_000;

function kubectlDirect(args: string[], opts?: { timeout?: number }): string {
  return execFileSync("kubectl", ["--kubeconfig", KUBECONFIG_PATH, ...args], {
    encoding: "utf-8",
    timeout: opts?.timeout ?? 30_000,
  });
}

async function waitForPod(
  namespace: string,
  podName: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const output = kubectlDirect([
        "get", "pod", podName, "-n", namespace, "-o", "jsonpath={.status.phase}",
      ]);
      if (output.trim() === "Running") return;
    } catch {
      // Pod may not exist yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // One more try, let it throw with the actual error
  const status = kubectlDirect([
    "get", "pod", podName, "-n", namespace, "-o", "jsonpath={.status.phase}",
  ]);
  throw new Error(`Pod ${namespace}/${podName} not Running after ${timeoutMs}ms (status: ${status})`);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("E2E: Preview deployment lifecycle", () => {
  let db: Database;
  let client: { close: () => Promise<void> };
  let kube: KubeClientImpl;
  let gitHost: SpyGitHostAdapter;
  let reconciler: Reconciler;
  let previewReconciler: PreviewReconciler;
  let kubeconfig: string;

  let clusterId: string;
  let sandboxSlug: string;
  let sandboxId: string;
  let previewId: string;
  let previewSlug: string;

  beforeAll(async () => {
    // Check prerequisites
    if (!existsSync(KUBECONFIG_PATH)) {
      throw new Error(
        `Kubeconfig not found at ${KUBECONFIG_PATH}. ` +
        "Create a k3d cluster first: k3d cluster create dx-test"
      );
    }
    kubeconfig = KUBECONFIG_PATH;

    // Verify cluster is reachable
    try {
      kubectlDirect(["get", "nodes"]);
    } catch (err) {
      throw new Error(`k3d cluster not reachable: ${err}`);
    }

    // Set up PGlite database
    const pglite = await createPgliteDb();
    client = pglite.client as unknown as { close: () => Promise<void> };
    db = pglite.db as unknown as Database;
    await migrateWithPglite(
      pglite.client,
      path.join(process.cwd(), "drizzle"),
    );

    // Create real kube client and spy git host
    kube = new KubeClientImpl();
    gitHost = new SpyGitHostAdapter();
    reconciler = new Reconciler(db, kube, gitHost);
    previewReconciler = new PreviewReconciler(db, kube, gitHost);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Clean up K8s resources
    try {
      if (sandboxSlug) {
        kubectlDirect(["delete", "namespace", `sandbox-${sandboxSlug}`, "--ignore-not-found", "--wait=false"]);
      }
      if (previewSlug) {
        kubectlDirect(["delete", "namespace", `preview-${previewSlug}`, "--ignore-not-found", "--wait=false"]);
      }
    } catch {
      // Best effort cleanup
    }
    await client?.close();
  });

  it("should seed infrastructure (provider + cluster)", async () => {
    // Create provider
    const [prv] = await db.insert(provider).values({
      name: "e2e-local",
      slug: "e2e-local",
      providerType: "bare_metal",
      providerKind: "internal",
      status: "active",
    }).returning();

    // Create cluster pointing to real k3d
    const [cls] = await db.insert(cluster).values({
      name: "e2e-k3d",
      slug: "e2e-k3d",
      providerId: prv!.providerId,
      status: "ready",
      kubeconfigRef: kubeconfig,
      endpoint: "localhost",
    }).returning();

    clusterId = cls!.clusterId;
    expect(clusterId).toBeTruthy();
  });

  it("should create a sandbox and reconcile it into a real K8s pod", async () => {
    // Create sandbox via service — uses a lightweight image for fast startup
    const sbx = await createSandbox(db, {
      name: "e2e-preview-test",
      ownerId: "e2e-test-user",
      ownerType: "user",
      runtimeType: "container",
      devcontainerImage: "alpine:3.19",
      devcontainerConfig: {},
      repos: [],
      cpu: "500m",
      memory: "256Mi",
      storageGb: 1,
      dockerCacheGb: 1,
      clusterId,
    });

    sandboxId = sbx.sandboxId;
    sandboxSlug = sbx.slug;
    expect(sandboxId).toBeTruthy();
    expect(sandboxSlug).toBeTruthy();

    // Reconcile sandbox → should create K8s namespace, PVC, pod, service
    await reconciler.reconcileSandbox(sandboxId);

    // Verify namespace exists
    const nsOutput = kubectlDirect(["get", "namespace", `sandbox-${sandboxSlug}`, "-o", "name"]);
    expect(nsOutput.trim()).toBe(`namespace/sandbox-${sandboxSlug}`);

    // Wait for pod to be scheduled (may not go Running since alpine exits, but it'll be created)
    // We just need the pod to exist for the reconciler to read its IP
    await new Promise((r) => setTimeout(r, 5000));

    // Re-reconcile to pick up pod IP and node ports
    await reconciler.reconcileSandbox(sandboxId);

    // Verify sandbox record was updated
    const [updatedSbx] = await db
      .select()
      .from(sandbox)
      .where(eq(sandbox.sandboxId, sandboxId));
    expect(updatedSbx).toBeTruthy();
    expect(updatedSbx!.podName).toBe(`sandbox-${sandboxSlug}`);
  }, TEST_TIMEOUT);

  it("should create a preview in deploying state and reconcile to active", async () => {
    // Create deployment target for the preview
    const [dt] = await db.insert(deploymentTarget).values({
      name: "e2e-preview-dt",
      slug: "e2e-preview-dt",
      kind: "preview",
      runtime: "kubernetes",
      createdBy: "e2e-test-user",
      trigger: "pr",
      status: "provisioning",
      clusterId,
    }).returning();

    // Create preview in "deploying" state with a pre-set imageRef
    // This simulates the build step having already completed
    previewSlug = "pr-42--feat-auth--default";
    const [prev] = await db.insert(preview).values({
      deploymentTargetId: dt!.deploymentTargetId,
      name: "PR #42 Preview",
      slug: previewSlug,
      sourceBranch: "feat/auth",
      commitSha: "abc1234567890def",
      repo: "acme-corp/my-app",
      prNumber: 42,
      ownerId: "e2e-test-user",
      status: "deploying",
      sandboxId,
      imageRef: "nginx:alpine",
    }).returning();

    previewId = prev!.previewId;
    expect(previewId).toBeTruthy();

    // Reconcile preview → should create K8s Deployment + Service, create route, post PR comment
    await previewReconciler.reconcilePreview(previewId);

    // Verify preview is now active
    const [updatedPrev] = await db
      .select()
      .from(preview)
      .where(eq(preview.previewId, previewId));
    expect(updatedPrev!.status).toBe("active");

    // Verify K8s deployment was created
    const deployOutput = kubectlDirect([
      "get", "deployment", `preview-${previewSlug}`,
      "-n", `preview-${previewSlug}`,
      "-o", "jsonpath={.spec.template.spec.containers[0].image}",
    ]);
    expect(deployOutput.trim()).toBe("nginx:alpine");

    // Verify K8s service was created
    const svcOutput = kubectlDirect([
      "get", "service", `preview-${previewSlug}`,
      "-n", `preview-${previewSlug}`,
      "-o", "name",
    ]);
    expect(svcOutput.trim()).toBe(`service/preview-${previewSlug}`);

    // Verify gateway route was created
    const route = await lookupRouteByDomain(db, `${previewSlug}.preview.dx.dev`);
    expect(route).toBeTruthy();
    expect(route!.status).toBe("active");
    expect(route!.targetPort).toBe(8080);
  }, TEST_TIMEOUT);

  it("should have posted a PR comment with the preview URL", () => {
    expect(gitHost.comments).toHaveLength(1);

    const comment = gitHost.comments[0]!;
    expect(comment.repo).toBe("acme-corp/my-app");
    expect(comment.prNumber).toBe(42);
    expect(comment.body).toContain("Preview Deployment Ready");
    expect(comment.body).toContain(`https://${previewSlug}.preview.dx.dev`);
    expect(comment.body).toContain("feat/auth");
    expect(comment.body).toContain("abc1234");
  });

  it("should have created/updated GitHub check runs", () => {
    // Should have at least one check run for the success case
    const successCheck = gitHost.checkRuns.find(
      (c) => c.check.status === "completed" && c.check.conclusion === "success"
    );
    expect(successCheck).toBeTruthy();
    expect(successCheck!.repo).toBe("acme-corp/my-app");
    expect(successCheck!.check.detailsUrl).toContain(previewSlug);
  });
});
