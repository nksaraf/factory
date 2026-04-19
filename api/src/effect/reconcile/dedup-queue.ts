import { Effect, HashSet, Queue, Ref, Scope } from "effect"

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
    const inFlight = yield* Ref.make(HashSet.empty<string>())

    yield* Effect.addFinalizer(() => Queue.shutdown(queue))

    return {
      offer: (params: P) =>
        Effect.gen(function* () {
          const key = keyOf(params)
          const set = yield* Ref.get(inFlight)
          if (HashSet.has(set, key)) {
            return false
          }
          yield* Ref.update(inFlight, (s) => HashSet.add(s, key))
          yield* Queue.offer(queue, params)
          return true
        }),

      take: Queue.take(queue),

      size: Queue.size(queue),

      complete: (key: string) =>
        Ref.update(inFlight, (s) => HashSet.remove(s, key)),
    }
  })
}
