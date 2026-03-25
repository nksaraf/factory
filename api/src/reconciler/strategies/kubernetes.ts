import type { RuntimeStrategy, ReconcileContext, ReconcileResult } from "../runtime-strategy";
import type { Database } from "../../db/connection";
import { cluster } from "../../db/schema/infra";
import { eq } from "drizzle-orm";
import { generateResources } from "../resource-generator";

export class KubernetesStrategy implements RuntimeStrategy {
  readonly runtime = "kubernetes";

  constructor(private kube: { apply(kubeconfigRef: string, resource: any): Promise<void>; getDeploymentImage(kubeconfigRef: string, ns: string, name: string): Promise<string | null> }) {}

  async reconcile(ctx: ReconcileContext, db: Database): Promise<ReconcileResult> {
    const clusterId = ctx.target.clusterId;
    if (!clusterId) throw new Error(`Kubernetes target ${ctx.target.deploymentTargetId} has no cluster`);

    const clusterRows = await db
      .select()
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId));
    const cl = clusterRows[0];
    if (!cl) throw new Error(`Cluster not found: ${clusterId}`);
    if (!cl.kubeconfigRef) throw new Error(`Cluster ${clusterId} has no kubeconfig`);

    // Generate and apply resources
    // Note: `as any` casts are needed here because ReconcileContext uses narrower
    // inline types while generateResources expects the full shared types.
    const resources = generateResources(
      ctx.workload as any,
      ctx.component as any,
      ctx.target as any,
      ctx.moduleName,
    );

    for (const resource of resources) {
      await this.kube.apply(cl.kubeconfigRef, resource);
    }

    // Check drift for long-running components
    const ns = ctx.target.namespace ?? ctx.target.name;
    let actualImage: string | null = null;
    let driftDetected = false;

    if (ctx.component.kind === "server" || ctx.component.kind === "worker" || ctx.component.kind === "database" || ctx.component.kind === "gateway") {
      actualImage = await this.kube.getDeploymentImage(
        cl.kubeconfigRef,
        ns,
        ctx.component.name,
      );
      driftDetected = actualImage !== null && actualImage !== ctx.workload.desiredImage;
    }

    const status = ctx.component.kind === "task" ? "completed" : "running";
    return { status, actualImage, driftDetected };
  }
}
