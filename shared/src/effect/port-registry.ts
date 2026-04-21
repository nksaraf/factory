import { Context, Effect, Layer, Ref, Scope } from "effect"
import { Schema } from "effect"
import { createServer } from "node:net"

export class PortConflictError extends Schema.TaggedError<PortConflictError>()(
  "PortConflictError",
  {
    port: Schema.Number,
    component: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.String),
  }
) {
  get message(): string {
    const target = this.component ? ` for ${this.component}` : ""
    return `Port ${this.port} already in use${target}`
  }

  get httpStatus(): number {
    return 409
  }

  get errorCode(): string {
    return "PORT_CONFLICT"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      port: this.port,
      ...(this.component ? { component: this.component } : {}),
    }
  }
}

export interface PortRequest {
  readonly name: string
  readonly preferred?: number
  readonly component?: string
}

export interface ServicePortRequest {
  readonly service: string
  readonly ports: PortRequest[]
}

export interface PortAllocation {
  readonly name: string
  readonly port: number
  readonly component?: string
}

export interface PortRegistry {
  readonly allocate: (
    requests: PortRequest[]
  ) => Effect.Effect<Record<string, number>, PortConflictError>
  readonly allocateMulti: (
    requests: ServicePortRequest[]
  ) => Effect.Effect<Record<string, Record<string, number>>, PortConflictError>
  readonly isAvailable: (port: number) => Effect.Effect<boolean>
  readonly release: (port: number) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<PortAllocation[]>
}

export class PortRegistryTag extends Context.Tag("PortRegistry")<
  PortRegistryTag,
  PortRegistry
>() {}

function probePort(port: number): Effect.Effect<boolean> {
  return Effect.async<boolean>((resume) => {
    const server = createServer()
    server.once("error", () => {
      resume(Effect.succeed(false))
    })
    server.once("listening", () => {
      server.close(() => {
        resume(Effect.succeed(true))
      })
    })
    server.listen(port, "127.0.0.1")
  })
}

export function makePortRegistry(): Effect.Effect<PortRegistry> {
  return Effect.gen(function* () {
    const allocations = yield* Ref.make<PortAllocation[]>([])
    const mutex = yield* Effect.makeSemaphore(1)

    const isAllocated = (port: number) =>
      Ref.get(allocations).pipe(
        Effect.map((a) => a.some((al) => al.port === port))
      )

    const findFreePortChecked = (
      startFrom: number
    ): Effect.Effect<number, PortConflictError> =>
      Effect.gen(function* () {
        for (let port = startFrom; port < startFrom + 1000; port++) {
          const taken = yield* isAllocated(port)
          if (taken) continue
          const available = yield* probePort(port)
          if (available) return port
        }
        return yield* Effect.fail(
          new PortConflictError({
            port: startFrom,
            cause: `No free port found in range ${startFrom}-${startFrom + 999}`,
          })
        )
      })

    const registry: PortRegistry = {
      allocate: (requests) =>
        mutex
          .withPermits(1)(
            Effect.gen(function* () {
              const result: Record<string, number> = {}
              for (const req of requests) {
                let port: number | undefined
                if (req.preferred) {
                  const taken = yield* isAllocated(req.preferred)
                  if (!taken) {
                    const available = yield* probePort(req.preferred)
                    if (available) port = req.preferred
                  }
                }
                if (port === undefined) {
                  port = yield* findFreePortChecked(req.preferred ?? 3000)
                }
                result[req.name] = port
                yield* Ref.update(allocations, (a) => [
                  ...a,
                  { name: req.name, port: port!, component: req.component },
                ])
              }
              return result
            })
          )
          .pipe(
            Effect.withSpan("PortRegistry.allocate", {
              attributes: { "port.requestCount": requests.length },
            })
          ),

      allocateMulti: (requests) =>
        Effect.gen(function* () {
          const result: Record<string, Record<string, number>> = {}
          for (const svcReq of requests) {
            result[svcReq.service] = yield* registry.allocate(svcReq.ports)
          }
          return result
        }).pipe(
          Effect.withSpan("PortRegistry.allocateMulti", {
            attributes: { "port.serviceCount": requests.length },
          })
        ),

      isAvailable: (port) => probePort(port),

      release: (port) =>
        Ref.update(allocations, (a) => a.filter((al) => al.port !== port)),

      snapshot: Ref.get(allocations),
    }

    return registry
  })
}
