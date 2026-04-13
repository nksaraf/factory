import type { RealmSpec } from "@smp/factory-shared/schemas/infra"
import type {
  ComponentDeploymentSpec,
  SystemDeploymentSpec,
  WorkbenchSnapshotSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import { and, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm"

import type { GitHostAdapter } from "../adapters/git-host-adapter"
import type { Database } from "../db/connection"
import { realm, route as infraRoute } from "../db/schema/infra"
import {
  componentDeployment,
  preview,
  systemDeployment,
  workbench,
  workbenchSnapshot,
} from "../db/schema/ops"
import { component, release, system } from "../db/schema/software"
import type { KubeClient, KubeResource } from "../lib/kube-client"
import { emitEvent } from "../lib/events"
import { logger } from "../logger"
import {
  createRoute,
  lookupRouteByDomain,
  updateRoute,
} from "../modules/infra/gateway.service"
import {
  drizzleDbReader,
  resolveRouteTargets,
} from "../modules/infra/route-resolver"
import {
  getSnapshot,
  updateSnapshotStatus,
} from "../modules/ops/snapshot.service"
import {
  expireStale,
  updateWorkbenchHealth,
} from "../modules/ops/workbench.service"
import { PreviewReconciler } from "./preview-reconciler"
import {
  type ReconcileContext,
  getReconcilerStrategy,
  registerReconcilerStrategy,
} from "./runtime-strategy"
import {
  generatePVCFromSnapshot,
  generateVolumeSnapshots,
  generateWorkbenchResources,
} from "./sandbox-resource-generator"
import { ComposeStrategy } from "./strategies/compose"
import { KubernetesStrategy } from "./strategies/kubernetes"
import { NoopStrategy } from "./strategies/noop"
import { SystemdStrategy } from "./strategies/systemd"
import { IisStrategy, WindowsServiceStrategy } from "./strategies/windows"

// Default storage class for PVC provisioning.
// Set via SANDBOX_STORAGE_CLASS env var. Falls back to "local-path" which is
// the default provisioner in k3d/k3s clusters.
const SANDBOX_STORAGE_CLASS = process.env.SANDBOX_STORAGE_CLASS || "local-path"

// Envbuilder image cache registry (optional — disables caching if not set).
const ENVBUILDER_CACHE_REPO = process.env.ENVBUILDER_CACHE_REPO || undefined
const ENVBUILDER_IMAGE = process.env.ENVBUILDER_IMAGE || undefined

// Which service the bare workbench domain serves: "ide" (8081) or "terminal" (8080).
const WORKBENCH_PRIMARY_ENDPOINT =
  process.env.WORKBENCH_PRIMARY_ENDPOINT ?? "ide"

/**
 * Extract the server host from inline kubeconfig YAML.
 * Parses the `server:` field (e.g. "https://192.168.2.88:6443") and returns the hostname.
 */
function endpointFromKubeconfig(kubeconfig: string): string | null {
  const match = kubeconfig.match(/server:\s*https?:\/\/([^:/\s]+)/)
  if (!match) return null
  const host = match[1]
  // Don't return loopback — that's what we're trying to avoid
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0")
    return null
  return host
}

/** Sanitize an ID for use in k8s resource names (RFC 1123). */
function k8sName(id: string): string {
  return id.replace(/_/g, "-").toLowerCase()
}

export class Reconciler {
  private previewReconciler: PreviewReconciler

  constructor(
    private db: Database,
    private kube: KubeClient,
    gitHost?: GitHostAdapter
  ) {
    this.previewReconciler = new PreviewReconciler(db, kube, gitHost)
    registerReconcilerStrategy("kubernetes", () => new KubernetesStrategy(kube))
    registerReconcilerStrategy("docker-compose", () => new ComposeStrategy())
    registerReconcilerStrategy("systemd", () => new SystemdStrategy())
    registerReconcilerStrategy(
      "windows_service",
      () => new WindowsServiceStrategy()
    )
    registerReconcilerStrategy("iis", () => new IisStrategy())
    registerReconcilerStrategy("process", () => new NoopStrategy())
  }

  async reconcileAll(): Promise<{ reconciled: number; errors: number }> {
    // --- Component deployment (workload) reconciliation ---
    const allDeployments = await this.db.select().from(componentDeployment)
    const activeDeployments = allDeployments.filter((cd) => {
      const status = cd.spec?.status
      return status !== "completed" && status !== "stopped"
    })

    let reconciled = 0
    let errors = 0

    for (const cd of activeDeployments) {
      try {
        await this.reconcileWorkload(cd.id)
        reconciled++
      } catch (err) {
        errors++
        logger.error(
          { componentDeploymentId: cd.id, err },
          "Failed to reconcile component deployment"
        )
      }
    }

    // --- Workbench reconciliation ---
    // Only reconcile current (non-deleted) workbench records — systemTo IS NULL
    // excludes bitemporal tombstones from soft-deletes.
    const allWorkbenches = await this.db
      .select()
      .from(workbench)
      .where(and(isNull(workbench.systemTo), isNull(workbench.validTo)))
    const activeWorkbenches = allWorkbenches.filter((w) => {
      return (
        w.spec?.realmType === "container" && w.spec?.lifecycle !== "destroyed"
      )
    })
    logger.debug(
      { total: allWorkbenches.length, active: activeWorkbenches.length },
      "Workbench reconciliation candidates"
    )

    for (const wks of activeWorkbenches) {
      try {
        await this.reconcileWorkbench(wks.id)
        reconciled++
      } catch (err) {
        errors++
        logger.error(
          { workbenchId: wks.id, err },
          "Failed to reconcile workbench"
        )
      }
    }

    // --- Preview reconciliation ---
    const activePreviews = await this.db
      .select({ previewId: preview.id })
      .from(preview)
      .where(
        notInArray(preview.phase, ["active", "inactive", "expired", "failed"])
      )

    for (const prev of activePreviews) {
      try {
        await this.previewReconciler.reconcilePreview(prev.previewId)
        reconciled++
      } catch (err) {
        errors++
        logger.error(
          { previewId: prev.previewId, err },
          "Failed to reconcile preview"
        )
      }
    }

    // --- Expired preview K8s cleanup ---
    const expiredPreviews = await this.db
      .select({
        previewId: preview.id,
        slug: preview.slug,
        systemDeploymentId: preview.systemDeploymentId,
      })
      .from(preview)
      .where(eq(preview.phase, "expired"))
      .limit(10)

    for (const ep of expiredPreviews) {
      try {
        if (!ep.systemDeploymentId) continue
        const [sd] = await this.db
          .select()
          .from(systemDeployment)
          .where(eq(systemDeployment.id, ep.systemDeploymentId))
          .limit(1)
        if (!sd || !sd.realmId) continue
        const sdSpec = sd.spec
        if (sdSpec.status === "destroyed") continue

        const [rt] = await this.db
          .select()
          .from(realm)
          .where(eq(realm.id, sd.realmId))
          .limit(1)
        const rtSpec = rt?.spec
        if (!rtSpec?.kubeconfigRef) continue

        const ns = `preview-${ep.slug ?? ep.previewId}`
        await this.kube.remove(rtSpec.kubeconfigRef, "Namespace", "", ns)
        await this.db
          .update(systemDeployment)
          .set({
            spec: { ...sd.spec, status: "destroyed" as const },
            updatedAt: new Date(),
          })
          .where(eq(systemDeployment.id, sd.id))
        logger.info(
          { previewId: ep.previewId, ns },
          "Cleaned up expired preview K8s resources"
        )
      } catch (err) {
        logger.error(
          { previewId: ep.previewId, err },
          "Failed to cleanup expired preview"
        )
      }
    }

    // --- Route resolution reconciliation ---
    const routeResult = await this.reconcileRoutes()
    reconciled += routeResult.resolved
    errors += routeResult.errors

    // Expire stale sandboxes past their TTL
    await expireStale(this.db)

    return { reconciled, errors }
  }

  async reconcileWorkbench(workbenchId: string): Promise<void> {
    // 1. Load workbench
    const [wks] = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.id, workbenchId))
    if (!wks) throw new Error(`Workbench not found: ${workbenchId}`)
    const wksSpec: WorkbenchSpec = wks.spec ?? ({} as WorkbenchSpec)

    // 2. Skip if realmType !== 'container' (VM workbenches managed directly)
    if (wksSpec.realmType !== "container") return

    // 3. Load realm directly from workbench.realmId
    const realmId = wks.realmId
    if (!realmId) throw new Error(`Workbench ${workbenchId} has no realm`)

    const [rt] = await this.db.select().from(realm).where(eq(realm.id, realmId))
    if (!rt) throw new Error(`Realm not found: ${realmId}`)
    const rtSpec: RealmSpec = rt.spec ?? ({} as RealmSpec)
    if (!rtSpec.kubeconfigRef)
      throw new Error(`Realm ${realmId} has no kubeconfig`)

    const kubeconfig = rtSpec.kubeconfigRef
    const ns = `workbench-${wks.slug}`
    const podName = `workbench-${wks.slug}`
    const serviceName = `workbench-${wks.slug}`

    // 4. Check lifecycle state
    if (wksSpec.lifecycle === "suspended") {
      await this.kube.remove(kubeconfig, "Pod", ns, podName)
      return
    }

    if (wksSpec.lifecycle === "destroying") {
      // Delete pod and PVCs first to avoid namespace stuck in Terminating
      await this.kube.remove(kubeconfig, "Pod", ns, podName).catch(() => {})
      await this.kube
        .remove(kubeconfig, "PersistentVolumeClaim", ns, `${podName}-data`)
        .catch(() => {})
      await this.kube
        .remove(kubeconfig, "PersistentVolumeClaim", ns, `${podName}-docker`)
        .catch(() => {})
      await this.kube.remove(kubeconfig, "Namespace", "", ns)
      await this.db
        .update(workbench)
        .set({
          spec: { ...wksSpec, lifecycle: "destroyed" },
          updatedAt: new Date(),
        })
        .where(eq(workbench.id, workbenchId))
      return
    }

    // 4b. Clean stale k8s resources — if a pod exists with a different workbench ID,
    // it means PGlite was wiped but k8s resources remain from a previous workbench
    // with the same slug. Delete the namespace so the reconciler can re-provision cleanly.
    try {
      const existingPod = await this.kube.get(kubeconfig, "Pod", ns, podName)
      if (existingPod) {
        const podMeta = (existingPod as any).metadata
        const podLabels = podMeta?.labels ?? {}
        const podEnv = ((existingPod as any).spec?.containers?.[0]?.env ??
          []) as Array<{ name: string; value: string }>
        const podWorkbenchId =
          podLabels["dx.dev/workbench"] ??
          podLabels["dx.dev/workbench-id"] ??
          podEnv.find((e) => e.name === "DX_WORKBENCH_ID")?.value ??
          podEnv.find((e) => e.name === "WORKBENCH_ID")?.value
        if (podWorkbenchId && podWorkbenchId !== wks.id) {
          logger.info(
            {
              ns,
              staleWorkbenchId: podWorkbenchId,
              currentWorkbenchId: wks.id,
            },
            "Stale k8s resources detected — namespace belongs to a different workbench ID. Cleaning up."
          )
          // Delete pod and PVCs first so namespace deletion isn't blocked by
          // kubernetes.io/pvc-protection finalizers on in-use volumes.
          await this.kube.remove(kubeconfig, "Pod", ns, podName).catch(() => {})
          await this.kube
            .remove(kubeconfig, "PersistentVolumeClaim", ns, `${podName}-data`)
            .catch(() => {})
          await this.kube
            .remove(
              kubeconfig,
              "PersistentVolumeClaim",
              ns,
              `${podName}-docker`
            )
            .catch(() => {})
          await this.kube.remove(kubeconfig, "Namespace", "", ns)
          // Return early — let the next reconcile cycle provision into a clean namespace.
          logger.info(
            { ns },
            "Stale namespace cleaned up. Will re-provision on next reconcile cycle."
          )
          return
        }
      }
    } catch (err) {
      // Non-fatal — if we can't check, just proceed with apply (it may succeed)
      logger.debug(
        { ns, err },
        "Could not check for stale resources, proceeding"
      )
    }

    // 4c. If namespace exists but is Terminating, skip this cycle
    try {
      const nsResource = await this.kube.get(kubeconfig, "Namespace", "", ns)
      if (nsResource) {
        const nsPhase = (nsResource as any).status?.phase
        if (nsPhase === "Terminating") {
          logger.debug(
            { ns },
            "Namespace is Terminating — skipping reconcile cycle"
          )
          return
        }
      }
    } catch {
      // Non-fatal
    }

    // 5. Generate resources via generateWorkbenchResources()
    // TODO: fix type — devcontainerImage is not yet in WorkbenchSpec; add it when schema is updated
    const wksSpecExtra = wksSpec as WorkbenchSpec & {
      devcontainerImage?: string
    }
    const resources = generateWorkbenchResources({
      workbenchId: wks.id,
      slug: wks.slug,
      devcontainerImage: wksSpecExtra.devcontainerImage ?? null,
      devcontainerConfig: wksSpec.devcontainerConfig ?? {},
      repos: (wksSpec.repos ?? []).map((r) => ({
        ...r,
        branch: r.branch ?? "main",
      })),
      cpu: wksSpec.cpu ?? null,
      memory: wksSpec.memory ?? null,
      storageGb: wksSpec.storageGb ?? 10,
      dockerCacheGb: wksSpec.dockerCacheGb ?? 20,
      storageClassName: SANDBOX_STORAGE_CLASS,
      envbuilderCacheRepo: ENVBUILDER_CACHE_REPO,
      envbuilderImage: ENVBUILDER_IMAGE,
    })

    // 6. Apply each resource via kube.apply()
    for (const resource of resources) {
      await this.kube.apply(kubeconfig, resource)
    }

    // 7. Read pod IP for direct access
    let ipAddress: string | null = null
    const podResource = await this.kube.get(kubeconfig, "Pod", ns, podName)
    if (podResource) {
      const podFull = podResource as unknown as Record<string, unknown>
      const podStatus = podFull.status as Record<string, unknown> | undefined
      ipAddress = (podStatus?.podIP as string) ?? null
    }

    // 8. Read back Service NodePort
    const svcResource = await this.kube.get(
      kubeconfig,
      "Service",
      ns,
      serviceName
    )
    let sshPort: number | null = null
    let sshHost: string | null = null
    const runtimeEndpoint =
      rtSpec.endpoint ?? endpointFromKubeconfig(kubeconfig) ?? "localhost"
    if (svcResource?.spec) {
      const ports = (svcResource.spec as Record<string, unknown>).ports as
        | Array<{ name: string; nodePort?: number }>
        | undefined
      const sshPortSpec = ports?.find((p) => p.name === "ssh")
      if (sshPortSpec?.nodePort) {
        sshPort = sshPortSpec.nodePort
        sshHost = runtimeEndpoint
      }
    }

    // 9. Read web-terminal and web-ide NodePorts
    let webPort: number | null = null
    let webIdePort: number | null = null
    if (svcResource?.spec) {
      const ports = (svcResource.spec as Record<string, unknown>).ports as
        | Array<{ name: string; nodePort?: number }>
        | undefined
      const webPortSpec = ports?.find((p) => p.name === "web-terminal")
      if (webPortSpec?.nodePort) webPort = webPortSpec.nodePort
      const idePortSpec = ports?.find((p) => p.name === "web-ide")
      if (idePortSpec?.nodePort) webIdePort = idePortSpec.nodePort
    }

    // 10. Create bare domain route (primary endpoint: ide or terminal)
    const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "lepton.software"
    const workbenchDomain = `${wks.slug}.dev.${gatewayDomain}`
    const primaryPort =
      WORKBENCH_PRIMARY_ENDPOINT === "terminal"
        ? (webPort ?? 8080)
        : (webIdePort ?? 8081)
    const existingRoute = await lookupRouteByDomain(this.db, workbenchDomain)
    if (!existingRoute) {
      await createRoute(this.db, {
        type: "dev",
        domain: workbenchDomain,
        targetService: runtimeEndpoint,
        targetPort: primaryPort,
        status: "active",
        createdBy: "reconciler",
      })
      logger.info(
        { domain: workbenchDomain },
        "Created bare domain route for workbench"
      )
    } else if (
      existingRoute.targetPort !== primaryPort ||
      existingRoute.targetService !== runtimeEndpoint
    ) {
      await updateRoute(this.db, existingRoute.routeId, {
        targetPort: primaryPort,
        targetService: runtimeEndpoint,
      })
      logger.info(
        { domain: workbenchDomain, targetPort: primaryPort },
        "Updated bare domain route for workbench"
      )
    }

    // 11. Create named endpoint routes from devcontainer config
    const dxConfig = (wksSpec.devcontainerConfig as Record<string, unknown>)
      ?.customizations as Record<string, unknown> | undefined
    const dxEndpoints = (dxConfig?.dx as Record<string, unknown>)?.endpoints as
      | Record<string, { port: number }>
      | undefined
    const endpoints: Record<string, { port: number }> = {
      terminal: { port: 8080 },
      ide: { port: 8081 },
      ...dxEndpoints,
    }

    for (const [name, config] of Object.entries(endpoints)) {
      const endpointDomain = `${wks.slug}--${name}.dev.${gatewayDomain}`
      const targetPort =
        name === "terminal"
          ? (webPort ?? 8080)
          : name === "ide"
            ? (webIdePort ?? 8081)
            : config.port
      const existingEndpointRoute = await lookupRouteByDomain(
        this.db,
        endpointDomain
      )
      if (!existingEndpointRoute) {
        await createRoute(this.db, {
          type: "dev",
          domain: endpointDomain,
          targetService: runtimeEndpoint,
          targetPort,
          status: "active",
          createdBy: "reconciler",
        })
        logger.info(
          { domain: endpointDomain, port: targetPort },
          "Created named endpoint route"
        )
      } else if (
        existingEndpointRoute.targetPort !== targetPort ||
        existingEndpointRoute.targetService !== runtimeEndpoint
      ) {
        await updateRoute(this.db, existingEndpointRoute.routeId, {
          targetPort,
          targetService: runtimeEndpoint,
        })
        logger.info(
          { domain: endpointDomain, port: targetPort },
          "Updated named endpoint route"
        )
      }
    }

    const protocol = gatewayDomain === "localhost" ? "http" : "https"
    const webTerminalUrl = `${protocol}://${workbenchDomain}`
    const webIdeUrl = `${protocol}://${wks.slug}--ide.dev.${gatewayDomain}`

    // 12. Check pod readiness (single check per reconcile cycle — no blocking poll).
    //     If not ready yet, lifecycle stays "provisioning" and the next reconcile
    //     cycle (typically 15-30s) will re-check.
    let newLifecycle = wksSpec.lifecycle
    if (wksSpec.lifecycle === "provisioning") {
      const podCheck = await this.kube.get(kubeconfig, "Pod", ns, podName)
      if (podCheck) {
        const podStatus = (
          podCheck as KubeResource & { status?: Record<string, unknown> }
        ).status
        const phase = podStatus?.phase as string | undefined
        const containerStatuses = (podStatus?.containerStatuses ??
          []) as Array<{
          name: string
          ready: boolean
          state?: Record<string, unknown>
        }>

        if (
          phase === "Running" &&
          containerStatuses.length > 0 &&
          containerStatuses.every((c) => c.ready)
        ) {
          newLifecycle = "active"
          ipAddress = (podStatus?.podIP as string) ?? ipAddress
        } else if (phase === "Failed" || phase === "Unknown") {
          logger.warn(
            { workbenchId, phase },
            "Pod entered terminal state during provisioning"
          )
        } else {
          // Detect stuck container states that won't self-resolve
          const terminalReasons = new Set([
            "ImagePullBackOff",
            "ErrImagePull",
            "InvalidImageName",
            "CrashLoopBackOff",
          ])
          const stuckReason = containerStatuses
            .map(
              (c) =>
                (c.state?.waiting as Record<string, unknown> | undefined)
                  ?.reason as string | undefined
            )
            .find((r) => r && terminalReasons.has(r))
          if (stuckReason) {
            logger.warn(
              { workbenchId, podName, reason: stuckReason },
              "Pod has container in terminal waiting state"
            )
          }
        }
      }
    }

    // 13. Update workbench spec with runtime info
    await this.db
      .update(workbench)
      .set({
        spec: {
          ...wksSpec,
          podName,
          ...(ipAddress !== null ? { ipAddress } : {}),
          ...(sshHost !== null ? { sshHost } : {}),
          ...(sshPort !== null ? { sshPort } : {}),
          webTerminalUrl,
          webIdeUrl,
          setupProgress: { applied: true, resourceCount: resources.length },
          lifecycle: newLifecycle,
        },
        updatedAt: new Date(),
      })
      .where(eq(workbench.id, workbenchId))

    // Emit workflow event when workbench becomes active
    if (newLifecycle === "active" && wksSpec.lifecycle !== "active") {
      await emitEvent(this.db, {
        topic: "ops.workbench.ready",
        source: "reconciler",
        severity: "info",
        schemaVersion: 1,
        entityKind: "workbench",
        entityId: workbenchId,
        data: { workbenchId, status: "active" },
      }).catch((err) => {
        logger.warn(
          { workbenchId, err },
          "Failed to emit workbench.ready event"
        )
      })
    }
  }

  /**
   * On-demand health check for a single sandbox.
   * Fetches pod status from k8s and maps to health_status.
   */
  async reconcileWorkbenchHealth(workbenchId: string): Promise<{
    status: string
    checkedAt: Date
    containerStatus?: string
  }> {
    const { wks, kubeconfig, ns } = await this.loadWorkbenchContext(workbenchId)
    const podName = `workbench-${wks.slug}`
    const checkedAt = new Date()

    const pod = await this.kube.get(kubeconfig, "Pod", ns, podName)

    let healthStatus: string
    let statusMessage: string | undefined

    if (!pod) {
      healthStatus = "terminated"
    } else {
      const podWithStatus = pod as typeof pod & {
        status?: Record<string, unknown>
      }
      const podStatus = podWithStatus.status
      const phase = podStatus?.phase as string | undefined
      const containerStatuses = (podStatus?.containerStatuses ?? []) as Array<{
        name: string
        ready: boolean
        state?: Record<string, unknown>
        lastState?: Record<string, unknown>
      }>

      const wb = containerStatuses.find((c) => c.name === "workbench")
      const allReady = containerStatuses.every((c) => c.ready)

      if (phase === "Running" && allReady) {
        healthStatus = "ready"
      } else if (phase === "Running" && wb && !wb.ready) {
        healthStatus = "building"
      } else if (phase === "Failed" || phase === "Unknown") {
        healthStatus = "unhealthy"
        const waiting = wb?.state?.waiting as
          | { reason?: string; message?: string }
          | undefined
        if (waiting) {
          statusMessage = `${waiting.reason}: ${waiting.message ?? ""}`.trim()
        }
        const terminated = wb?.state?.terminated as
          | { reason?: string; message?: string }
          | undefined
        if (terminated) {
          statusMessage =
            `${terminated.reason}: ${terminated.message ?? ""}`.trim()
        }
      } else {
        healthStatus = "building"
      }
    }

    await updateWorkbenchHealth(
      this.db,
      workbenchId,
      healthStatus,
      statusMessage
    )

    return { status: healthStatus, checkedAt, containerStatus: statusMessage }
  }

  // ---------------------------------------------------------------------------
  // Snapshot operations
  // ---------------------------------------------------------------------------

  /**
   * Load sandbox + cluster context needed by snapshot operations.
   * Reuses the same pattern as reconcileSandbox.
   */
  private async loadWorkbenchContext(workbenchId: string) {
    const [wks] = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.id, workbenchId))
    if (!wks) throw new Error(`Workbench not found: ${workbenchId}`)

    const realmId = wks.realmId
    if (!realmId) throw new Error(`Workbench ${workbenchId} has no realm`)

    const [rt] = await this.db.select().from(realm).where(eq(realm.id, realmId))
    if (!rt) throw new Error(`Realm not found: ${realmId}`)
    const rtSpec: RealmSpec = rt.spec ?? ({} as RealmSpec)
    if (!rtSpec.kubeconfigRef)
      throw new Error(`Realm ${realmId} has no kubeconfig`)

    return {
      wks,
      rt,
      kubeconfig: rtSpec.kubeconfigRef,
      ns: `workbench-${wks.slug}`,
    }
  }

  /**
   * Create VolumeSnapshots for both workbench and docker PVCs.
   * Polls until both snapshots are ready, then updates the DB record.
   */
  async reconcileSnapshotCreate(snapshotId: string): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId)
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`)

    const { wks, kubeconfig, ns } = await this.loadWorkbenchContext(
      snap.workbenchId
    )

    try {
      // Generate and apply VolumeSnapshot resources
      const snapResources = generateVolumeSnapshots(
        wks.slug,
        wks.id,
        snapshotId
      )

      for (const resource of snapResources) {
        await this.kube.apply(kubeconfig, resource)
      }

      // Poll until both VolumeSnapshots are ready
      const snapshotNames = [
        `snap-${k8sName(snapshotId)}-workbench`,
        `snap-${k8sName(snapshotId)}-docker`,
      ]

      const ready = await this.waitForSnapshotsReady(
        kubeconfig,
        ns,
        snapshotNames
      )

      if (ready) {
        await updateSnapshotStatus(this.db, snapshotId, "ready", {
          volumeSnapshotName: `snap-${k8sName(snapshotId)}-workbench`,
        })
        logger.info(
          { snapshotId, sandboxId: snap.workbenchId },
          "Snapshot created successfully"
        )
      } else {
        await updateSnapshotStatus(this.db, snapshotId, "failed")
        logger.error({ snapshotId }, "Snapshot creation timed out or failed")
      }
    } catch (err) {
      await updateSnapshotStatus(this.db, snapshotId, "failed")
      logger.error(
        { snapshotId, error: String(err), stack: (err as Error)?.stack },
        "Snapshot creation failed"
      )
      throw err
    }
  }

  /**
   * Restore a sandbox from a VolumeSnapshot by:
   * 1. Deleting the pod
   * 2. Deleting both PVCs
   * 3. Recreating PVCs from the snapshot
   * 4. Re-running reconcileSandbox to recreate the pod
   */
  async reconcileSnapshotRestore(
    sandboxId: string,
    snapshotId: string
  ): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId)
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`)
    const snapSpec: WorkbenchSnapshotSpec =
      snap.spec ?? ({} as WorkbenchSnapshotSpec)
    if (snapSpec.status !== "ready")
      throw new Error(
        `Snapshot ${snapshotId} is not ready (status: ${snapSpec.status})`
      )

    const { wks, kubeconfig, ns } = await this.loadWorkbenchContext(sandboxId)
    const wksSpec: WorkbenchSpec = wks.spec ?? ({} as WorkbenchSpec)

    const podName = `workbench-${wks.slug}`
    const workbenchPvcName = `workbench-${wks.slug}-workbench`
    const dockerPvcName = `workbench-${wks.slug}-docker`

    // 1. Delete the pod so PVCs are released
    await this.kube.remove(kubeconfig, "Pod", ns, podName)
    await this.waitForResourceGone(kubeconfig, "Pod", ns, podName)

    // 2. Delete both PVCs
    await this.kube.remove(
      kubeconfig,
      "PersistentVolumeClaim",
      ns,
      workbenchPvcName
    )
    await this.kube.remove(
      kubeconfig,
      "PersistentVolumeClaim",
      ns,
      dockerPvcName
    )
    await this.waitForResourceGone(
      kubeconfig,
      "PersistentVolumeClaim",
      ns,
      workbenchPvcName
    )
    await this.waitForResourceGone(
      kubeconfig,
      "PersistentVolumeClaim",
      ns,
      dockerPvcName
    )

    // 3. Create new PVCs from snapshot data
    const workbenchPvc = generatePVCFromSnapshot(
      wks.slug,
      `snap-${k8sName(snapshotId)}-workbench`,
      "workbench",
      wksSpec.storageGb ?? 10,
      wks.id,
      SANDBOX_STORAGE_CLASS
    )
    const dockerPvc = generatePVCFromSnapshot(
      wks.slug,
      `snap-${k8sName(snapshotId)}-docker`,
      "docker",
      wksSpec.dockerCacheGb ?? 20,
      wks.id,
      SANDBOX_STORAGE_CLASS
    )

    await this.kube.apply(kubeconfig, workbenchPvc)
    await this.kube.apply(kubeconfig, dockerPvc)

    // 4. Re-reconcile to create pod + service (PVCs already exist with snapshot data)
    await this.reconcileWorkbench(sandboxId)

    logger.info({ sandboxId, snapshotId }, "Sandbox restored from snapshot")
  }

  /**
   * Delete VolumeSnapshot resources from k8s for a deleted snapshot.
   */
  async reconcileSnapshotDelete(snapshotId: string): Promise<void> {
    const snap = await getSnapshot(this.db, snapshotId)
    if (!snap) return // Already gone

    try {
      const { wks, kubeconfig, ns } = await this.loadWorkbenchContext(
        snap.workbenchId
      )

      // Remove both VolumeSnapshot resources
      await this.kube.remove(
        kubeconfig,
        "VolumeSnapshot",
        ns,
        `snap-${k8sName(snapshotId)}-workbench`
      )
      await this.kube.remove(
        kubeconfig,
        "VolumeSnapshot",
        ns,
        `snap-${k8sName(snapshotId)}-docker`
      )

      logger.info({ snapshotId }, "VolumeSnapshots deleted from k8s")
    } catch (err) {
      // Log but don't throw — the DB is already marked deleted
      logger.error(
        { snapshotId, error: String(err) },
        "Failed to delete VolumeSnapshots from k8s"
      )
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
    intervalMs: number = 3_000
  ): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      let allReady = true
      for (const name of names) {
        const resource = await this.kube.get(
          kubeconfig,
          "VolumeSnapshot",
          ns,
          name
        )
        if (!resource) {
          allReady = false
          break
        }
        const status = (resource as unknown as Record<string, unknown>)
          .status as Record<string, unknown> | undefined
        if (status?.error) return false
        if (status?.readyToUse !== true) {
          allReady = false
          break
        }
      }
      if (allReady) return true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return false
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
    intervalMs: number = 2_000
  ): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const resource = await this.kube.get(kubeconfig, kind, ns, name)
      if (!resource) return
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    logger.warn({ kind, ns, name }, "Timed out waiting for resource deletion")
  }

  async reconcileWorkload(componentDeploymentId: string): Promise<void> {
    // 1. Load component deployment
    const [cd] = await this.db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, componentDeploymentId))
    if (!cd)
      throw new Error(
        `Component deployment not found: ${componentDeploymentId}`
      )
    const cdSpec: ComponentDeploymentSpec =
      cd.spec ?? ({} as ComponentDeploymentSpec)

    // 2. Load component
    const [comp] = await this.db
      .select()
      .from(component)
      .where(eq(component.id, cd.componentId))
    if (!comp) throw new Error(`Component not found: ${cd.componentId}`)
    // TODO: fix type — ComponentSpec is a discriminated union; cast to access common fields
    const compSpec = (comp.spec ?? {}) as Record<string, unknown>

    // 3. Load system deployment
    const [sd] = await this.db
      .select()
      .from(systemDeployment)
      .where(eq(systemDeployment.id, cd.systemDeploymentId))
    if (!sd)
      throw new Error(`System deployment not found: ${cd.systemDeploymentId}`)
    const sdSpec: SystemDeploymentSpec = sd.spec ?? ({} as SystemDeploymentSpec)

    // 4. Load system name
    const [sys] = await this.db
      .select()
      .from(system)
      .where(eq(system.id, sd.systemId))
    const systemName = sys?.name ?? "unknown"

    // 5. Build reconcile context
    // TODO: fix type — desiredArtifactUri is not yet in ComponentDeploymentSpec; add when schema is updated
    const cdSpecExtra = cdSpec as ComponentDeploymentSpec & {
      desiredArtifactUri?: string | null
    }
    const ctx: ReconcileContext = {
      workload: {
        workloadId: cd.id,
        desiredImage: cdSpec.desiredImage ?? "",
        desiredArtifactUri: cdSpecExtra.desiredArtifactUri ?? null,
        replicas: cdSpec.replicas ?? 1,
        envOverrides: cdSpec.envOverrides ?? {},
        resourceOverrides: cdSpec.resourceOverrides ?? {},
        moduleVersionId: cd.artifactId ?? "",
      },
      component: {
        name: comp.name,
        kind: comp.type,
        ports: (compSpec.ports ?? []) as Array<{
          name: string
          port: number
          protocol: string
        }>,
        healthcheck:
          (compSpec.healthcheck as {
            path: string
            portName: string
            protocol: string
          } | null) ?? null,
        // TODO: fix type — isPublic is not in ComponentSpec union; add when schema is updated
        isPublic:
          (compSpec as Record<string, unknown> & { isPublic?: boolean })
            .isPublic ?? false,
        stateful:
          (compSpec as Record<string, unknown> & { stateful?: boolean })
            .stateful ?? false,
        defaultCpu:
          (compSpec as Record<string, unknown> & { defaultCpu?: string })
            .defaultCpu ?? "100m",
        defaultMemory:
          (compSpec as Record<string, unknown> & { defaultMemory?: string })
            .defaultMemory ?? "128Mi",
        defaultReplicas:
          (compSpec as Record<string, unknown> & { defaultReplicas?: number })
            .defaultReplicas ?? 1,
      },
      target: {
        systemDeploymentId: sd.id,
        name: sd.name,
        kind: sd.type,
        runtime: sdSpec.runtime ?? "kubernetes",
        clusterId: sd.realmId,
        hostId: null,
        vmId: null,
        namespace: sdSpec.namespace ?? `${sd.slug}`,
      },
      moduleName: systemName,
    }

    // 6. Dispatch to runtime strategy
    const strategy = getReconcilerStrategy(ctx.target.runtime)
    const result = await strategy.reconcile(ctx, this.db)

    // 7. Update component deployment spec
    await this.db
      .update(componentDeployment)
      .set({
        spec: {
          ...cdSpec,
          status: result.status as ComponentDeploymentSpec["status"],
          ...(result.actualImage != null
            ? { actualImage: result.actualImage }
            : {}),
          driftDetected: result.driftDetected,
          lastReconciledAt: new Date(),
        },
        updatedAt: new Date(),
      })
      .where(eq(componentDeployment.id, componentDeploymentId))
  }

  async detectDrift(): Promise<
    Array<{ workloadId: string; desiredImage: string; actualImage: string }>
  > {
    const all = await this.db.select().from(componentDeployment)
    const drifted = all.filter((cd) => cd.spec?.driftDetected === true)

    return drifted.map((cd) => {
      const spec: ComponentDeploymentSpec =
        cd.spec ?? ({} as ComponentDeploymentSpec)
      return {
        workloadId: cd.id,
        desiredImage: spec.desiredImage ?? "",
        actualImage: spec.actualImage ?? "",
      }
    })
  }

  /**
   * Re-resolve routes whose status is stale, pending, error, or out of sync.
   */
  async reconcileRoutes(): Promise<{ resolved: number; errors: number }> {
    let resolved = 0
    let errors = 0

    const staleRoutes = await this.db
      .select()
      .from(infraRoute)
      .where(
        or(
          ne(infraRoute.generation, infraRoute.observedGeneration),
          sql`${infraRoute.status}->>'phase' IN ('pending', 'stale', 'error')`,
          sql`${infraRoute.status}->>'resolvedAt' IS NULL`,
          sql`(${infraRoute.status}->>'resolvedAt')::timestamptz < NOW() - INTERVAL '5 minutes'`
        )
      )

    if (staleRoutes.length === 0) return { resolved: 0, errors: 0 }

    const reader = drizzleDbReader(this.db)

    for (const r of staleRoutes) {
      try {
        const newStatus = await resolveRouteTargets(
          r.spec?.targets ?? [],
          reader
        )

        await this.db
          .update(infraRoute)
          .set({
            status: newStatus as Record<string, unknown>,
            observedGeneration: r.generation,
            updatedAt: new Date(),
          })
          .where(eq(infraRoute.id, r.id))

        if (newStatus.phase === "resolved") resolved++
        else errors++
      } catch (err) {
        logger.error({ routeId: r.id, err }, "Route reconciliation failed")
        errors++
      }
    }

    if (resolved > 0 || errors > 0) {
      logger.info({ resolved, errors }, "Route reconciliation complete")
    }

    return { resolved, errors }
  }

  /** Start the reconciler as an OperationRunner with DB-tracked runs. */
  startOperationRunner(
    db: Database,
    opts?: { intervalMs?: number }
  ): import("../lib/operations").OperationRunner {
    // Dynamic require to avoid circular dependency: operations/runner → schema/ops → reconciler
    const { createOperationRunner } =
      require("../lib/operations") as typeof import("../lib/operations")
    const reconciler = this
    return createOperationRunner(db, {
      name: "reconciler",
      intervalMs: opts?.intervalMs ?? 30_000,
      runOnStartup: false, // reconciler doesn't need a startup run — it runs every 30s
      async execute(_log) {
        const result = await reconciler.reconcileAll()
        return result as unknown as Record<string, unknown>
      },
    })
  }
}
