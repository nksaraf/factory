import { Context, Effect } from "effect"
import type { ExecutorError } from "../errors/site.js"

export interface ManifestGateway {
  readonly routes: ReadonlyArray<{
    readonly domain: string
    readonly targetService: string
    readonly targetPort: number
  }>
}

export interface GatewayReconcileResult {
  readonly applied: number
  readonly errors: number
}

export interface IGatewayReconciler {
  readonly apply: (
    gateway: ManifestGateway
  ) => Effect.Effect<GatewayReconcileResult, ExecutorError>
  readonly getCurrentRoutes: Effect.Effect<
    ManifestGateway | null,
    ExecutorError
  >
}

export class GatewayReconciler extends Context.Tag("GatewayReconciler")<
  GatewayReconciler,
  IGatewayReconciler
>() {}
