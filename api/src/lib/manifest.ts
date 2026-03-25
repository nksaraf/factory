import { createHash } from "node:crypto"
import type { ManifestV1, ManifestRoute, ManifestDomain } from "@smp/factory-shared/types"

export function computeManifest(input: {
  site: { siteId: string; name: string; product: string }
  release: {
    releaseId: string
    version: string
    pins: Array<{ moduleVersionId: string; moduleName: string; version: string }>
  } | null
  routes?: ManifestRoute[]
  domains?: ManifestDomain[]
  configuration?: Record<string, unknown>
  previousVersion?: number
}): ManifestV1 {
  const manifestVersion = (input.previousVersion ?? 0) + 1
  // Build content WITHOUT the hash first
  const preHash: Omit<ManifestV1, "manifestHash"> & { manifestHash: string } = {
    manifestVersion,
    manifestHash: "",
    targetRelease: input.release
      ? {
          releaseId: input.release.releaseId,
          releaseVersion: input.release.version,
          modulePins: input.release.pins,
        }
      : null,
    configuration: input.configuration ?? {},
    routes: input.routes ?? [],
    domains: input.domains ?? [],
  }
  // Compute hash over the content (with hash="" for determinism)
  preHash.manifestHash = createHash("sha256")
    .update(JSON.stringify(preHash))
    .digest("hex")
  return preHash
}
