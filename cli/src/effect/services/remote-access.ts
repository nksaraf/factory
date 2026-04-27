import { Context, Effect, Layer, Ref, Schema } from "effect"
import { EntityFinder, type ResolvedEntity } from "../../lib/entity-finder.js"
import { FactoryApi } from "./factory-api.js"
import { EntityNotFoundError } from "@smp/factory-shared/effect"

// ── Types ──────────────────────────────────────────────────

export class JumpHop extends Schema.Class<JumpHop>("JumpHop")({
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
}) {}

export type SshTransport = {
  readonly kind: "ssh"
  readonly host: string
  readonly port: number
  readonly user: string
  readonly identity?: string
  readonly jumpChain: readonly JumpHop[]
}

export type KubectlTransport = {
  readonly kind: "kubectl"
  readonly podName: string
  readonly namespace: string
  readonly container?: string
  readonly kubeContext?: string
  readonly kubeconfig?: string
}

export type LocalTransport = {
  readonly kind: "local"
}

export type Transport = SshTransport | KubectlTransport | LocalTransport

export interface AccessTarget {
  readonly slug: string
  readonly displayName: string
  readonly status: string
  readonly entityType: string
  readonly transport: Transport
  readonly raw: ResolvedEntity
}

// ── Service ────────────────────────────────────────────────

export class RemoteAccess extends Context.Tag("RemoteAccess")<
  RemoteAccess,
  {
    readonly resolve: (
      slugOrId: string
    ) => Effect.Effect<AccessTarget, EntityNotFoundError>
    readonly resolveIp: (
      ip: string
    ) => Effect.Effect<AccessTarget, EntityNotFoundError>
    readonly fromEntity: (entity: ResolvedEntity) => AccessTarget
  }
>() {}

// ── Implementation ─────────────────────────────────────────

function entityToAccessTarget(entity: ResolvedEntity): AccessTarget {
  let transport: Transport

  if (entity.transport === "kubectl" && entity.podName && entity.namespace) {
    transport = {
      kind: "kubectl",
      podName: entity.podName,
      namespace: entity.namespace,
      container: entity.container,
      kubeContext: entity.kubeContext,
      kubeconfig: entity.kubeconfig,
    }
  } else if (entity.transport === "ssh" && entity.sshHost) {
    const jumpChain: JumpHop[] = []
    if (entity.jumpHost) {
      jumpChain.push(
        new JumpHop({
          host: entity.jumpHost,
          port: entity.jumpPort ?? 22,
          user: entity.jumpUser ?? "root",
        })
      )
    }
    transport = {
      kind: "ssh",
      host: entity.sshHost,
      port: entity.sshPort ?? 22,
      user: entity.sshUser ?? "root",
      identity: entity.identityFile,
      jumpChain,
    }
  } else {
    transport = { kind: "local" }
  }

  return {
    slug: entity.slug,
    displayName: entity.displayName,
    status: entity.status,
    entityType: entity.type,
    transport,
    raw: entity,
  }
}

export const RemoteAccessLive = Layer.effect(
  RemoteAccess,
  Effect.gen(function* () {
    const cache = yield* Ref.make(new Map<string, AccessTarget>())
    const ipCache = yield* Ref.make(new Map<string, string>())
    const finder = new EntityFinder()

    const resolveSlug = (slugOrId: string) =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(cache)
        const hit = cached.get(slugOrId)
        if (hit) return hit

        const entity = yield* Effect.tryPromise({
          try: () => finder.resolve(slugOrId),
          catch: () =>
            new EntityNotFoundError({
              entity: "host",
              identifier: slugOrId,
            }),
        })

        if (!entity) {
          return yield* new EntityNotFoundError({
            entity: "host",
            identifier: slugOrId,
          })
        }

        const target = entityToAccessTarget(entity)
        yield* Ref.update(cache, (m) => new Map(m).set(slugOrId, target))
        const t = target.transport
        if (t.kind === "ssh") {
          const sshHost = t.host
          yield* Ref.update(ipCache, (m) => new Map(m).set(sshHost, slugOrId))
        }
        return target
      })

    const resolveIp = (ip: string) =>
      Effect.gen(function* () {
        const ips = yield* Ref.get(ipCache)
        const slug = ips.get(ip)
        if (slug) return yield* resolveSlug(slug)

        const entity = yield* Effect.tryPromise({
          try: async () => {
            const allEntities = await finder.list()
            return allEntities.find((e) => e.sshHost === ip) ?? null
          },
          catch: () =>
            new EntityNotFoundError({
              entity: "host",
              identifier: ip,
            }),
        })

        if (!entity) {
          return yield* new EntityNotFoundError({
            entity: "host",
            identifier: ip,
          })
        }

        const target = entityToAccessTarget(entity)
        yield* Ref.update(cache, (m) => new Map(m).set(entity.slug, target))
        yield* Ref.update(ipCache, (m) => new Map(m).set(ip, entity.slug))
        return target
      })

    return {
      resolve: resolveSlug,
      resolveIp,
      fromEntity: entityToAccessTarget,
    }
  })
)
