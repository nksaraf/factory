/**
 * E2E test: Preview deployment lifecycle
 *
 * Uses real PGlite + real k3d cluster + spy GitHostAdapter.
 * Tests the full flow: workspace provisioning → preview deploy → PR comment.
 *
 * Prerequisites:
 *   - k3d cluster "dx-test" running
 *   - kubectl accessible
 *   - kubeconfig at /tmp/k3d-direct.yaml
 *
 * Run: cd api && ./node_modules/.bin/vitest run src/__tests__/e2e-preview-lifecycle.test.ts --timeout 120000
 */
import type { EstateSpec, RealmSpec } from "@smp/factory-shared/schemas/infra"
import type {
  PreviewSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkspaceSpec,
} from "@smp/factory-shared/schemas/ops"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostCollaborator,
  GitHostCommitStatus,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  GitHostRepoInfo,
  WebhookVerification,
} from "../adapters/git-host-adapter"
import type { Database } from "../db/connection"
import { estate, realm } from "../db/schema/infra-v2"
import { preview, site, systemDeployment, workspace } from "../db/schema/ops"
import { system } from "../db/schema/software-v2"
import { createPgliteDb, migrateWithPglite } from "../factory-core"
import { KubeClientImpl } from "../lib/kube-client-impl"
import { lookupRouteByDomain } from "../modules/infra/gateway.service"
import { PreviewReconciler } from "../reconciler/preview-reconciler"
import { Reconciler } from "../reconciler/reconciler"

// ---------------------------------------------------------------------------
// Spy GitHostAdapter — records all calls
// ---------------------------------------------------------------------------

interface SpyCall {
  method: string
  args: unknown[]
}

class SpyGitHostAdapter implements GitHostAdapter {
  readonly type = "spy"
  calls: SpyCall[] = []
  comments: Array<{ repo: string; prNumber: number; body: string }> = []
  checkRuns: Array<{ repo: string; check: Partial<GitHostCheckRun> }> = []

  async getAccessToken() {
    return "spy-token"
  }
  async listRepos() {
    return []
  }
  async getRepo() {
    return null
  }
  async listOrgMembers() {
    return []
  }
  async listCollaborators() {
    return []
  }
  async verifyWebhook(
    _h: Record<string, string>,
    body: string
  ): Promise<WebhookVerification> {
    return {
      valid: true,
      eventType: "push",
      deliveryId: "spy",
      payload: JSON.parse(body),
    }
  }
  async createWebhook() {
    return { webhookId: "spy-wh" }
  }
  async deleteWebhook() {}
  async postCommitStatus() {}

  async createCheckRun(repoFullName: string, check: GitHostCheckRun) {
    const id = `check-${this.checkRuns.length + 1}`
    this.checkRuns.push({ repo: repoFullName, check })
    this.calls.push({ method: "createCheckRun", args: [repoFullName, check] })
    return { checkRunId: id }
  }

  async updateCheckRun(
    repoFullName: string,
    checkRunId: string,
    update: Partial<GitHostCheckRun>
  ) {
    this.checkRuns.push({
      repo: repoFullName,
      check: { ...update, name: checkRunId },
    })
    this.calls.push({
      method: "updateCheckRun",
      args: [repoFullName, checkRunId, update],
    })
  }

  async listPullRequests() {
    return []
  }
  async getPullRequest() {
    return null
  }
  async createPullRequest(
    _r: string,
    _pr: GitHostPullRequestCreate
  ): Promise<GitHostPullRequest> {
    return {
      number: 0,
      title: "",
      body: "",
      state: "open",
      head: "",
      base: "",
      url: "",
      draft: false,
      createdAt: "",
      updatedAt: "",
      author: { login: "spy" },
    }
  }
  async mergePullRequest() {}
  async getPullRequestChecks() {
    return []
  }

  async postPRComment(repoFullName: string, prNumber: number, body: string) {
    this.comments.push({ repo: repoFullName, prNumber, body })
    this.calls.push({
      method: "postPRComment",
      args: [repoFullName, prNumber, body],
    })
    return { commentId: `comment-${this.comments.length}` }
  }

  async listPRComments() {
    return []
  }
  async updatePRComment() {}
  async createDeployment() {
    return { deploymentId: 0 }
  }
  async createDeploymentStatus() {}
  async createBranch(_r: string, branchName: string) {
    return { ref: `refs/heads/${branchName}`, sha: "0".repeat(40) }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KUBECONFIG_PATH = "/tmp/k3d-direct.yaml"
const TEST_TIMEOUT = 120_000

function kubectlDirect(args: string[], opts?: { timeout?: number }): string {
  return execFileSync("kubectl", ["--kubeconfig", KUBECONFIG_PATH, ...args], {
    encoding: "utf-8",
    timeout: opts?.timeout ?? 30_000,
  })
}

async function waitForPod(
  namespace: string,
  podName: string,
  timeoutMs = 60_000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const output = kubectlDirect([
        "get",
        "pod",
        podName,
        "-n",
        namespace,
        "-o",
        "jsonpath={.status.phase}",
      ])
      if (output.trim() === "Running") return
    } catch {
      // Pod may not exist yet
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  const status = kubectlDirect([
    "get",
    "pod",
    podName,
    "-n",
    namespace,
    "-o",
    "jsonpath={.status.phase}",
  ])
  throw new Error(
    `Pod ${namespace}/${podName} not Running after ${timeoutMs}ms (status: ${status})`
  )
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(KUBECONFIG_PATH))(
  "E2E: Preview deployment lifecycle",
  () => {
    let db: Database
    let client: { close: () => Promise<void> }
    let kube: KubeClientImpl
    let gitHost: SpyGitHostAdapter
    let reconciler: Reconciler
    let previewReconciler: PreviewReconciler
    let kubeconfig: string

    let realmId: string
    let workspaceSlug: string
    let workspaceId: string
    let previewId: string
    let previewSlug: string

    beforeAll(async () => {
      if (!existsSync(KUBECONFIG_PATH)) {
        throw new Error(
          `Kubeconfig not found at ${KUBECONFIG_PATH}. ` +
            "Create a k3d cluster first: k3d cluster create dx-test"
        )
      }
      kubeconfig = KUBECONFIG_PATH

      try {
        kubectlDirect(["get", "nodes"])
      } catch (err) {
        throw new Error(`k3d cluster not reachable: ${err}`)
      }

      const pglite = await createPgliteDb()
      client = pglite.client as unknown as { close: () => Promise<void> }
      db = pglite.db as unknown as Database
      await migrateWithPglite(
        pglite.client,
        path.join(process.cwd(), "drizzle")
      )

      kube = new KubeClientImpl()
      gitHost = new SpyGitHostAdapter()
      reconciler = new Reconciler(db, kube, gitHost)
      previewReconciler = new PreviewReconciler(db, kube, gitHost)
    }, TEST_TIMEOUT)

    afterAll(async () => {
      try {
        if (workspaceSlug) {
          kubectlDirect([
            "delete",
            "namespace",
            `workspace-${workspaceSlug}`,
            "--ignore-not-found",
            "--wait=false",
          ])
        }
        if (previewSlug) {
          kubectlDirect([
            "delete",
            "namespace",
            `preview-${previewSlug}`,
            "--ignore-not-found",
            "--wait=false",
          ])
        }
      } catch {
        // Best effort cleanup
      }
      await client?.close()
    })

    it("should seed infrastructure (estate + realm)", async () => {
      // Create estate
      const [sub] = await db
        .insert(estate)
        .values({
          name: "e2e-local",
          slug: "e2e-local",
          type: "datacenter",
          spec: {} satisfies EstateSpec,
        })
        .returning()

      // Create realm pointing to real k3d
      const [rt] = await db
        .insert(realm)
        .values({
          name: "e2e-k3d",
          slug: "e2e-k3d",
          type: "k8s-cluster",
          spec: {
            kubeconfigRef: kubeconfig,
            status: "ready",
            endpoint: "localhost",
          } satisfies RealmSpec,
        })
        .returning()

      realmId = rt.id
      expect(realmId).toBeTruthy()
    })

    it(
      "should create a workspace and reconcile it into a real K8s pod",
      async () => {
        // Create workspace via direct insert with v2 shape
        const [wksp] = await db
          .insert(workspace)
          .values({
            name: "e2e-preview-test",
            slug: "e2e-preview-test",
            type: "developer",
            realmId,
            spec: {
              ownerType: "user",
              realmType: "container",
              devcontainerConfig: {},
              repos: [],
              cpu: "500m",
              memory: "256Mi",
              storageGb: 1,
              dockerCacheGb: 1,
              lifecycle: "provisioning",
              authMode: "private",
              healthStatus: "unknown",
              setupProgress: {},
            } satisfies WorkspaceSpec,
          })
          .returning()

        workspaceId = wksp.id
        workspaceSlug = wksp.slug
        expect(workspaceId).toBeTruthy()
        expect(workspaceSlug).toBeTruthy()

        // Reconcile workspace → should create K8s namespace, PVC, pod, service
        await reconciler.reconcileWorkspace(workspaceId)

        // Verify namespace exists
        const nsOutput = kubectlDirect([
          "get",
          "namespace",
          `workspace-${workspaceSlug}`,
          "-o",
          "name",
        ])
        expect(nsOutput.trim()).toBe(`namespace/workspace-${workspaceSlug}`)

        await new Promise((r) => setTimeout(r, 5000))

        // Re-reconcile to pick up pod IP and node ports
        await reconciler.reconcileWorkspace(workspaceId)

        // Verify workspace record was updated
        const [updatedWksp] = await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
        expect(updatedWksp).toBeTruthy()
        expect(updatedWksp!.spec.podName).toBe(`workspace-${workspaceSlug}`)
      },
      TEST_TIMEOUT
    )

    it(
      "should create a preview in deploying state and reconcile to active",
      async () => {
        // Create prereqs: system + site for the system deployment
        const [sys] = await db
          .insert(system)
          .values({
            name: "e2e-app",
            slug: "e2e-app",
            spec: {
              namespace: "default",
              lifecycle: "experimental",
              tags: [],
            } satisfies SystemSpec,
          })
          .returning()
        const [s] = await db
          .insert(site)
          .values({
            name: "e2e-site",
            slug: "e2e-site",
            spec: { type: "shared", status: "provisioning" } satisfies SiteSpec,
          })
          .returning()

        // Create system deployment for the preview
        const [sd] = await db
          .insert(systemDeployment)
          .values({
            name: "e2e-preview-sd",
            slug: "e2e-preview-sd",
            type: "dev",
            systemId: sys.id,
            siteId: s.id,
            realmId,
            spec: {
              runtime: "kubernetes",
              createdBy: "e2e-test-user",
              trigger: "pr",
              status: "provisioning",
              namespace: "e2e-preview-sd",
              deploymentStrategy: "rolling",
              labels: {},
            } satisfies SystemDeploymentSpec,
          })
          .returning()

        // Create preview in "deploying" phase with a pre-set imageRef
        previewSlug = "pr-42--feat-auth--default"
        const [prev] = await db
          .insert(preview)
          .values({
            siteId: s.id,
            sourceBranch: "feat/auth",
            prNumber: 42,
            phase: "deploying",
            spec: {
              commitSha: "abc1234567890def",
              repo: "acme-corp/my-app",
              imageRef: "nginx:alpine",
              authMode: "team",
              runtimeClass: "warm",
            } satisfies PreviewSpec,
          })
          .returning()

        previewId = prev!.id
        expect(previewId).toBeTruthy()

        // Reconcile preview → should create K8s Deployment + Service, create route, post PR comment
        await previewReconciler.reconcilePreview(previewId)

        // Verify preview is now active
        const [updatedPrev] = await db
          .select()
          .from(preview)
          .where(eq(preview.id, previewId))
        expect(updatedPrev!.phase).toBe("active")

        // Verify K8s deployment was created
        const deployOutput = kubectlDirect([
          "get",
          "deployment",
          `preview-${previewSlug}`,
          "-n",
          `preview-${previewSlug}`,
          "-o",
          "jsonpath={.spec.template.spec.containers[0].image}",
        ])
        expect(deployOutput.trim()).toBe("nginx:alpine")

        // Verify K8s service was created
        const svcOutput = kubectlDirect([
          "get",
          "service",
          `preview-${previewSlug}`,
          "-n",
          `preview-${previewSlug}`,
          "-o",
          "name",
        ])
        expect(svcOutput.trim()).toBe(`service/preview-${previewSlug}`)

        // Verify gateway route was created
        const route = await lookupRouteByDomain(
          db,
          `${previewSlug}.preview.dx.dev`
        )
        expect(route).toBeTruthy()
        expect(route!.spec.status).toBe("active")
      },
      TEST_TIMEOUT
    )

    it("should have posted a PR comment with the preview URL", () => {
      expect(gitHost.comments).toHaveLength(1)

      const comment = gitHost.comments[0]!
      expect(comment.repo).toBe("acme-corp/my-app")
      expect(comment.prNumber).toBe(42)
      expect(comment.body).toContain("Preview Deployment Ready")
      expect(comment.body).toContain(`https://${previewSlug}.preview.dx.dev`)
      expect(comment.body).toContain("feat/auth")
      expect(comment.body).toContain("abc1234")
    })

    it("should have created/updated GitHub check runs", () => {
      const successCheck = gitHost.checkRuns.find(
        (c) =>
          c.check.status === "completed" && c.check.conclusion === "success"
      )
      expect(successCheck).toBeTruthy()
      expect(successCheck!.repo).toBe("acme-corp/my-app")
      expect(successCheck!.check.detailsUrl).toContain(previewSlug)
    })
  }
)
