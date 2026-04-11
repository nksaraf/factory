import type { ManifestV1 } from "@smp/factory-shared/types"

export class SiteSimulator {
  private currentManifestVersion: number = 0

  constructor(
    private siteName: string,
    private apiBaseUrl: string
  ) {}

  async checkin(): Promise<{
    manifestChanged: boolean
    manifest?: ManifestV1
  }> {
    const res = await fetch(
      `${this.apiBaseUrl}/api/v1/factory/ops/sites/${this.siteName}/checkin`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          healthSnapshot: {
            status: "healthy",
            timestamp: new Date().toISOString(),
          },
          lastAppliedManifestVersion: this.currentManifestVersion,
        }),
      }
    )
    if (!res.ok) throw new Error(`Checkin failed: ${res.status}`)
    const data = await res.json()

    if (
      data.manifestChanged &&
      data.latestVersion > this.currentManifestVersion
    ) {
      const manifestRes = await fetch(
        `${this.apiBaseUrl}/api/v1/factory/ops/sites/${this.siteName}/manifest`
      )
      if (!manifestRes.ok)
        throw new Error(`Manifest fetch failed: ${manifestRes.status}`)
      const manifestData = await manifestRes.json()
      this.currentManifestVersion = manifestData.data.manifestVersion
      return { manifestChanged: true, manifest: manifestData.data }
    }

    return { manifestChanged: false }
  }

  simulateConvergence(manifest: ManifestV1): {
    actions: Array<{ type: string; description: string }>
  } {
    const actions: Array<{ type: string; description: string }> = []

    if (manifest.targetRelease) {
      for (const pin of manifest.targetRelease.modulePins) {
        actions.push({
          type: "module_deploy",
          description: `Deploy ${pin.moduleName} v${pin.version}`,
        })
      }
    }

    return { actions }
  }

  getCurrentManifestVersion(): number {
    return this.currentManifestVersion
  }
}
