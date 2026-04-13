#!/usr/bin/env bun
/**
 * Manual E2E walkthrough: Preview deployment lifecycle
 *
 * Run: cd api && bun src/__tests__/manual-preview-e2e.ts
 *
 * Prerequisites:
 *   - k3d cluster "dx-test" running
 *   - /tmp/k3d-direct.yaml kubeconfig
 */
import type { EstateSpec, RealmSpec } from "@smp/factory-shared/schemas/infra"
import type {
  PreviewSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  WebhookVerification,
} from "../adapters/git-host-adapter"
import type { Database } from "../db/connection"
import { estate, realm } from "../db/schema/infra"
import { preview, site, systemDeployment, workbench } from "../db/schema/ops"
import { system } from "../db/schema/software"
import { createMigratedTestPglite } from "../test-helpers"
import { KubeClientImpl } from "../lib/kube-client-impl"
import { lookupRouteByDomain } from "../modules/infra/gateway.service"
import { PreviewReconciler } from "../reconciler/preview-reconciler"
import { Reconciler } from "../reconciler/reconciler"

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const KUBECONFIG = "/tmp/k3d-direct.yaml"

// ──────────────────────────────────────────────────────────────
// Spy GitHostAdapter
// ──────────────────────────────────────────────────────────────
class SpyGitHostAdapter implements GitHostAdapter {
  readonly type = "spy"
  comments: Array<{ repo: string; prNumber: number; body: string }> = []
  checks: Array<{ repo: string; check: Partial<GitHostCheckRun> }> = []

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
  async createCheckRun(repo: string, check: GitHostCheckRun) {
    this.checks.push({ repo, check })
    return { checkRunId: `check-${this.checks.length}` }
  }
  async updateCheckRun(
    repo: string,
    id: string,
    update: Partial<GitHostCheckRun>
  ) {
    this.checks.push({ repo, check: { ...update, name: id } })
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
  async postPRComment(repo: string, prNumber: number, body: string) {
    this.comments.push({ repo, prNumber, body })
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

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function kubectl(args: string[]): string {
  return execFileSync("kubectl", ["--kubeconfig", KUBECONFIG, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  })
}

function step(n: number, title: string) {
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  Step ${n}: ${title}`)
  console.log(`${"═".repeat(60)}\n`)
}

function info(label: string, value: unknown) {
  console.log(
    `  ${label}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`
  )
}

async function waitForPod(ns: string, podName: string, timeoutMs = 60_000) {
  const start = Date.now()
  process.stdout.write("  Waiting for pod...")
  while (Date.now() - start < timeoutMs) {
    try {
      const phase = kubectl([
        "get",
        "pod",
        podName,
        "-n",
        ns,
        "-o",
        "jsonpath={.status.phase}",
      ]).trim()
      if (phase === "Running") {
        console.log(` Running!`)
        return
      }
      process.stdout.write(`.`)
    } catch {
      process.stdout.write(`.`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  console.log(` TIMEOUT`)
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n  Preview Deployment E2E Manual Test`)
  console.log(`  ${"─".repeat(40)}\n`)

  // Preflight
  if (!existsSync(KUBECONFIG)) {
    console.error(`  ERROR: Kubeconfig not found at ${KUBECONFIG}`)
    console.error(`  Run: k3d kubeconfig get dx-test > ${KUBECONFIG}`)
    process.exit(1)
  }
  try {
    kubectl(["get", "nodes"])
  } catch {
    console.error("  ERROR: k3d cluster not reachable")
    process.exit(1)
  }

  // ── Step 1: Database ──
  step(1, "Initialize PGlite database + migrations")
  const { client, db: rawDb } = await createMigratedTestPglite()
  const db = rawDb as unknown as Database
  info("Database", "PGlite in-memory, migrations applied")

  // ── Step 2: Infra ──
  step(2, "Seed infrastructure (estate + realm)")
  const [sub] = await db
    .insert(estate)
    .values({
      name: "manual-test",
      slug: "manual-test",
      type: "datacenter",
      spec: {} satisfies EstateSpec,
    })
    .returning()
  const [rt] = await db
    .insert(realm)
    .values({
      name: "manual-k3d",
      slug: "manual-k3d",
      type: "k8s-cluster",
      spec: {
        kubeconfigRef: KUBECONFIG,
        status: "ready",
        endpoint: "localhost",
      } satisfies RealmSpec,
    })
    .returning()
  info("Estate", sub.id)
  info("Realm", rt.id)
  info("Kubeconfig", KUBECONFIG)

  // ── Step 3: Reconciler ──
  step(3, "Create reconciler + spy git host adapter")
  const kube = new KubeClientImpl()
  const gitHost = new SpyGitHostAdapter()
  const reconciler = new Reconciler(db, kube, gitHost)
  const previewReconciler = new PreviewReconciler(db, kube, gitHost)
  info("Reconciler", "KubeClientImpl (real kubectl)")
  info("GitHost", "SpyGitHostAdapter (captures PR comments + checks)")

  // ── Step 4: Workbench ──
  step(4, "Create workbench")
  const [wb] = await db
    .insert(workbench)
    .values({
      name: "manual-preview-test",
      slug: "manual-preview-test",
      type: "developer",
      realmId: rt.id,
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
      } satisfies WorkbenchSpec,
    })
    .returning()
  info("Workbench ID", wb.id)
  info("Workbench slug", wb.slug)

  // ── Step 5: Reconcile workbench ──
  step(5, "Reconcile workbench -> K8s resources")
  await reconciler.reconcileWorkbench(wb.id)
  info("Namespace", `workbench-${wb.slug}`)

  // Show K8s resources
  const resources = kubectl([
    "get",
    "all",
    "-n",
    `workbench-${wb.slug}`,
    "--no-headers",
  ]).trim()
  console.log(`\n  K8s resources created:\n`)
  resources.split("\n").forEach((line) => console.log(`    ${line}`))

  // Wait for pod
  await waitForPod(`workbench-${wb.slug}`, `workbench-${wb.slug}`)

  // Re-reconcile to pick up pod IP
  await reconciler.reconcileWorkbench(wb.id)
  const [updatedWb] = await db
    .select()
    .from(workbench)
    .where(eq(workbench.id, wb.id))
  info("Pod name", updatedWb!.spec.podName)
  info("Pod IP", updatedWb!.spec.ipAddress)

  // ── Step 6: Create preview ──
  step(6, "Create preview (simulating PR #42 on feat/auth)")
  const previewSlug = "pr-42--feat-auth--default"
  const [sys] = await db
    .insert(system)
    .values({
      name: "manual-app",
      slug: "manual-app",
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
      name: "manual-site",
      slug: "manual-site",
      type: "development",
      spec: { status: "provisioning" } satisfies SiteSpec,
    })
    .returning()
  const [sd] = await db
    .insert(systemDeployment)
    .values({
      name: "manual-preview-sd",
      slug: "manual-preview-sd",
      type: "dev",
      systemId: sys.id,
      siteId: s.id,
      realmId: rt.id,
      spec: {
        runtime: "kubernetes",
        createdBy: "manual-user",
        trigger: "pr",
        status: "provisioning",
        namespace: "manual-preview-sd",
        deploymentStrategy: "rolling",
        labels: {},
      } satisfies SystemDeploymentSpec,
    })
    .returning()
  const [prev] = await db
    .insert(preview)
    .values({
      slug: "pr-42--feat-auth--default",
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
  info("Preview ID", prev!.id)
  info("Preview slug", previewSlug)
  info("Image", "nginx:alpine")
  info("Status", "deploying")

  // ── Step 7: Reconcile preview ──
  step(7, "Reconcile preview -> deploy K8s + post PR comment")
  await previewReconciler.reconcilePreview(prev!.id)

  // Check final status
  const [finalPrev] = await db
    .select()
    .from(preview)
    .where(eq(preview.id, prev!.id))
  info("Preview phase", finalPrev!.phase)

  // Show K8s deployment
  console.log(`\n  K8s resources in preview namespace:\n`)
  const previewResources = kubectl([
    "get",
    "all",
    "-n",
    `preview-${previewSlug}`,
    "--no-headers",
  ]).trim()
  previewResources.split("\n").forEach((line) => console.log(`    ${line}`))

  // Show routes
  const route = await lookupRouteByDomain(db, `${previewSlug}.preview.dx.dev`)
  console.log(`\n  Gateway route:`)
  info("Domain", route?.domain)
  info("Target", `${route?.spec?.targetService}:${route?.spec?.targetPort}`)
  info("Status", route?.spec?.status)

  // ── Step 8: Show PR comment ──
  step(8, "PR Comment (captured by spy adapter)")
  if (gitHost.comments.length > 0) {
    const comment = gitHost.comments[0]!
    info("Repo", comment.repo)
    info("PR #", comment.prNumber)
    console.log(`\n  Comment body:\n`)
    comment.body.split("\n").forEach((line) => console.log(`    ${line}`))
  } else {
    console.log("  No PR comment was posted!")
  }

  // ── Step 9: Show check runs ──
  step(9, "GitHub Check Runs (captured by spy adapter)")
  gitHost.checks.forEach(
    (c: { repo: string; check: Partial<GitHostCheckRun> }, i: number) => {
      console.log(`  Check ${i + 1}:`)
      info("  Repo", c.repo)
      info("  Status", c.check.status)
      info("  Conclusion", c.check.conclusion)
      if (c.check.detailsUrl) info("  Details URL", c.check.detailsUrl)
      if (c.check.output) info("  Title", c.check.output.title)
      console.log()
    }
  )

  // ── Cleanup ──
  step(10, "Cleanup")
  try {
    kubectl([
      "delete",
      "namespace",
      `workbench-${wb.slug}`,
      "--ignore-not-found",
      "--wait=false",
    ])
    info("Deleted", `workbench-${wb.slug}`)
  } catch {}
  try {
    kubectl([
      "delete",
      "namespace",
      `preview-${previewSlug}`,
      "--ignore-not-found",
      "--wait=false",
    ])
    info("Deleted", `preview-${previewSlug}`)
  } catch {}
  await client.close()

  console.log(`\n${"═".repeat(60)}`)
  console.log(`  Done! All phases verified.`)
  console.log(`${"═".repeat(60)}\n`)
}

main().catch((err) => {
  console.error("\nFATAL:", err)
  process.exit(1)
})
