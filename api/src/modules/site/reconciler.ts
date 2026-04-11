import type { ManifestV1 } from "@smp/factory-shared/types"

import type { GatewayAdapter, GatewayCRD } from "../../adapters/gateway-adapter"
import { manifestToCRDs } from "../../lib/crd-generator"
import { logger } from "../../logger"
import type { ReconcileResult, SiteStatus } from "./state"

export interface SiteReconcilerConfig {
  siteName: string
  factoryUrl: string
  namespace: string
  issuerName: string
  pollIntervalMs: number
}

export class SiteReconciler {
  private config: SiteReconcilerConfig
  private adapter: GatewayAdapter
  private currentManifestVersion = 0
  private currentManifest: ManifestV1 | null = null
  private lastReconcileResult: ReconcileResult | null = null
  private lastReconcileAt: string | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: SiteReconcilerConfig, adapter: GatewayAdapter) {
    this.config = config
    this.adapter = adapter
  }

  async reconcileOnce(): Promise<ReconcileResult> {
    const checkinUrl = `${this.config.factoryUrl}/api/factory/ops/sites/${this.config.siteName}/checkin`
    const checkinRes = await fetch(checkinUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        healthSnapshot: {
          status: "healthy",
          timestamp: new Date().toISOString(),
        },
        lastAppliedManifestVersion: this.currentManifestVersion,
      }),
    })
    if (!checkinRes.ok) throw new Error(`Checkin failed: ${checkinRes.status}`)
    const checkinData = (await checkinRes.json()) as {
      manifestChanged: boolean
    }

    if (!checkinData.manifestChanged) {
      return {
        success: true,
        manifestVersion: this.currentManifestVersion,
        appliedCRDs: 0,
        deletedCRDs: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      }
    }

    const manifestUrl = `${this.config.factoryUrl}/api/factory/ops/sites/${this.config.siteName}/manifest`
    const manifestRes = await fetch(manifestUrl)
    if (!manifestRes.ok)
      throw new Error(`Manifest fetch failed: ${manifestRes.status}`)
    const manifestData = (await manifestRes.json()) as { data: ManifestV1 }
    const manifest: ManifestV1 = manifestData.data

    return this.applyManifest(manifest)
  }

  async pushManifest(manifest: ManifestV1): Promise<ReconcileResult> {
    return this.applyManifest(manifest)
  }

  private async applyManifest(manifest: ManifestV1): Promise<ReconcileResult> {
    const { namespace, issuerName } = this.config

    const desired = manifestToCRDs(manifest, { namespace, issuer: issuerName })
    const allDesired: GatewayCRD[] = [
      ...desired.ingressRoutes,
      ...desired.certificates,
      ...desired.middlewares,
    ]

    const current = await this.adapter.getCurrentState()

    const desiredNames = new Set(allDesired.map((c) => c.metadata.name))
    const staleNames = current
      .filter(
        (c) =>
          c.metadata.labels["managed-by"] === "dx" &&
          !desiredNames.has(c.metadata.name)
      )
      .map((c) => c.metadata.name)

    const applyResult = await this.adapter.apply(allDesired)

    if (staleNames.length > 0) {
      await this.adapter.delete(staleNames)
    }

    this.currentManifestVersion = manifest.manifestVersion
    this.currentManifest = manifest
    const result: ReconcileResult = {
      success: applyResult.errors.length === 0,
      manifestVersion: manifest.manifestVersion,
      appliedCRDs: applyResult.applied,
      deletedCRDs: staleNames.length,
      errors: applyResult.errors,
      timestamp: new Date().toISOString(),
    }
    this.lastReconcileResult = result
    this.lastReconcileAt = result.timestamp

    logger.info(
      {
        manifestVersion: manifest.manifestVersion,
        applied: applyResult.applied,
        deleted: staleNames.length,
      },
      "site reconciler: manifest applied"
    )

    return result
  }

  startLoop(): () => void {
    logger.info(
      {
        siteName: this.config.siteName,
        intervalMs: this.config.pollIntervalMs,
      },
      "site reconciler: starting poll loop"
    )
    const tick = async () => {
      try {
        await this.reconcileOnce()
      } catch (err) {
        logger.error({ err }, "site reconciler: poll error")
      }
    }
    tick()
    this.pollTimer = setInterval(tick, this.config.pollIntervalMs)
    return () => this.stopLoop()
  }

  stopLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
      logger.info("site reconciler: poll loop stopped")
    }
  }

  getStatus(): SiteStatus {
    return {
      mode: this.pollTimer ? "polling" : this.currentManifest ? "push" : "idle",
      currentManifestVersion: this.currentManifestVersion,
      lastReconcileAt: this.lastReconcileAt,
      lastReconcileResult: this.lastReconcileResult,
      adapterType: this.adapter.type,
    }
  }

  getCurrentManifest(): ManifestV1 | null {
    return this.currentManifest
  }

  async getCRDs(): Promise<GatewayCRD[]> {
    return this.adapter.getCurrentState()
  }
}
