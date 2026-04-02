import { and, eq, notInArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { KubeClient } from "../lib/kube-client";
import type { GitHostAdapter } from "../adapters/git-host-adapter";
import { generateSandboxResources, generateVolumeSnapshots, generatePVCFromSnapshot } from "./sandbox-resource-generator";
import { getRuntimeStrategy, registerRuntimeStrategy, type ReconcileContext } from "./runtime-strategy";
import { KubernetesStrategy } from "./strategies/kubernetes";
import { ComposeStrategy } from "./strategies/compose";
import { SystemdStrategy } from "./strategies/systemd";
import { WindowsServiceStrategy, IisStrategy } from "./strategies/windows";
import { NoopStrategy } from "./strategies/noop";
import { workload, sandbox, deploymentTarget, preview } from "../db/schema/fleet";
import { cluster } from "../db/schema/infra";
import { PreviewReconciler } from "./preview-reconciler";
import { componentSpec, productModule } from "../db/schema/product";
import { moduleVersion } from "../db/schema/build";
import { expireStale, getSnapshot, updateSnapshotStatus, updateSandboxHealth } from "../services/sandbox/sandbox.service";
import { sandboxSnapshot } from "../db/schema/fleet";
import { createRoute, lookupRouteByDomain } from "../modules/infra/gateway.service";
import { logger } from "../logger";

// Default storage class for CSI snapshot support.
// Set via SANDBOX_STORAGE_CLASS env var, falls back to "csi-hostpath-sc".
const SANDBOX_STORAGE_CLASS = process.env.SANDBOX_STORAGE_CLASS || "csi-hostpath-sc";

// Envbuilder image cache registry (optional — disables caching if not set).
const ENVBUILDER_CACHE_REPO = process.env.ENVBUILDER_CACHE_REPO || undefined;
const ENVBUILDER_IMAGE = process.env.ENVBUILDER_IMAGE || undefined;

/** Sanitize an ID for use in k8s resource names (RFC 1123). */
function k8sName(id: string): string {
  return id.replace(/_/g, "-").toLowerCase();
}

export class Reconciler {
  private previewReconciler: PreviewReconciler;

  constructor(
    private db: Database,
    private kube: KubeClient,
    gitHost?: GitHostAdapter,
  ) {
    this.previewReconciler = new PreviewReconciler(db, kube, gitHost);
    registerRuntimeStrategy("kubernetes", () => new KubernetesStrategy(kube));
    registerRuntimeStrategy("compose", () => new ComposeStrategy());
    registerRuntimeStrategy("systemd", () => new SystemdStrategy());
    registerRuntimeStrategy("windows_service", () => new WindowsServiceStrategy());
    registerRuntimeStrategy("iis", () => new IisStrategy());
    registerRuntimeStrategy("process", () => new NoopStrategy());
  }

  async reconcileAll(): Promise<{ reconciled: number; errors: number }> {
    const activeWorkloads = await this.db
      .select()
      .from(workload)
      .where(notInArray(workload.status, ["completed", "stopped"]));

    let reconciled = 0;
    let errors = 0;

    for (const wl of activeWorkloads) {
      try {
        await this.reconcileWorkload(wl.workloadId);
        reconciled++;
      } catch (err) {
        errors++;
        logger.error(
          { workloadId: wl.workloadId, error: err },
          "Failed to reconcile workload"
        );
      }
    }

    // --- Sandbox reconciliation ---
    const activeSandboxes = await this.db
      .select({
        sandboxId: sandbox.sandboxId,
        runtimeType: sandbox.runtimeType,
        status: deploymentTarget.status,
      })
      .from(sandbox)
      .innerJoin(
        deploymentTarget,
        eq(sandbox.deploymentTargetId, deploymentTarget.deploymentTargetId)
      )
      .where(
        and(
          eq(sandbox.runtimeType, "container"),
          notInArray(deploymentTarget.status, ["destroyed"])
        )
      );

    for (const sbx of activeSandboxes) {
      try {
        await this.reconcileSandbox(sbx.sandboxId);
        reconciled++;
      } catch (err) {
        errors++;
        logger.error(
          { sandboxId: sbx.sandboxId, error: err },
          "Failed to reconcile sandbox"
        );
      }
    }

    // --- Preview reconciliation ---
    const activePreviews = await this.db
      .select({ previewId: preview.previewId })
      .from(preview)
      .where(
        notInArray(preview.status, ["active", "inactive", "expired", "failed"])
      );

    for (const prev of activePreviews) {
      try {
        await this.previewReconciler.reconcilePreview(prev.previewId);
        reconciled++;
      } catch (err) {
        errors++;
        logger.error(
          { previewId: prev.previewId, error: err },
          "Failed to reconcile preview"
        );
      }
    }

    // --- Expired preview K8s cleanup ---
    const expiredPreviews = await this.db
      .select({
        previewId: preview.previewId,
        slug: preview.slug,
        dtId: deploymentTarget.deploymentTargetId,
        clusterId: deploymentTarget.clusterId,
      })
      .from(preview)
      .innerJoin(
        deploymentTarget,
        eq(preview.deploymentTargetId, deploymentTarget.deploymentTargetId)
      )
      .where(
        and(
          eq(preview.status, "expired"),
          notInArray(deploymentTarget.status, ["destroyed"])
        )
      );

    for (const ep of expiredPreviews) {
      try {
        if (!ep.clusterId) continue;
        const [cl] = await this.db
          .select()
          .from(cluster)
          .where(eq(cluster.clusterId, ep.clusterId))
          .limit(1);
        if (!cl?.kubeconfigRef) continue;

        const ns = `preview-${ep.slug}`;
        await this.kube.remove(cl.kubeconfigRef, "Namespace", "", ns);
        await this.db
          .update(deploymentTarget)
          .set({ status: "destroyed", destroyedAt: new Date() })
          .where(eq(deploymentTarget.deploymentTargetId, ep.dtId));
        logger.info({ previewId: ep.previewId, ns }, "Cleaned up expired preview K8s resources");
      } catch (err) {
        logger.error(
          { previewId: ep.previewId, error: err },
          "Failed to cleanup expired preview"
        );
      }
    }

    // Expire stale sandboxes past their TTL
    await expireStale(this.db);

    return { reconciled, errors };
  }

  async reconcileSandbox(sandboxId: string): Promise<void> {
    // 1. Load sandbox
    const sbxRows = await this.db
      .select()
      .from(sandbox)
      .where(eq(sandbox.sandboxId, sandboxId));
    const sbx = sbxRows[0];
    if (!sbx) throw new Error(`Sandbox not found: ${sandboxId}`);

    // 2. Skip if runtimeType !== 'container' (VM sandboxes managed directly)
    if (sbx.runtimeType !== "container") return;

    // 3. Load deployment target
    const dtRows = await this.db
      .select()
      .from(deploymentTarget)
      .where(eq(deploymentTarget.deploymentTargetId, sbx.deploymentTargetId));
    const dt = dtRows[0];
    if (!dt) throw new Error(`Deployment target not found: ${sbx.deploymentTargetId}`);

    // 4. Load cluster + kubeconfig from deployment target's clusterId
    const clusterId = dt.clusterId;
    if (!clusterId) throw new Error(`Deployment target ${dt.deploymentTargetId} has no cluster`);

    const clusterRows = await this.db
      .select()
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId));
    const cl = clusterRows[0];
    if (!cl) throw new Error(`Cluster not found: ${clusterId}`);
    if (!cl.kubeconfigRef) throw new Error(`Cluster ${clusterId} has no kubeconfig`);

    const kubeconfig = cl.kubeconfigRef;
    const ns = `sandbox-${sbx.slug}`;
    const podName = `sandbox-${sbx.slug}`;
    const serviceName = `sandbox-${sbx.slug}`;

    // 5. If status === 'suspended': delete Pod (keep PVC) → return
    if (dt.status === "suspended") {
      await this.kube.remove(kubeconfig, "Pod", ns, podName);
      return;
    }

    // 6. If status === 'destroying': delete Namespace (cascades all) → set destroyed, destroyedAt → return
    if (dt.status === "destroying") {
      await this.kube.remove(kubeconfig, "Namespace", "", ns);
      await this.db
        .update(deploymentTarget)
        .set({ status: "destroyed", destroyedAt: new Date() })
        .where(eq(deploymentTarget.deploymentTargetId, dt.deploymentTargetId));
      return;
    }

    // 7. Generate resources via generateSandboxResources()
    const resources = generateSandboxResources({
      sandboxId: sbx.sandboxId,
      slug: sbx.slug,
      devcontainerImage: sbx.devcontainerImage,
      devcontainerConfig: sbx.devcontainerConfig as Record<string, unknown>,
      repos: sbx.repos as Array<{ url: string; branch: string; clonePath?: string }>,
      cpu: sbx.cpu,
      memory: sbx.memory,
      storageGb: sbx.storageGb,
      dockerCacheGb: sbx.dockerCacheGb,
      storageClassName: SANDBOX_STORAGE_CLASS,
      envbuilderCacheRepo: ENVBUILDER_CACHE_REPO,
      envbuilderImage: ENVBUILDER_IMAGE,
    });

    // 8. Apply each resource via kube.apply()
    for (const resource of resources) {
      await this.kube.apply(kubeconfig, resource);
    }

    // 9. Read pod IP for direct access
    let ipAddress: string | null = null;
    const podResource = await this.kube.get(kubeconfig, "Pod", ns, podName);
    if (podResource) {
      const podFull = podResource as unknown as Record<string, unknown>;
      const podStatus = podFull.status as Record<string, unknown> | undefined;
      ipAddress = (podStatus?.podIP as string) ?? null;
    }

    // 10. Read back Service NodePort → update sandbox.sshHost, sshPort
    const svcResource = await this.kube.get(kubeconfig, "Service", ns, serviceName);
    let sshPort: number | null = null;
    let sshHost: string | null = null;
    const clusterEndpoint = cl.endpoint ?? "localhost";
    if (svcResource?.spec) {
      const ports = (svcResource.spec as Record<string, unknown>).ports as
        | Array<{ name: string; nodePort?: number }>
        | undefined;
      const sshPortSpec = ports?.find((p) => p.name === "ssh");
      if (sshPortSpec?.nodePort) {
        sshPort = sshPortSpec.nodePort;
        sshHost = clusterEndpoint;
      }
    }

    // 11. Read web-terminal and web-ide NodePorts for gateway routes
    let webPort: number | null = null;
    let webIdePort: number | null = null;
    if (svcResource?.spec) {
      const ports = (svcResource.spec as Record<string, unknown>).ports as
        | Array<{ name: string; nodePort?: number }>
        | undefined;
      const webPortSpec = ports?.find((p) => p.name === "web-terminal");
      if (webPortSpec?.nodePort) {
        webPort = webPortSpec.nodePort;
      }
      const idePortSpec = ports?.find((p) => p.name === "web-ide");
      if (idePortSpec?.nodePort) {
        webIdePort = idePortSpec.nodePort;
      }
    }

    // 12. Create bare domain route (landing page / primary service)
    // SANDBOX_PRIMARY_ENDPOINT controls which service the base domain serves: "ide" (default) or "terminal"
    const primaryEndpoint = (process.env.SANDBOX_PRIMARY_ENDPOINT || "ide").toLowerCase();
    const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev";
    const sandboxDomain = `${sbx.slug}.sandbox.${gatewayDomain}`;
    const primaryPort = primaryEndpoint === "terminal" ? (webPort ?? 8080) : (webIdePort ?? 8081);
    const existingRoute = await lookupRouteByDomain(this.db, sandboxDomain);
    if (!existingRoute) {
      await createRoute(this.db, {
        kind: "sandbox",
        domain: sandboxDomain,
        targetService: clusterEndpoint,
        targetPort: primaryPort,
        deploymentTargetId: dt.deploymentTargetId,
        status: "active",
        createdBy: "reconciler",
      });
      logger.info({ domain: sandboxDomain, endpoint: primaryEndpoint }, "Created bare domain route for sandbox");
    }

    // 13. Create named endpoint routes from devcontainer config
    const dxConfig = (sbx.devcontainerConfig as Record<string, unknown>)?.customizations as Record<string, unknown> | undefined;
    const dxEndpoints = (dxConfig?.dx as Record<string, unknown>)?.endpoints as Record<string, { port: number }> | undefined;
    // Always ensure terminal and IDE endpoints exist
    const endpoints: Record<string, { port: number }> = {
      terminal: { port: 8080 },
      ide: { port: 8081 },
      ...dxEndpoints,
    };

    for (const [name, config] of Object.entries(endpoints)) {
      const endpointDomain = `${sbx.slug}--${name}.sandbox.${gatewayDomain}`;
      const existingEndpointRoute = await lookupRouteByDomain(this.db, endpointDomain);
      if (!existingEndpointRoute) {
        await createRoute(this.db, {
          kind: "sandbox",
          domain: endpointDomain,
          targetService: clusterEndpoint,
          targetPort: name === "terminal" ? (webPort ?? 8080) : name === "ide" ? (webIdePort ?? 8081) : config.port,
          deploymentTargetId: dt.deploymentTargetId,
          status: "active",
          createdBy: "reconciler",
        });
        logger.info({ domain: endpointDomain, port: config.port }, "Created named endpoint route");
      }
    }

    const protocol = gatewayDomain === "localhost" ? "http" : "https";
    const webTerminalUrl = `${protocol}://${sandboxDomain}`;
    const webIdeUrl = `${protocol}://${sbx.slug}--ide.sandbox.${gatewayDomain}`;

    // 14. Update sandbox record
    await this.db
      .update(sandbox)
      .set({
        podName,
        ipAddress,
        sshHost,
        sshPort,
        webTerminalUrl,
        webIdeUrl,
        setupProgress: { applied: true, resourceCount: resources.length },
        updatedAt: new Date(),
      })
      .where(eq(sandbox.sandboxId, sandboxId));

    // 12. Mark deployment target as active if still provisioning
    if (dt.status === "provisioning") {
      await this.db
        .update(deploymentTarget)
        .set({ status: "active" })
        .where(eq(deploymentTarget.deploymentTargetId, dt.deploymentTargetId));
    }
  }

  /**
   * On-demand health check for a single sandbox.
   * Fetches pod status from k8s and maps to health_status.
   */
  async reconcileSandboxHealth(sandboxId: string): Promise<{
    status: string;
    checkedAt: Date;
    containerStatus?: string;
  }> {
    const { sbx, kubeconfig, ns } = await this.loadSandboxContext(sandboxId);
    const podName = `sandbox-${sbx.slug}`;
    const checkedAt = new Date();

    const pod = await this.kube.get(kubeconfig, "Pod", ns, podName);

    let healthStatus: string;
    let statusMessage: string | undefined;

    if (!pod) {
      healthStatus = "terminated";
    } else {
      const podStatus = (pod as any).status;
      const phase = podStatus?.phase as string | undefined;
      const containerStatuses = (podStatus?.containerStatuses ?? []) as Array<{
        name: string;
        ready: boolean;
        state?: Record<string, unknown>;
        lastState?: Record<string, unknown>;
      }>;

      const workspace = containerStatuses.find((c) => c.name === "workspace");
      const allReady = containerStatuses.every((c) => c.ready);

      if (phase === "Running" && allReady) {
        healthStatus = "ready";
      } else if (phase === "Running" && workspace && !workspace.ready) {
        healthStatus = "building";
      } else if (phase === "Failed" || phase === "Unknown") {
        healthStatus = "unhealthy";
        const waiting = workspace?.state?.waiting as
          | { reason?: string; message?: string }
          | undefined;
        if (waiting) {
          statusMessage = `${waiting.reason}: ${waiting.message ?? ""}`.trim();
        }
        const terminated = workspace?.state?.terminated as
          | { reason?: string; message?: string }
          | undefined;
        if (terminated) {
          statusMessage = `${terminated.reason}: ${terminated.message ?? ""}`.trim();
        }
      } else {
        healthStatus = "building";
      }
    }

    await updateSandboxHealth(this.db, sandboxId, healthStatus, statusMessage);

    return { status: healthStatus, checkedAt, containerStatus: statusMessage };
  }

  // ---------------------------------------------------------------------------
  // Snapshot operations
  // ---------------------------------------------------------------------------

  /**
   * Load sandbox + cluster context needed by snapshot operations.
   * Reuses the same pattern as reconcileSandbox.
   */
  private async loadSandboxContext(sandboxId: string) {
    const sbxRows = await this.db
      .select()
      .from(sandbox)
      .where(eq(sandbox.sandboxId, sandboxId));
    const sbx = sbxRows[0];
    if (!sbx) throw new Error(`Sandbox not found: ${sandboxId}`);

    const dtRows = await this.db
      .select()
      .from(deploymentTarget)
      .where(eq(deploymentTarget.deploymentTargetId, sbx.deploymentTargetId));
    const dt = dtRows[0];
    if (!dt) throw new Error(`Deployment target not found: ${sbx.deploymentTargetId}`);

    const clusterId = dt.clusterId;
    if (!clusterId) throw new Error(`Deployment target ${dt.deploymentTargetId} has no cluster`);

    const clusterRows = await this.db
      .select()
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId));
    const cl = clusterRows[0];
    if (!cl) throw new Error(`Cluster not found: ${clusterId}`);
    if (!cl.kubeconfigRef) throw new Error(`Cluster ${clusterId} has no kubeconfig`);

    return {
      sbx,
      dt,
      cl,
      kubeconfig: cl.kubeconfigRef,
      ns: `sandbox-${sbx.slug}`,
    };
  }

  /**
   * Create VolumeSnapshots for both workspace and docker PVCs.
   * Polls until both snapshots are ready, then updates the DB record.
   */
  async reconcileSnapshotCreate(snapshotId: string): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

    const { sbx, kubeconfig, ns } = await this.loadSandboxContext(snap.sandboxId);

    try {
      // Generate and apply VolumeSnapshot resources
      const snapResources = generateVolumeSnapshots(
        sbx.slug,
        sbx.sandboxId,
        snapshotId,
      );

      for (const resource of snapResources) {
        await this.kube.apply(kubeconfig, resource);
      }

      // Poll until both VolumeSnapshots are ready
      const snapshotNames = [
        `snap-${k8sName(snapshotId)}-workspace`,
        `snap-${k8sName(snapshotId)}-docker`,
      ];

      const ready = await this.waitForSnapshotsReady(kubeconfig, ns, snapshotNames);

      if (ready) {
        await updateSnapshotStatus(this.db, snapshotId, "ready", {
          volumeSnapshotName: `snap-${k8sName(snapshotId)}-workspace`,
        });
        logger.info({ snapshotId, sandboxId: snap.sandboxId }, "Snapshot created successfully");
      } else {
        await updateSnapshotStatus(this.db, snapshotId, "failed");
        logger.error({ snapshotId }, "Snapshot creation timed out or failed");
      }
    } catch (err) {
      await updateSnapshotStatus(this.db, snapshotId, "failed");
      logger.error({ snapshotId, error: String(err), stack: (err as Error)?.stack }, "Snapshot creation failed");
      throw err;
    }
  }

  /**
   * Restore a sandbox from a VolumeSnapshot by:
   * 1. Deleting the pod
   * 2. Deleting both PVCs
   * 3. Recreating PVCs from the snapshot
   * 4. Re-running reconcileSandbox to recreate the pod
   */
  async reconcileSnapshotRestore(sandboxId: string, snapshotId: string): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);
    if (snap.status !== "ready") throw new Error(`Snapshot ${snapshotId} is not ready (status: ${snap.status})`);

    const { sbx, kubeconfig, ns } = await this.loadSandboxContext(sandboxId);

    const podName = `sandbox-${sbx.slug}`;
    const workspacePvcName = `sandbox-${sbx.slug}-workspace`;
    const dockerPvcName = `sandbox-${sbx.slug}-docker`;

    // 1. Delete the pod so PVCs are released
    await this.kube.remove(kubeconfig, "Pod", ns, podName);
    await this.waitForResourceGone(kubeconfig, "Pod", ns, podName);

    // 2. Delete both PVCs
    await this.kube.remove(kubeconfig, "PersistentVolumeClaim", ns, workspacePvcName);
    await this.kube.remove(kubeconfig, "PersistentVolumeClaim", ns, dockerPvcName);
    await this.waitForResourceGone(kubeconfig, "PersistentVolumeClaim", ns, workspacePvcName);
    await this.waitForResourceGone(kubeconfig, "PersistentVolumeClaim", ns, dockerPvcName);

    // 3. Create new PVCs from snapshot data
    const workspacePvc = generatePVCFromSnapshot(
      sbx.slug,
      `snap-${k8sName(snapshotId)}-workspace`,
      "workspace",
      sbx.storageGb,
      sbx.sandboxId,
      SANDBOX_STORAGE_CLASS,
    );
    const dockerPvc = generatePVCFromSnapshot(
      sbx.slug,
      `snap-${k8sName(snapshotId)}-docker`,
      "docker",
      sbx.dockerCacheGb,
      sbx.sandboxId,
      SANDBOX_STORAGE_CLASS,
    );

    await this.kube.apply(kubeconfig, workspacePvc);
    await this.kube.apply(kubeconfig, dockerPvc);

    // 4. Re-reconcile to create pod + service (PVCs already exist with snapshot data)
    await this.reconcileSandbox(sandboxId);

    logger.info({ sandboxId, snapshotId }, "Sandbox restored from snapshot");
  }

  /**
   * Delete VolumeSnapshot resources from k8s for a deleted snapshot.
   */
  async reconcileSnapshotDelete(snapshotId: string): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId);
    if (!snap) return; // Already gone

    try {
      const { sbx, kubeconfig, ns } = await this.loadSandboxContext(snap.sandboxId);

      // Remove both VolumeSnapshot resources
      await this.kube.remove(kubeconfig, "VolumeSnapshot", ns, `snap-${k8sName(snapshotId)}-workspace`);
      await this.kube.remove(kubeconfig, "VolumeSnapshot", ns, `snap-${k8sName(snapshotId)}-docker`);

      logger.info({ snapshotId }, "VolumeSnapshots deleted from k8s");
    } catch (err) {
      // Log but don't throw — the DB is already marked deleted
      logger.error({ snapshotId, error: String(err) }, "Failed to delete VolumeSnapshots from k8s");
    }
  }

  /**
   * Poll VolumeSnapshots until all are readyToUse.
   */
  private async waitForSnapshotsReady(
    kubeconfig: string,
    ns: string,
    names: string[],
    timeoutMs: number = 120_000,
    intervalMs: number = 3_000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let allReady = true;
      for (const name of names) {
        const resource = await this.kube.get(kubeconfig, "VolumeSnapshot", ns, name);
        if (!resource) {
          allReady = false;
          break;
        }
        const status = (resource as unknown as Record<string, unknown>).status as Record<string, unknown> | undefined;
        if (status?.error) return false;
        if (status?.readyToUse !== true) {
          allReady = false;
          break;
        }
      }
      if (allReady) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  /**
   * Poll until a k8s resource no longer exists.
   */
  private async waitForResourceGone(
    kubeconfig: string,
    kind: string,
    ns: string,
    name: string,
    timeoutMs: number = 60_000,
    intervalMs: number = 2_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resource = await this.kube.get(kubeconfig, kind, ns, name);
      if (!resource) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    logger.warn({ kind, ns, name }, "Timed out waiting for resource deletion");
  }

  async reconcileWorkload(workloadId: string): Promise<void> {
    // 1. Load workload
    const wlRows = await this.db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, workloadId));
    const wl = wlRows[0];
    if (!wl) throw new Error(`Workload not found: ${workloadId}`);

    // 2. Load component
    const compRows = await this.db
      .select()
      .from(componentSpec)
      .where(eq(componentSpec.componentId, wl.componentId));
    const comp = compRows[0];
    if (!comp) throw new Error(`Component not found: ${wl.componentId}`);

    // 3. Load deployment target
    const dtRows = await this.db
      .select()
      .from(deploymentTarget)
      .where(eq(deploymentTarget.deploymentTargetId, wl.deploymentTargetId));
    const dt = dtRows[0];
    if (!dt) throw new Error(`Deployment target not found: ${wl.deploymentTargetId}`);

    // 4. Load module name
    const mvRows = await this.db
      .select()
      .from(moduleVersion)
      .where(eq(moduleVersion.moduleVersionId, wl.moduleVersionId));
    const mv = mvRows[0];
    if (!mv) throw new Error(`Module version not found: ${wl.moduleVersionId}`);

    const modRows = await this.db
      .select()
      .from(productModule)
      .where(eq(productModule.moduleId, mv.moduleId));
    const mod = modRows[0];
    const moduleName = mod?.name ?? "unknown";

    // 5. Build reconcile context
    const ctx: ReconcileContext = {
      workload: {
        workloadId: wl.workloadId,
        desiredImage: wl.desiredImage,
        desiredArtifactUri: wl.desiredArtifactUri ?? null,
        replicas: wl.replicas,
        envOverrides: wl.envOverrides as Record<string, unknown>,
        resourceOverrides: wl.resourceOverrides as Record<string, unknown>,
        moduleVersionId: wl.moduleVersionId,
      },
      component: {
        name: comp.name,
        kind: comp.kind,
        ports: (comp.ports ?? []) as Array<{ name: string; port: number; protocol: string }>,
        healthcheck: (comp.healthcheck as { path: string; portName: string; protocol: string } | null) ?? null,
        isPublic: comp.isPublic,
        stateful: comp.stateful,
        defaultCpu: comp.defaultCpu,
        defaultMemory: comp.defaultMemory,
        defaultReplicas: comp.defaultReplicas,
      },
      target: {
        deploymentTargetId: dt.deploymentTargetId,
        name: dt.name,
        kind: dt.kind,
        runtime: dt.runtime,
        clusterId: dt.clusterId,
        hostId: dt.hostId ?? null,
        vmId: dt.vmId ?? null,
        namespace: dt.namespace,
      },
      moduleName,
    };

    // 6. Dispatch to runtime strategy
    const strategy = getRuntimeStrategy(ctx.target.runtime);
    const result = await strategy.reconcile(ctx, this.db);

    // 7. Update workload
    await this.db
      .update(workload)
      .set({
        status: result.status,
        actualImage: result.actualImage ?? null,
        driftDetected: result.driftDetected,
        lastReconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workload.workloadId, workloadId));
  }

  async detectDrift(): Promise<
    Array<{ workloadId: string; desiredImage: string; actualImage: string }>
  > {
    const drifted = await this.db
      .select({
        workloadId: workload.workloadId,
        desiredImage: workload.desiredImage,
        actualImage: workload.actualImage,
      })
      .from(workload)
      .where(eq(workload.driftDetected, true));

    return drifted.map((w) => ({
      workloadId: w.workloadId,
      desiredImage: w.desiredImage,
      actualImage: w.actualImage ?? "",
    }));
  }

  startLoop(intervalMs: number = 30_000): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const result = await this.reconcileAll();
        if (result.reconciled > 0 || result.errors > 0) {
          logger.info(result, "Reconciliation cycle complete");
        }
      } catch (err) {
        logger.error({ error: err }, "Reconciliation cycle failed");
      }
    }, intervalMs);
  }
}
