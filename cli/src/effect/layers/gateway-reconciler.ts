import { Effect, Layer } from "effect"
import {
  GatewayReconciler,
  type IGatewayReconciler,
} from "../services/gateway-reconciler.js"

export const NoopGatewayReconcilerLive = Layer.succeed(
  GatewayReconciler,
  GatewayReconciler.of({
    apply: () => Effect.succeed({ applied: 0, errors: 0 }),
    getCurrentRoutes: Effect.succeed(null),
  }) satisfies IGatewayReconciler
)
