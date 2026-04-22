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
    const handleRef = yield* Ref.make<{ close: () => void } | null>(null)

    return TunnelManagerTag.of({
      open: (opts) =>
        Effect.gen(function* () {
          yield* Ref.set(stateRef, { status: "connecting" })

          const { info, handle } = yield* Effect.tryPromise({
            try: async () => {
              const { openTunnel } = await import("../../lib/tunnel-client.js")

              return new Promise<{
                info: TunnelInfo
                handle: { close: () => void }
              }>((resolve, reject) => {
                openTunnel(
                  {
                    port: opts.port,
                    subdomain: opts.subdomain,
                    routeFamily: "dev",
                    publishPorts: opts.publishPorts,
                    portMap: opts.portMap,
                  },
                  {
                    onRegistered: (regInfo) => {
                      resolve({
                        info: {
                          url: regInfo.url,
                          subdomain: regInfo.subdomain,
                          portUrls: regInfo.portUrls,
                        },
                        handle: { close: () => {} },
                      })
                    },
                    onError: (err) => reject(err),
                    onClose: () =>
                      reject(new Error("Tunnel closed before registration")),
                    onReconnecting: () => {},
                    onReconnected: () => {},
                  }
                )
                  .then((h) => {
                    if (h && typeof h === "object" && "close" in h) {
                      resolve({
                        info: { url: "", subdomain: opts.subdomain },
                        handle: h as { close: () => void },
                      })
                    }
                  })
                  .catch(reject)
              })
            },
            catch: (error) =>
              new TunnelError({
                operation: "open",
                cause: error instanceof Error ? error.message : String(error),
              }),
          })

          yield* Ref.set(stateRef, { status: "connected", info })
          yield* Ref.set(handleRef, handle)

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              const h = yield* Ref.get(handleRef)
              if (h) {
                try {
                  h.close()
                } catch {}
              }
              yield* Ref.set(stateRef, { status: "disconnected" })
              yield* Ref.set(handleRef, null)
            })
          )

          return info
        }).pipe(
          Effect.withSpan("TunnelManager.open", {
            attributes: { "tunnel.subdomain": opts.subdomain },
          })
        ),

      getState: Ref.get(stateRef),
    }) satisfies TunnelManagerService
  })
)
