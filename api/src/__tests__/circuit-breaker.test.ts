import { describe, expect, it } from "bun:test"
import { Effect, Duration, Ref } from "effect"
import {
  makeCircuitBreaker,
  type CircuitState,
  type CircuitBreakerConfig,
} from "../effect/reconcile/circuit-breaker"

const defaultConfig: CircuitBreakerConfig = {
  threshold: 3,
  resetAfter: Duration.seconds(1),
  maxResetAfter: Duration.seconds(10),
}

describe("CircuitBreaker", () => {
  it("starts in closed state", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        return yield* cb.state
      })
    )

    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(0)
  })

  it("stays closed when recordSuccess is called", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordSuccess
        return yield* cb.state
      })
    )

    expect(result.status).toBe("closed")
  })

  it("stays closed when failures < threshold", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        return yield* cb.state
      })
    )

    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(2)
  })

  it("opens when failures reach threshold", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        return yield* cb.state
      })
    )

    expect(result.status).toBe("open")
    expect(result.consecutiveAllFailureTicks).toBe(3)
  })

  it("resets consecutive failures on success", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        yield* cb.recordSuccess
        return yield* cb.state
      })
    )

    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(0)
  })

  it("shouldProcess returns false when open (before reset period)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        yield* cb.recordAllFailed
        return yield* cb.shouldProcess
      })
    )

    expect(result).toBe(false)
  })

  it("transitions to half-open after reset period", async () => {
    const shortConfig: CircuitBreakerConfig = {
      threshold: 1,
      resetAfter: Duration.millis(50),
      maxResetAfter: Duration.seconds(10),
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(shortConfig)
        yield* cb.recordAllFailed
        const stateBeforeSleep = yield* cb.state
        expect(stateBeforeSleep.status).toBe("open")

        yield* Effect.sleep("60 millis")
        const canProcess = yield* cb.shouldProcess
        const stateAfterSleep = yield* cb.state

        return { canProcess, state: stateAfterSleep }
      })
    )

    expect(result.canProcess).toBe(true)
    expect(result.state.status).toBe("half-open")
  })

  it("half-open → closed on success", async () => {
    const shortConfig: CircuitBreakerConfig = {
      threshold: 1,
      resetAfter: Duration.millis(10),
      maxResetAfter: Duration.seconds(10),
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(shortConfig)
        yield* cb.recordAllFailed
        yield* Effect.sleep("20 millis")
        yield* cb.shouldProcess // transitions to half-open
        yield* cb.recordSuccess
        return yield* cb.state
      })
    )

    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(0)
  })

  it("half-open → open on failure (doubles reset period)", async () => {
    const shortConfig: CircuitBreakerConfig = {
      threshold: 1,
      resetAfter: Duration.millis(10),
      maxResetAfter: Duration.seconds(10),
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(shortConfig)
        yield* cb.recordAllFailed
        yield* Effect.sleep("20 millis")
        yield* cb.shouldProcess // transitions to half-open
        yield* cb.recordAllFailed // back to open
        return yield* cb.state
      })
    )

    expect(result.status).toBe("open")
    expect(Duration.toMillis(result.currentResetAfter)).toBe(20)
  })
})
