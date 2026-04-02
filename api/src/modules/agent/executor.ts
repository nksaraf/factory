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
import { createSandbox, getSandbox } from "../../services/sandbox/sandbox.service";
import { getMessagingProvider } from "../messaging/messaging.service";
import { getMessagingAdapter } from "../../adapters/adapter-registry";
import { job } from "../../db/schema/agent";
import { sandbox, deploymentTarget } from "../../db/schema/fleet";
import { cluster } from "../../db/schema/infra";
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

  // 2. Provision sandbox
  const sbx = await createSandbox(db, {
    name: `agent-${jobRow.jobId.slice(0, 12)}`,
    ownerId: jobRow.agentId,
    ownerType: "agent",
    runtimeType: "container",
    devcontainerConfig: {},
    repos: resolveRepos(jobRow),
    trigger: "agent",
  });

  // Store sandbox reference in job metadata
  await db
    .update(job)
    .set({
      metadata: { ...metadata, sandboxId: sbx.sandboxId, sandboxSlug: sbx.slug },
    })
    .where(eq(job.jobId, jobRow.jobId));

  logger.info(
    { jobId: jobRow.jobId, sandboxId: sbx.sandboxId, slug: sbx.slug },
    "Sandbox created for agent job",
  );

  // 3. Wait for sandbox to be reconciled and pod to be ready
  // The reconciler loop will pick this up. We poll for readiness.
  const ready = await waitForSandboxReady(db, sbx.sandboxId, 120_000);
  if (!ready) {
    await failJob(db, jobRow.jobId, { error: "Sandbox provisioning timed out" });
    await postToThread(db, jobRow, "❌ Sandbox provisioning timed out.");
    return;
  }

  // 4. Exec dx dev inside the sandbox (non-blocking — starts the dev server)
  const sandboxUrl = `https://${sbx.slug}.sandbox.dx.dev`;
  if (kubeClient) {
    try {
      const sbxFull = await loadSandboxWithCluster(db, sbx.sandboxId);
      if (sbxFull) {
        const ns = `sandbox-${sbx.slug}`;
        const podName = `sandbox-${sbx.slug}`;
        // Start dx dev in the background (nohup). It will create tunnels automatically.
        await kubeClient.execInPod(
          sbxFull.kubeconfig,
          ns,
          podName,
          "workspace",
          ["sh", "-c", "nohup dx dev > /tmp/dx-dev.log 2>&1 &"],
          { timeoutMs: 10_000 },
        );
        logger.info({ jobId: jobRow.jobId, sandboxSlug: sbx.slug }, "Started dx dev in sandbox");
      }
    } catch (err) {
      // dx dev start is best-effort; sandbox URL still works for terminal access
      logger.warn({ jobId: jobRow.jobId, error: err }, "Failed to start dx dev (sandbox still accessible)");
    }
  }

  // 5. Post the sandbox URL to Slack
  await postToThread(
    db,
    jobRow,
    [
      `✅ Development environment ready!`,
      "",
      `🔗 **${sandboxUrl}**`,
      "",
      `Terminal: https://${sbx.slug}--terminal.sandbox.dx.dev`,
      `IDE: https://${sbx.slug}--ide.sandbox.dx.dev`,
      "",
      `I'm working on: _${opts.text.slice(0, 200)}_`,
    ].join("\n"),
  );

  // 6. Mark job outcome with sandbox info
  await completeJob(db, jobRow.jobId, {
    sandboxId: sbx.sandboxId,
    sandboxSlug: sbx.slug,
    sandboxUrl,
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
  const sandboxId = metadata.sandboxId as string | undefined;

  if (!sandboxId) {
    await postToThread(db, jobRow, "No sandbox associated with this thread.");
    return;
  }

  if (!kubeClient) {
    await postToThread(db, jobRow, "Executor not configured — cannot run commands.");
    return;
  }

  const sbxFull = await loadSandboxWithCluster(db, sandboxId);
  if (!sbxFull) {
    await postToThread(db, jobRow, "Sandbox no longer available.");
    return;
  }

  const ns = `sandbox-${sbxFull.slug}`;
  const podName = `sandbox-${sbxFull.slug}`;

  try {
    const result = await kubeClient.execInPod(
      sbxFull.kubeconfig,
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
 * Poll for sandbox readiness (deployment target status = active).
 */
async function waitForSandboxReady(
  db: Database,
  sandboxId: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sbx = await getSandbox(db, sandboxId);
    if (sbx && sbx.status === "active" && sbx.podName) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Load sandbox with its cluster kubeconfig for exec operations.
 */
async function loadSandboxWithCluster(
  db: Database,
  sandboxId: string,
): Promise<{ slug: string; kubeconfig: string } | null> {
  const [sbxRow] = await db
    .select()
    .from(sandbox)
    .where(eq(sandbox.sandboxId, sandboxId))
    .limit(1);
  if (!sbxRow) return null;

  const [dtRow] = await db
    .select()
    .from(deploymentTarget)
    .where(eq(deploymentTarget.deploymentTargetId, sbxRow.deploymentTargetId))
    .limit(1);
  if (!dtRow?.clusterId) return null;

  const [clRow] = await db
    .select()
    .from(cluster)
    .where(eq(cluster.clusterId, dtRow.clusterId))
    .limit(1);
  if (!clRow?.kubeconfigRef) return null;

  return { slug: sbxRow.slug, kubeconfig: clRow.kubeconfigRef };
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

    const adapter = getMessagingAdapter(provider.kind);
    await adapter.sendMessage(
      {
        botToken: provider.botTokenEnc ?? "",
        signingSecret: provider.signingSecret ?? "",
        workspaceExternalId: provider.workspaceExternalId ?? undefined,
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
