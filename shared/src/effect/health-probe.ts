import { Effect, Exit, PubSub, Ref, Schedule, Duration } from "effect"

export interface HealthProbeConfig<S> {
  readonly check: Effect.Effect<S>
  readonly interval: Duration.DurationInput
  readonly onCheck?: (snapshot: S) => Effect.Effect<void>
}

export interface HealthProbe<S> {
  readonly latest: Effect.Effect<S | null>
  readonly changes: PubSub.PubSub<S>
  readonly fiber: Effect.Effect<never>
}

export function makeHealthProbe<S>(
  config: HealthProbeConfig<S>
): Effect.Effect<HealthProbe<S>> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<S | null>(null)
    const pubsub = yield* PubSub.unbounded<S>()

    const checkOnce = Effect.gen(function* () {
      const exit = yield* Effect.exit(config.check)

      if (Exit.isFailure(exit)) {
        yield* Effect.logWarning("Health probe check failed")
        return
      }

      const snapshot = exit.value
      yield* Ref.set(ref, snapshot)
      yield* PubSub.publish(pubsub, snapshot)

      if (config.onCheck) {
        yield* config.onCheck(snapshot).pipe(Effect.catchAll(() => Effect.void))
      }
    }).pipe(Effect.withSpan("HealthProbe.checkCycle"))

    const fiber = checkOnce.pipe(
      Effect.repeat(Schedule.spaced(config.interval))
    ) as Effect.Effect<never>

    return {
      latest: Ref.get(ref),
      changes: pubsub,
      fiber,
    } satisfies HealthProbe<S>
  })
}
