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
    const initialState: CircuitState = {
      status: "closed",
      consecutiveAllFailureTicks: 0,
      currentResetAfter: config.resetAfter,
      openedAt: null,
    }

    const ref = yield* Ref.make(initialState)

    const state: Effect.Effect<CircuitState> = Ref.get(ref)

    const shouldProcess: Effect.Effect<boolean> = Effect.gen(function* () {
      const current = yield* Ref.get(ref)

      if (current.status === "closed") {
        return true
      }

      if (current.status === "half-open") {
        return true
      }

      // status === "open": check if reset period has elapsed
      if (current.openedAt !== null) {
        const elapsed = Date.now() - current.openedAt
        const resetMs = Duration.toMillis(current.currentResetAfter)
        if (elapsed >= resetMs) {
          // Transition to half-open
          yield* Ref.update(ref, (s) => ({
            ...s,
            status: "half-open" as const,
          }))
          return true
        }
      }

      return false
    })

    const recordSuccess: Effect.Effect<void> = Ref.update(ref, (s) => ({
      ...s,
      status: "closed" as const,
      consecutiveAllFailureTicks: 0,
      currentResetAfter: config.resetAfter,
      openedAt: null,
    }))

    const recordAllFailed: Effect.Effect<void> = Ref.update(ref, (s) => {
      const newCount = s.consecutiveAllFailureTicks + 1

      if (s.status === "half-open") {
        // half-open → open, double the reset period (capped at maxResetAfter)
        const doubledMs = Math.min(
          Duration.toMillis(s.currentResetAfter) * 2,
          Duration.toMillis(config.maxResetAfter)
        )
        return {
          ...s,
          status: "open" as const,
          consecutiveAllFailureTicks: newCount,
          currentResetAfter: Duration.millis(doubledMs),
          openedAt: Date.now(),
        }
      }

      if (newCount >= config.threshold) {
        // closed → open
        return {
          ...s,
          status: "open" as const,
          consecutiveAllFailureTicks: newCount,
          openedAt: Date.now(),
        }
      }

      // still closed, just increment counter
      return {
        ...s,
        consecutiveAllFailureTicks: newCount,
      }
    })

    return { state, shouldProcess, recordSuccess, recordAllFailed }
  })
}
