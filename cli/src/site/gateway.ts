/**
 * Gateway reconciliation — extracted from the API-side SiteReconciler.
 *
 * In the CLI context this is used when the site controller needs to
 * apply gateway/route changes locally (e.g. updating Traefik config).
 * For now this is a pass-through; the existing SiteReconciler in the
 * API handles gateway CRDs for Kubernetes-backed gateways.
 */
import type { ManifestGateway } from "./manifest.js"

export interface GatewayReconcileResult {
  applied: number
  deleted: number
  errors: Array<{ name: string; error: string }>
}

export interface GatewayReconciler {
  apply(gateway: ManifestGateway): Promise<GatewayReconcileResult>
  getCurrentRoutes(): Promise<ManifestGateway | null>
}

/**
 * Noop gateway reconciler — used when the site doesn't manage
 * its own gateway (e.g. Docker Compose sites behind an external LB).
 */
export class NoopGatewayReconciler implements GatewayReconciler {
  async apply(_gateway: ManifestGateway): Promise<GatewayReconcileResult> {
    return { applied: 0, deleted: 0, errors: [] }
  }

  async getCurrentRoutes(): Promise<ManifestGateway | null> {
    return null
  }
}
