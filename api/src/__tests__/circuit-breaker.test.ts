import { describe, expect, it } from "bun:test"
import { Effect, Duration } from "effect"
import { makeCircuitBreaker } from "../effect/reconcile/circuit-breaker"

const defaultConfig = {
  threshold: 3,
  resetAfter: Duration.millis(100),
  maxResetAfter: Duration.millis(1000),
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
    expect(result.openedAt).toBeNull()
  })

  it("stays closed when recordSuccess is called", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(defaultConfig)
        yield* cb.recordSuccess
        yield* cb.recordSuccess
        return yield* cb.state
      })
    )
    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(0)
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
    expect(result.openedAt).not.toBeNull()
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
    const config = {
      threshold: 1,
      resetAfter: Duration.millis(50),
      maxResetAfter: Duration.millis(1000),
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(config)
        yield* cb.recordAllFailed
        // Wait for resetAfter to elapse
        yield* Effect.sleep(Duration.millis(80))
        const canProcess = yield* cb.shouldProcess
        const state = yield* cb.state
        return { canProcess, status: state.status }
      })
    )
    expect(result.canProcess).toBe(true)
    expect(result.status).toBe("half-open")
  })

  it("transitions half-open → closed on success", async () => {
    const config = {
      threshold: 1,
      resetAfter: Duration.millis(50),
      maxResetAfter: Duration.millis(1000),
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(config)
        yield* cb.recordAllFailed
        yield* Effect.sleep(Duration.millis(80))
        // Trigger transition to half-open
        yield* cb.shouldProcess
        yield* cb.recordSuccess
        return yield* cb.state
      })
    )
    expect(result.status).toBe("closed")
    expect(result.consecutiveAllFailureTicks).toBe(0)
    expect(result.openedAt).toBeNull()
  })

  it("transitions half-open → open on failure (doubles reset period)", async () => {
    const config = {
      threshold: 1,
      resetAfter: Duration.millis(50),
      maxResetAfter: Duration.millis(1000),
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const cb = yield* makeCircuitBreaker(config)
        yield* cb.recordAllFailed
        yield* Effect.sleep(Duration.millis(80))
        // Trigger transition to half-open
        yield* cb.shouldProcess
        yield* cb.recordAllFailed
        return yield* cb.state
      })
    )
    expect(result.status).toBe("open")
    // currentResetAfter should be doubled: 50ms * 2 = 100ms
    expect(Duration.toMillis(result.currentResetAfter)).toBe(100)
  })
})
