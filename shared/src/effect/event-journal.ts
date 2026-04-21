import { Effect, PubSub, Ref } from "effect"

export interface EventJournal<E> {
  readonly emit: (event: E) => Effect.Effect<void>
  readonly recent: Effect.Effect<ReadonlyArray<E>>
  readonly subscribe: PubSub.PubSub<E>
}

export interface EventJournalConfig {
  readonly maxSize: number
}

export function makeEventJournal<E>(
  config: EventJournalConfig = { maxSize: 200 }
): Effect.Effect<EventJournal<E>> {
  return Effect.gen(function* () {
    const buffer = yield* Ref.make<ReadonlyArray<E>>([])
    const pubsub = yield* PubSub.unbounded<E>()

    return {
      emit: (event: E) =>
        Effect.gen(function* () {
          yield* Ref.update(buffer, (current) => {
            const next = [...current, event]
            return next.length > config.maxSize
              ? next.slice(-config.maxSize)
              : next
          })
          yield* PubSub.publish(pubsub, event)
        }),

      recent: Ref.get(buffer),

      subscribe: pubsub,
    } satisfies EventJournal<E>
  })
}
