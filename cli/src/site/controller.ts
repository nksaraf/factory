/**
 * Site controller core — the kubelet for a site.
 *
 * Owns a system deployment, orchestrates reconcile cycles, delegates
 * to the executor for actual changes. Execution-agnostic.
 */
import type { ComponentState, Executor } from "./execution/executor.js"
import type { FactoryLink } from "./factory-link.js"
import type { HealthMonitor, HealthSnapshot } from "./health.js"
import type { SiteManifest } from "./manifest.js"
import {
  type ReconcilePlan,
  type ReconcileStep,
  planChanges,
} from "./reconcile.js"
import type { StateStore } from "./state.js"

export type ControllerMode = "connected" | "standalone" | "air-gapped"

export interface SiteControllerConfig {
  siteName: string
  mode: ControllerMode
  reconcileIntervalMs: number
  workingDir: string
}

export interface ReconcileResult {
  success: boolean
  stepsApplied: number
  stepsTotal: number
  errors: Array<{ step: ReconcileStep; error: string }>
  plan: ReconcilePlan
  durationMs: number
}

export interface ControllerStatus {
  siteName: string
  mode: ControllerMode
  executorType: string
  manifestVersion: number
  uptime: string
  lastReconcileAt: string | null
  lastReconcileResult: ReconcileResult | null
  healthSnapshot: HealthSnapshot | null
}

export interface ReconcileEvent {
  timestamp: string
  type:
    | "reconcile-start"
    | "reconcile-complete"
    | "reconcile-error"
    | "step-applied"
    | "step-failed"
  details: Record<string, unknown>
}

const MAX_EVENTS = 200

export class SiteController {
  readonly config: SiteControllerConfig
  readonly executor: Executor
  readonly factoryLink: FactoryLink | null
  readonly healthMonitor: HealthMonitor
  readonly state: StateStore

  private manifest: SiteManifest | null = null
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private lastReconcileResult: ReconcileResult | null = null
  private lastReconcileAt: string | null = null
  private events: ReconcileEvent[] = []
  private startedAt: Date

  constructor(
    config: SiteControllerConfig,
    executor: Executor,
    factoryLink: FactoryLink | null,
    healthMonitor: HealthMonitor,
    state: StateStore
  ) {
    this.config = config
    this.executor = executor
    this.factoryLink = factoryLink
    this.healthMonitor = healthMonitor
    this.state = state
    this.startedAt = new Date()

    const lastManifest = state.getLastManifest()
    if (lastManifest) {
      this.manifest = lastManifest
    }
  }

  getManifest(): SiteManifest | null {
    return this.manifest
  }

  setManifest(manifest: SiteManifest): void {
    this.manifest = manifest
    this.state.saveManifest(manifest)
  }

  getStatus(): ControllerStatus {
    const now = new Date()
    const uptimeMs = now.getTime() - this.startedAt.getTime()
    const uptimeSecs = Math.floor(uptimeMs / 1000)
    const hours = Math.floor(uptimeSecs / 3600)
    const mins = Math.floor((uptimeSecs % 3600) / 60)
    const secs = uptimeSecs % 60

    return {
      siteName: this.config.siteName,
      mode: this.config.mode,
      executorType: this.executor.type,
      manifestVersion: this.manifest?.version ?? 0,
      uptime: `${hours}h ${mins}m ${secs}s`,
      lastReconcileAt: this.lastReconcileAt,
      lastReconcileResult: this.lastReconcileResult,
      healthSnapshot: this.healthMonitor.getLastSnapshot(),
    }
  }

  getEvents(): ReconcileEvent[] {
    return this.events
  }

  async reconcile(): Promise<ReconcileResult> {
    const start = performance.now()
    this.emitEvent("reconcile-start", {
      manifestVersion: this.manifest?.version,
    })

    try {
      if (this.factoryLink && this.config.mode === "connected") {
        const currentVersion = this.manifest?.version ?? 0
        const currentStates = await this.executor.inspect().catch(() => [])
        const updated = await this.factoryLink.checkForUpdates(
          currentVersion,
          currentStates,
          this.executor.type
        )
        if (updated) {
          this.manifest = updated
          this.state.saveManifest(updated)
        }
      }

      if (!this.manifest) {
        return {
          success: false,
          stepsApplied: 0,
          stepsTotal: 0,
          errors: [],
          plan: { steps: [], upToDate: [] },
          durationMs: performance.now() - start,
        }
      }

      const actual = await this.executor.inspect()
      const plan = planChanges(this.manifest, actual)
      const errors: ReconcileResult["errors"] = []
      let applied = 0

      for (const step of plan.steps) {
        try {
          await this.executeStep(step)
          applied++
          this.emitEvent("step-applied", {
            action: step.action,
            component: step.component,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push({ step, error: msg })
          this.emitEvent("step-failed", {
            action: step.action,
            component: step.component,
            error: msg,
          })
        }
      }

      if (this.factoryLink) {
        const newActual = await this.executor.inspect()
        const health = await this.executor.healthCheckAll()
        await this.factoryLink.reportState(newActual, health)
      }

      const result: ReconcileResult = {
        success: errors.length === 0,
        stepsApplied: applied,
        stepsTotal: plan.steps.length,
        errors,
        plan,
        durationMs: performance.now() - start,
      }

      this.lastReconcileResult = result
      this.lastReconcileAt = new Date().toISOString()
      this.emitEvent("reconcile-complete", {
        applied,
        errors: errors.length,
        durationMs: result.durationMs,
      })

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.emitEvent("reconcile-error", { error: msg })

      const result: ReconcileResult = {
        success: false,
        stepsApplied: 0,
        stepsTotal: 0,
        errors: [],
        plan: { steps: [], upToDate: [] },
        durationMs: performance.now() - start,
      }
      this.lastReconcileResult = result
      this.lastReconcileAt = new Date().toISOString()
      return result
    }
  }

  private async executeStep(step: ReconcileStep): Promise<void> {
    switch (step.action) {
      case "run-init":
        await this.executor.runInit(step.component)
        break
      case "deploy":
        if (step.desired) {
          const result = await this.executor.deploy(step.component, {
            image: step.desired.desiredImage,
            replicas: step.desired.replicas,
            envOverrides: step.desired.envOverrides,
            resourceOverrides: step.desired.resourceOverrides,
          })
          this.state.recordImageDeploy(
            step.component,
            result.actualImage,
            this.manifest?.version ?? 0
          )
        }
        break
      case "scale":
        if (step.replicas !== undefined) {
          await this.executor.scale(step.component, step.replicas)
        }
        break
      case "stop":
        await this.executor.stop(step.component)
        break
      case "restart":
        await this.executor.restart(step.component)
        break
    }
  }

  startLoop(): () => void {
    const tick = async () => {
      try {
        await this.reconcile()
      } catch {
        // reconcile handles its own errors — this is belt-and-suspenders
      }
    }
    tick()
    this.reconcileTimer = setInterval(tick, this.config.reconcileIntervalMs)
    this.healthMonitor.start()
    return () => this.stopLoop()
  }

  stopLoop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = null
    }
    this.healthMonitor.stop()
  }

  isRunning(): boolean {
    return this.reconcileTimer !== null
  }

  private emitEvent(
    type: ReconcileEvent["type"],
    details: Record<string, unknown>
  ): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      type,
      details,
    })
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS)
    }
  }
}
