import { Effect, Queue, Ref, Scope, HashSet } from "effect"

export interface DeduplicatingQueue<P> {
  readonly offer: (params: P) => Effect.Effect<boolean>
  readonly take: Effect.Effect<P>
  readonly size: Effect.Effect<number>
  readonly complete: (key: string) => Effect.Effect<void>
}

export function makeDeduplicatingQueue<P>(
  capacity: number,
  keyOf: (p: P) => string
): Effect.Effect<DeduplicatingQueue<P>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const queue = yield* Queue.bounded<P>(capacity)
    const keys = yield* Ref.make(HashSet.empty<string>())

    return {
      offer: (params: P) =>
        Effect.gen(function* () {
          const key = keyOf(params)
          const current = yield* Ref.get(keys)
          if (HashSet.has(current, key)) return false
          yield* Ref.update(keys, HashSet.add(key))
          yield* Queue.offer(queue, params)
          return true
        }),

      take: Effect.gen(function* () {
        const item = yield* Queue.take(queue)
        return item
      }),

      size: Queue.size(queue),

      complete: (key: string) => Ref.update(keys, HashSet.remove(key)),
    } satisfies DeduplicatingQueue<P>
  })
}
