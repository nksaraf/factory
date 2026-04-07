/**
 * Agent executor — runs an agent job asynchronously.
 *
 * Flow for a NEW job (followUp=false):
 *   1. Provision a sandbox (createSandbox + reconcile)
 *   2. Wait for sandbox pod to be ready
 *   3. Exec `dx dev` inside sandbox → starts dev server
 *   4. Post sandbox URL to Slack thread
 *   5. Mark job as succeeded
 *
 * Flow for a FOLLOW-UP message (followUp=true):
 *   1. Find the job's sandbox
 *   2. Exec the command inside the existing sandbox
 *   3. Post result to Slack thread
 */
import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import type { KubeClient } from "../../lib/kube-client";
import { getJob, completeJob, failJob } from "./job.model";
import { getMessagingProvider } from "../messaging/messaging.service";
import { getMessagingAdapter } from "../../adapters/adapter-registry";
import type { MessagingType } from "../../adapters/messaging-adapter";
import { job } from "../../db/schema/agent";
import { workspace } from "../../db/schema/ops";
import { runtime } from "../../db/schema/infra-v2";
import type { WorkspaceSpec } from "@smp/factory-shared/schemas/ops";
import type { RuntimeSpec } from "@smp/factory-shared/schemas/infra";
import { messagingProvider } from "../../db/schema/org";
import { logger } from "../../logger";

export interface ExecuteOptions {
  followUp: boolean;
  text: string;
  principalId: string | null;
}

// Module-level kube client — set via setKubeClient() at app startup
let kubeClient: KubeClient | null = null;

export function setExecutorKubeClient(kube: KubeClient) {
  kubeClient = kube;
}

/**
 * Execute an agent job. Called fire-and-forget from dispatch.
 */
export async function executeAgentJob(
  db: Database,
  jobId: string,
  opts: ExecuteOptions,
): Promise<void> {
  const jobRow = await getJob(db, jobId);
  if (!jobRow) {
    logger.error({ jobId }, "Job not found for execution");
    return;
  }

  try {
    if (opts.followUp) {
      await handleFollowUp(db, jobRow, opts);
    } else {
      await handleNewJob(db, jobRow, opts);
    }
  } catch (err) {
    logger.error({ jobId, error: err }, "Agent job execution error");
    await failJob(db, jobId, { error: String(err) });

    // Best-effort: notify Slack of the failure
    await postToThread(db, jobRow, `⚠️ Agent encountered an error: ${String(err).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// New job: provision sandbox → start dev server → post URL
// ---------------------------------------------------------------------------

async function handleNewJob(
  db: Database,
  jobRow: typeof job.$inferSelect,
  opts: ExecuteOptions,
): Promise<void> {
  const metadata = (jobRow.metadata ?? {}) as Record<string, unknown>;
  const providerId = metadata.providerId as string | undefined;

  // 1. Acknowledge in Slack
  await postToThread(db, jobRow, "🔧 Setting up a development environment...");

  // 2. Create workspace row — reconciler will provision it
  const { allocateSlug } = await import("../../lib/slug");
  const wsName = `agent-${jobRow.jobId.slice(0, 12)}`;
  const slug = await allocateSlug({
    baseLabel: wsName,
    isTaken: async (s) => {
      const [r] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.slug, s)).limit(1);
      return !!r;
    },
  });

  const repos = resolveRepos(jobRow);
  const [ws] = await db
    .insert(workspace)
    .values({
      name: wsName,
      slug,
      type: "agent",
      ownerId: jobRow.agentId,
      // TODO: fix type — `trigger` is not yet in WorkspaceSpec; add when schema is updated
      spec: {
        runtimeType: "container",
        devcontainerConfig: {},
        repos,
        lifecycle: "provisioning",
        ownerType: "agent",
        trigger: "agent",
      } as WorkspaceSpec & { trigger?: string },
    })
    .returning();

  // Store workspace reference in job metadata
  await db
    .update(job)
    .set({
      metadata: { ...metadata, workspaceId: ws.id, workspaceSlug: ws.slug },
    })
    .where(eq(job.jobId, jobRow.jobId));

  logger.info(
    { jobId: jobRow.jobId, workspaceId: ws.id, slug: ws.slug },
    "Workspace created for agent job",
  );

  // 3. Wait for workspace to be reconciled and pod to be ready
  const ready = await waitForWorkspaceReady(db, ws.id, 120_000);
  if (!ready) {
    await failJob(db, jobRow.jobId, { error: "Workspace provisioning timed out" });
    await postToThread(db, jobRow, "Workspace provisioning timed out.");
    return;
  }

  // 4. Exec dx dev inside the workspace (non-blocking — starts the dev server)
  const workspaceUrl = `https://${ws.slug}.workspace.dx.dev`;
  if (kubeClient) {
    try {
      const wsFull = await loadWorkspaceWithRuntime(db, ws.id);
      if (wsFull) {
        const ns = `workspace-${ws.slug}`;
        const podName = `workspace-${ws.slug}`;
        await kubeClient.execInPod(
          wsFull.kubeconfig,
          ns,
          podName,
          "workspace",
          ["sh", "-c", "nohup dx dev > /tmp/dx-dev.log 2>&1 &"],
          { timeoutMs: 10_000 },
        );
        logger.info({ jobId: jobRow.jobId, workspaceSlug: ws.slug }, "Started dx dev in workspace");
      }
    } catch (err) {
      logger.warn({ jobId: jobRow.jobId, error: err }, "Failed to start dx dev (workspace still accessible)");
    }
  }

  // 5. Post the workspace URL to Slack
  await postToThread(
    db,
    jobRow,
    [
      `Development environment ready!`,
      "",
      `${workspaceUrl}`,
      "",
      `Terminal: https://${ws.slug}--terminal.workspace.dx.dev`,
      `IDE: https://${ws.slug}--ide.workspace.dx.dev`,
      "",
      `I'm working on: _${opts.text.slice(0, 200)}_`,
    ].join("\n"),
  );

  // 6. Mark job outcome with workspace info
  await completeJob(db, jobRow.jobId, {
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    workspaceUrl,
  });
}

// ---------------------------------------------------------------------------
// Follow-up: exec in existing sandbox
// ---------------------------------------------------------------------------

async function handleFollowUp(
  db: Database,
  jobRow: typeof job.$inferSelect,
  opts: ExecuteOptions,
): Promise<void> {
  const metadata = (jobRow.metadata ?? {}) as Record<string, unknown>;
  const workspaceId = (metadata.workspaceId ?? metadata.sandboxId) as string | undefined;

  if (!workspaceId) {
    await postToThread(db, jobRow, "No workspace associated with this thread.");
    return;
  }

  if (!kubeClient) {
    await postToThread(db, jobRow, "Executor not configured — cannot run commands.");
    return;
  }

  const wsFull = await loadWorkspaceWithRuntime(db, workspaceId);
  if (!wsFull) {
    await postToThread(db, jobRow, "Workspace no longer available.");
    return;
  }

  const ns = `workspace-${wsFull.slug}`;
  const podName = `workspace-${wsFull.slug}`;

  try {
    const result = await kubeClient.execInPod(
      wsFull.kubeconfig,
      ns,
      podName,
      "workspace",
      ["sh", "-c", opts.text],
      { timeoutMs: 60_000 },
    );

    const output = (result.stdout + result.stderr).trim().slice(0, 3000);
    const exitInfo = result.exitCode === 0 ? "" : ` (exit code: ${result.exitCode})`;
    await postToThread(
      db,
      jobRow,
      output ? `\`\`\`\n${output}\n\`\`\`${exitInfo}` : `✅ Command completed${exitInfo}`,
    );
  } catch (err) {
    await postToThread(db, jobRow, `⚠️ Execution error: ${String(err).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve repos from job entity context.
 * If entityKind is a repo-like entity, include it.
 */
function resolveRepos(
  jobRow: typeof job.$inferSelect,
): Array<{ url: string; branch?: string }> {
  const metadata = (jobRow.metadata ?? {}) as Record<string, unknown>;
  const repos = metadata.repos as Array<{ url: string; branch?: string }> | undefined;
  if (repos && repos.length > 0) return repos;

  // If entity is a repo, use it
  if (jobRow.entityKind === "repo" && jobRow.entityId) {
    return [{ url: jobRow.entityId }];
  }

  return [];
}

/**
 * Poll for workspace readiness (spec.lifecycle = active, spec.podName set).
 */
async function waitForWorkspaceReady(
  db: Database,
  workspaceId: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
    const spec: WorkspaceSpec | undefined = ws?.spec ?? undefined;
    if (ws && spec?.lifecycle === "active" && spec?.podName) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Load workspace with its runtime kubeconfig for exec operations.
 */
async function loadWorkspaceWithRuntime(
  db: Database,
  workspaceId: string,
): Promise<{ slug: string; kubeconfig: string } | null> {
  const [ws] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws?.runtimeId) return null;

  const [rt] = await db
    .select()
    .from(runtime)
    .where(eq(runtime.id, ws.runtimeId))
    .limit(1);
  const rtSpec: RuntimeSpec = rt?.spec ?? {} as RuntimeSpec;
  if (!rtSpec.kubeconfigRef) return null;

  return { slug: ws.slug, kubeconfig: rtSpec.kubeconfigRef };
}

/**
 * Post a message to the Slack thread associated with a job.
 */
async function postToThread(
  db: Database,
  jobRow: typeof job.$inferSelect,
  text: string,
): Promise<void> {
  const metadata = (jobRow.metadata ?? {}) as Record<string, unknown>;
  const providerId = metadata.providerId as string | undefined;

  if (!providerId || !jobRow.channelId) return;

  try {
    const provider = await getMessagingProvider(db, providerId);
    if (!provider) return;

    const adapter = getMessagingAdapter(provider.type as MessagingType);
    const spec = (provider.spec ?? {}) as Record<string, unknown>;
    await adapter.sendMessage(
      {
        botToken: (spec.botToken as string) ?? "",
        signingSecret: (spec.signingSecret as string) ?? "",
        workspaceExternalId: (spec.workspaceId as string) ?? undefined,
      },
      jobRow.channelId,
      {
        text,
        threadId: metadata.threadId as string | undefined,
      },
    );
  } catch (err) {
    logger.warn({ jobId: jobRow.jobId, error: err }, "Failed to post to Slack thread");
  }
}
