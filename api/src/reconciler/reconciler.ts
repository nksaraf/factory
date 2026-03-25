import { and, eq, notInArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { KubeClient } from "../lib/kube-client";
import { generateSandboxResources } from "./sandbox-resource-generator";
import { getRuntimeStrategy, registerRuntimeStrategy, type ReconcileContext } from "./runtime-strategy";
import { KubernetesStrategy } from "./strategies/kubernetes";
import { ComposeStrategy } from "./strategies/compose";
import { SystemdStrategy } from "./strategies/systemd";
import { WindowsServiceStrategy, IisStrategy } from "./strategies/windows";
import { NoopStrategy } from "./strategies/noop";
import { workload, sandbox, deploymentTarget } from "../db/schema/fleet";
import { cluster } from "../db/schema/infra";
import { componentSpec, productModule } from "../db/schema/product";
import { moduleVersion } from "../db/schema/build";
import { expireStale } from "../services/sandbox/sandbox.service";
import { logger } from "../logger";

export class Reconciler {
  constructor(
    private db: Database,
    private kube: KubeClient,
  ) {
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
    });

    // 8. Apply each resource via kube.apply()
    for (const resource of resources) {
      await this.kube.apply(kubeconfig, resource);
    }

    // 9. Read back Service NodePort → update sandbox.sshHost, sshPort
    const svcResource = await this.kube.get(kubeconfig, "Service", ns, serviceName);
    let sshPort: number | null = null;
    let sshHost: string | null = null;
    if (svcResource?.spec) {
      const ports = (svcResource.spec as any).ports as
        | Array<{ name: string; nodePort?: number }>
        | undefined;
      const sshPortSpec = ports?.find((p) => p.name === "ssh");
      if (sshPortSpec?.nodePort) {
        sshPort = sshPortSpec.nodePort;
        // Use cluster endpoint as ssh host
        sshHost = (cl as any).endpoint ?? null;
      }
    }

    // 10. Compute webTerminalUrl from IngressRoute
    const webTerminalUrl = `https://${sbx.slug}.sandbox.dx.dev`;

    // 11. Update sandbox.podName, setupProgress, sshHost, sshPort, webTerminalUrl
    await this.db
      .update(sandbox)
      .set({
        podName,
        sshHost,
        sshPort,
        webTerminalUrl,
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
        healthcheck: comp.healthcheck as any ?? null,
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
