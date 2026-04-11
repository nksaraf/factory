import type {
  ComponentSpec,
  DeploymentTarget,
  Workload,
} from "@smp/factory-shared/types"
import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { realm } from "../../db/schema/infra-v2"
import { generateResources } from "../resource-generator"
import type {
  RealmStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

export class KubernetesStrategy implements RealmStrategy {
  readonly runtime = "kubernetes"

  constructor(
    private kube: {
      apply(kubeconfigRef: string, resource: any): Promise<void>
      getDeploymentImage(
        kubeconfigRef: string,
        ns: string,
        name: string
      ): Promise<string | null>
    }
  ) {}

  async reconcile(
    ctx: ReconcileContext,
    db: Database
  ): Promise<ReconcileResult> {
    const realmId = ctx.target.clusterId // v2: clusterId maps to realmId
    if (!realmId)
      throw new Error(
        `Kubernetes target ${ctx.target.deploymentTargetId} has no realm`
      )

    const [rt] = await db
      .select()
      .from(realm)
      .where(eq(realm.id, realmId))
      .limit(1)
    if (!rt) throw new Error(`Realm not found: ${realmId}`)
    const rtSpec = (rt.spec ?? {}) as Record<string, any>
    const kubeconfigRef = rtSpec.kubeconfigRef
    if (!kubeconfigRef) throw new Error(`Realm ${realmId} has no kubeconfig`)

    // ReconcileContext uses narrower inline types; cast to the full shared types
    const resources = generateResources(
      ctx.workload as unknown as Workload,
      ctx.component as unknown as ComponentSpec,
      ctx.target as unknown as DeploymentTarget,
      ctx.moduleName
    )

    for (const resource of resources) {
      await this.kube.apply(kubeconfigRef, resource)
    }

    // Check drift for long-running components
    const ns = ctx.target.namespace ?? ctx.target.name
    let actualImage: string | null = null
    let driftDetected = false

    if (
      ctx.component.kind === "service" ||
      ctx.component.kind === "server" ||
      ctx.component.kind === "worker" ||
      ctx.component.kind === "database" ||
      ctx.component.kind === "gateway" ||
      ctx.component.kind === "agent" ||
      ctx.component.kind === "cache" ||
      ctx.component.kind === "queue" ||
      ctx.component.kind === "storage" ||
      ctx.component.kind === "search"
    ) {
      actualImage = await this.kube.getDeploymentImage(
        kubeconfigRef,
        ns,
        ctx.component.name
      )
      driftDetected =
        actualImage !== null && actualImage !== ctx.workload.desiredImage
    }

    const status = ctx.component.kind === "task" ? "completed" : "running"
    return { status, actualImage, driftDetected }
  }
}
