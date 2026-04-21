import { Effect, Layer } from "effect"
import {
  GatewayReconcilerTag,
  type GatewayReconcilerService,
} from "../services/gateway-reconciler.js"

export const NoopGatewayReconcilerLive = Layer.succeed(
  GatewayReconcilerTag,
  GatewayReconcilerTag.of({
    apply: () => Effect.succeed({ applied: 0, errors: 0 }),
    getCurrentRoutes: Effect.succeed(null),
  }) satisfies GatewayReconcilerService
)
