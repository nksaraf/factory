import { Effect, Ref, Duration } from "effect"

export interface CircuitState {
  readonly status: "closed" | "open" | "half-open"
  readonly consecutiveAllFailureTicks: number
  readonly currentResetAfter: Duration.Duration
  readonly openedAt: number | null
}

export interface CircuitBreakerConfig {
  readonly threshold: number
  readonly resetAfter: Duration.Duration
  readonly maxResetAfter: Duration.Duration
}

export interface CircuitBreaker {
  readonly state: Effect.Effect<CircuitState>
  readonly shouldProcess: Effect.Effect<boolean>
  readonly recordSuccess: Effect.Effect<void>
  readonly recordAllFailed: Effect.Effect<void>
}

export function makeCircuitBreaker(
  config: CircuitBreakerConfig
): Effect.Effect<CircuitBreaker> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<CircuitState>({
      status: "closed",
      consecutiveAllFailureTicks: 0,
      currentResetAfter: config.resetAfter,
      openedAt: null,
    })

    return {
      state: Ref.get(ref),

      shouldProcess: Effect.gen(function* () {
        const current = yield* Ref.get(ref)

        if (current.status === "closed") return true

        if (current.status === "open") {
          if (current.openedAt === null) return false
          const elapsed = Date.now() - current.openedAt
          if (elapsed < Duration.toMillis(current.currentResetAfter))
            return false

          // Transition to half-open
          yield* Ref.update(ref, (s) => ({
            ...s,
            status: "half-open" as const,
          }))
          return true
        }

        // half-open: allow one through
        return true
      }),

      recordSuccess: Ref.set(ref, {
        status: "closed",
        consecutiveAllFailureTicks: 0,
        currentResetAfter: config.resetAfter,
        openedAt: null,
      }),

      recordAllFailed: Effect.gen(function* () {
        const current = yield* Ref.get(ref)

        if (current.status === "half-open") {
          const doubled = Duration.millis(
            Math.min(
              Duration.toMillis(current.currentResetAfter) * 2,
              Duration.toMillis(config.maxResetAfter)
            )
          )
          yield* Ref.set(ref, {
            status: "open",
            consecutiveAllFailureTicks: current.consecutiveAllFailureTicks,
            currentResetAfter: doubled,
            openedAt: Date.now(),
          })
          return
        }

        const newCount = current.consecutiveAllFailureTicks + 1
        if (newCount >= config.threshold) {
          yield* Ref.set(ref, {
            status: "open",
            consecutiveAllFailureTicks: newCount,
            currentResetAfter: current.currentResetAfter,
            openedAt: Date.now(),
          })
        } else {
          yield* Ref.update(ref, (s) => ({
            ...s,
            consecutiveAllFailureTicks: newCount,
          }))
        }
      }),
    } satisfies CircuitBreaker
  })
}
