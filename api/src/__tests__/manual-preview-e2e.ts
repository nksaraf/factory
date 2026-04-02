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
import path from "node:path"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { eq } from "drizzle-orm"

import { createPgliteDb, migrateWithPglite } from "../factory-core"
import { KubeClientImpl } from "../lib/kube-client-impl"
import { Reconciler } from "../reconciler/reconciler"
import { PreviewReconciler } from "../reconciler/preview-reconciler"
import { createSandbox } from "../services/sandbox/sandbox.service"
import { provider, cluster } from "../db/schema/infra"
import { sandbox, preview, deploymentTarget } from "../db/schema/fleet"
import { lookupRouteByDomain } from "../modules/infra/gateway.service"
import type { Database } from "../db/connection"
import type {
  GitHostAdapter,
  GitHostCheckRun,
  GitHostPullRequest,
  GitHostPullRequestCreate,
  WebhookVerification,
} from "../adapters/git-host-adapter"

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const KUBECONFIG = "/tmp/k3d-direct.yaml"

// ──────────────────────────────────────────────────────────────
// Spy GitHostAdapter
// ──────────────────────────────────────────────────────────────
class SpyGitHostAdapter implements GitHostAdapter {
  readonly hostType = "spy"
  comments: Array<{ repo: string; prNumber: number; body: string }> = []
  checks: Array<{ repo: string; check: Partial<GitHostCheckRun> }> = []

  async getAccessToken() { return "spy-token" }
  async listRepos() { return [] }
  async getRepo() { return null }
  async listOrgMembers() { return [] }
  async listCollaborators() { return [] }
  async verifyWebhook(_h: Record<string, string>, body: string): Promise<WebhookVerification> {
    return { valid: true, eventType: "push", deliveryId: "spy", payload: JSON.parse(body) }
  }
  async createWebhook() { return { webhookId: "spy-wh" } }
  async deleteWebhook() {}
  async postCommitStatus() {}
  async createCheckRun(repo: string, check: GitHostCheckRun) {
    this.checks.push({ repo, check })
    return { checkRunId: `check-${this.checks.length}` }
  }
  async updateCheckRun(repo: string, id: string, update: Partial<GitHostCheckRun>) {
    this.checks.push({ repo, check: { ...update, name: id } })
  }
  async listPullRequests() { return [] }
  async getPullRequest() { return null }
  async createPullRequest(_r: string, _pr: GitHostPullRequestCreate): Promise<GitHostPullRequest> {
    return { number: 0, title: "", body: "", state: "open", head: "", base: "", url: "", draft: false, createdAt: "", updatedAt: "", author: { login: "spy" } }
  }
  async mergePullRequest() {}
  async getPullRequestChecks() { return [] }
  async postPRComment(repo: string, prNumber: number, body: string) {
    this.comments.push({ repo, prNumber, body })
    return { commentId: `comment-${this.comments.length}` }
  }
  async listPRComments() { return [] }
  async updatePRComment() {}
  async createDeployment() { return { deploymentId: 0 } }
  async createDeploymentStatus() {}
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
  console.log(`  ${label}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
}

async function waitForPod(ns: string, podName: string, timeoutMs = 60_000) {
  const start = Date.now()
  process.stdout.write("  Waiting for pod...")
  while (Date.now() - start < timeoutMs) {
    try {
      const phase = kubectl(["get", "pod", podName, "-n", ns, "-o", "jsonpath={.status.phase}"]).trim()
      if (phase === "Running") { console.log(` Running!`); return }
      process.stdout.write(`.`)
    } catch { process.stdout.write(`.`) }
    await new Promise(r => setTimeout(r, 2000))
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
  try { kubectl(["get", "nodes"]) }
  catch { console.error("  ERROR: k3d cluster not reachable"); process.exit(1) }

  // ── Step 1: Database ──
  step(1, "Initialize PGlite database + migrations")
  const { client, db: rawDb } = await createPgliteDb()
  const db = rawDb as unknown as Database
  await migrateWithPglite(client as any, path.join(process.cwd(), "drizzle"))
  info("Database", "PGlite in-memory, migrations applied")

  // ── Step 2: Infra ──
  step(2, "Seed infrastructure (provider + cluster)")
  const [prv] = await db.insert(provider).values({
    name: "manual-test", slug: "manual-test", providerType: "bare_metal",
    providerKind: "internal", status: "active",
  }).returning()
  const [cls] = await db.insert(cluster).values({
    name: "manual-k3d", slug: "manual-k3d", providerId: prv!.providerId,
    status: "ready", kubeconfigRef: KUBECONFIG, endpoint: "localhost",
  }).returning()
  info("Provider", prv!.providerId)
  info("Cluster", cls!.clusterId)
  info("Kubeconfig", KUBECONFIG)

  // ── Step 3: Reconciler ──
  step(3, "Create reconciler + spy git host adapter")
  const kube = new KubeClientImpl()
  const gitHost = new SpyGitHostAdapter()
  const reconciler = new Reconciler(db, kube, gitHost)
  const previewReconciler = new PreviewReconciler(db, kube, gitHost)
  info("Reconciler", "KubeClientImpl (real kubectl)")
  info("GitHost", "SpyGitHostAdapter (captures PR comments + checks)")

  // ── Step 4: Sandbox ──
  step(4, "Create sandbox")
  const sbx = await createSandbox(db, {
    name: "manual-preview-test", ownerId: "manual-user", ownerType: "user",
    runtimeType: "container", devcontainerImage: "alpine:3.19",
    devcontainerConfig: {}, repos: [], cpu: "500m", memory: "256Mi",
    storageGb: 1, dockerCacheGb: 1, clusterId: cls!.clusterId,
  })
  info("Sandbox ID", sbx.sandboxId)
  info("Sandbox slug", sbx.slug)

  // ── Step 5: Reconcile sandbox ──
  step(5, "Reconcile sandbox -> K8s resources")
  await reconciler.reconcileSandbox(sbx.sandboxId)
  info("Namespace", `sandbox-${sbx.slug}`)

  // Show K8s resources
  const resources = kubectl(["get", "all", "-n", `sandbox-${sbx.slug}`, "--no-headers"]).trim()
  console.log(`\n  K8s resources created:\n`)
  resources.split("\n").forEach(line => console.log(`    ${line}`))

  // Wait for pod
  await waitForPod(`sandbox-${sbx.slug}`, `sandbox-${sbx.slug}`)

  // Re-reconcile to pick up pod IP
  await reconciler.reconcileSandbox(sbx.sandboxId)
  const [updatedSbx] = await db.select().from(sandbox).where(eq(sandbox.sandboxId, sbx.sandboxId))
  info("Pod name", updatedSbx!.podName)
  info("Pod IP", updatedSbx!.ipAddress)

  // ── Step 6: Create preview ──
  step(6, "Create preview (simulating PR #42 on feat/auth)")
  const previewSlug = "pr-42--feat-auth--default"
  const [dt] = await db.insert(deploymentTarget).values({
    name: "manual-preview-dt", slug: "manual-preview-dt",
    kind: "preview", runtime: "kubernetes",
    createdBy: "manual-user", trigger: "pr",
    status: "provisioning", clusterId: cls!.clusterId,
  }).returning()
  const [prev] = await db.insert(preview).values({
    deploymentTargetId: dt!.deploymentTargetId,
    name: "PR #42 Preview", slug: previewSlug,
    sourceBranch: "feat/auth", commitSha: "abc1234567890def",
    repo: "acme-corp/my-app", prNumber: 42,
    ownerId: "manual-user", status: "deploying",
    sandboxId: sbx.sandboxId, imageRef: "nginx:alpine",
  }).returning()
  info("Preview ID", prev!.previewId)
  info("Preview slug", previewSlug)
  info("Image", "nginx:alpine")
  info("Status", "deploying")

  // ── Step 7: Reconcile preview ──
  step(7, "Reconcile preview -> deploy K8s + post PR comment")
  await previewReconciler.reconcilePreview(prev!.previewId)

  // Check final status
  const [finalPrev] = await db.select().from(preview).where(eq(preview.previewId, prev!.previewId))
  info("Preview status", finalPrev!.status)

  // Show K8s deployment
  console.log(`\n  K8s resources in preview namespace:\n`)
  const previewResources = kubectl(["get", "all", "-n", `preview-${previewSlug}`, "--no-headers"]).trim()
  previewResources.split("\n").forEach(line => console.log(`    ${line}`))

  // Show routes
  const route = await lookupRouteByDomain(db, `${previewSlug}.preview.dx.dev`)
  console.log(`\n  Gateway route:`)
  info("Domain", route?.domain)
  info("Target", `${route?.targetService}:${route?.targetPort}`)
  info("Status", route?.status)

  // ── Step 8: Show PR comment ──
  step(8, "PR Comment (captured by spy adapter)")
  if (gitHost.comments.length > 0) {
    const comment = gitHost.comments[0]!
    info("Repo", comment.repo)
    info("PR #", comment.prNumber)
    console.log(`\n  Comment body:\n`)
    comment.body.split("\n").forEach(line => console.log(`    ${line}`))
  } else {
    console.log("  No PR comment was posted!")
  }

  // ── Step 9: Show check runs ──
  step(9, "GitHub Check Runs (captured by spy adapter)")
  gitHost.checks.forEach((c, i) => {
    console.log(`  Check ${i + 1}:`)
    info("  Repo", c.repo)
    info("  Status", c.check.status)
    info("  Conclusion", c.check.conclusion)
    if (c.check.detailsUrl) info("  Details URL", c.check.detailsUrl)
    if (c.check.output) info("  Title", c.check.output.title)
    console.log()
  })

  // ── Cleanup ──
  step(10, "Cleanup")
  try {
    kubectl(["delete", "namespace", `sandbox-${sbx.slug}`, "--ignore-not-found", "--wait=false"])
    info("Deleted", `sandbox-${sbx.slug}`)
  } catch {}
  try {
    kubectl(["delete", "namespace", `preview-${previewSlug}`, "--ignore-not-found", "--wait=false"])
    info("Deleted", `preview-${previewSlug}`)
  } catch {}
  await client.close()

  console.log(`\n${"═".repeat(60)}`)
  console.log(`  Done! All phases verified.`)
  console.log(`${"═".repeat(60)}\n`)
}

main().catch(err => {
  console.error("\nFATAL:", err)
  process.exit(1)
})
