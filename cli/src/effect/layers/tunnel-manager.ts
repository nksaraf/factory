import { Effect, Layer, Ref } from "effect"
import {
  TunnelManagerTag,
  type TunnelManagerService,
  type TunnelInfo,
  type TunnelState,
} from "../services/tunnel-manager.js"
import { TunnelError } from "../errors/site.js"

export const TunnelManagerLive = Layer.effect(
  TunnelManagerTag,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<TunnelState>({
      status: "disconnected",
    })

    return TunnelManagerTag.of({
      open: (opts) =>
        Effect.gen(function* () {
          yield* Ref.set(stateRef, { status: "connecting" })

          const result = yield* Effect.tryPromise({
            try: async () => {
              const { openTunnel } = await import("../../lib/tunnel-client.js")

              return new Promise<TunnelInfo>((resolve, reject) => {
                openTunnel(
                  {
                    port: opts.port,
                    subdomain: opts.subdomain,
                    routeFamily: "dev",
                    publishPorts: opts.publishPorts,
                    portMap: opts.portMap,
                  },
                  {
                    onRegistered: (info) => {
                      resolve({
                        url: info.url,
                        subdomain: info.subdomain,
                        portUrls: info.portUrls,
                      })
                    },
                    onError: (err) => {
                      reject(err)
                    },
                    onClose: () => {
                      reject(new Error("Tunnel closed before registration"))
                    },
                    onReconnecting: () => {},
                    onReconnected: () => {},
                  }
                ).catch(reject)
              })
            },
            catch: (error) =>
              new TunnelError({
                operation: "open",
                cause: error instanceof Error ? error.message : String(error),
              }),
          })

          yield* Ref.set(stateRef, { status: "connected", info: result })

          yield* Effect.addFinalizer(() =>
            Ref.set(stateRef, { status: "disconnected" })
          )

          return result
        }).pipe(
          Effect.withSpan("TunnelManager.open", {
            attributes: { "tunnel.subdomain": opts.subdomain },
          })
        ),

      getState: Ref.get(stateRef),
    }) satisfies TunnelManagerService
  })
)
