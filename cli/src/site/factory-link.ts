/**
 * Factory communication — handles check-in, manifest fetching,
 * and state reporting for connected site controllers.
 */
import type { ComponentState } from "./execution/executor.js"
import type { SiteManifest } from "./manifest.js"

export interface FactoryLinkConfig {
  factoryUrl: string
  siteName: string
  apiToken?: string
}

export interface CheckinPayload {
  manifestVersion: number
  executorType: string
  componentStates: Array<{
    name: string
    actualImage: string
    status: string
    health: string
  }>
  healthSnapshot: {
    status: string
    timestamp: string
  }
}

export interface CheckinResponse {
  manifestChanged: boolean
}

export class FactoryLink {
  private config: FactoryLinkConfig

  constructor(config: FactoryLinkConfig) {
    this.config = config
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.config.apiToken) {
      h.Authorization = `Bearer ${this.config.apiToken}`
    }
    return h
  }

  async checkin(payload: CheckinPayload): Promise<CheckinResponse> {
    const url = `${this.config.factoryUrl}/api/v1/fleet/sites/${this.config.siteName}/checkin`
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      throw new Error(`Factory checkin failed: ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as CheckinResponse
  }

  async fetchManifest(): Promise<SiteManifest> {
    const url = `${this.config.factoryUrl}/api/v1/fleet/sites/${this.config.siteName}/manifest`
    const res = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(
        `Factory manifest fetch failed: ${res.status} ${res.statusText}`
      )
    }
    const body = (await res.json()) as { data: SiteManifest }
    return body.data
  }

  async reportState(
    componentStates: ComponentState[],
    health: Record<string, string>
  ): Promise<void> {
    const url = `${this.config.factoryUrl}/api/v1/fleet/sites/${this.config.siteName}/state`
    await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        componentStates: componentStates.map((s) => ({
          name: s.name,
          actualImage: s.image,
          status: s.status,
          health: s.health,
        })),
        healthSnapshot: health,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // state reporting is best-effort — don't fail the reconcile cycle
    })
  }

  async checkForUpdates(
    currentVersion: number,
    componentStates: ComponentState[] = [],
    executorType = "compose"
  ): Promise<SiteManifest | null> {
    const checkinResult = await this.checkin({
      manifestVersion: currentVersion,
      executorType,
      componentStates: componentStates.map((s) => ({
        name: s.name,
        actualImage: s.image,
        status: s.status,
        health: s.health,
      })),
      healthSnapshot: {
        status: componentStates.some((s) => s.health === "unhealthy")
          ? "degraded"
          : "healthy",
        timestamp: new Date().toISOString(),
      },
    })

    if (checkinResult.manifestChanged) {
      return this.fetchManifest()
    }
    return null
  }
}
