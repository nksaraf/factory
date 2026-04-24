import { describe, test, expect } from "bun:test"
import { Effect, Fiber, PubSub, Queue, Ref, Duration } from "effect"
import { makeHealthProbe } from "./health-probe"

describe("HealthProbe", () => {
  test("latest starts null", async () => {
    const program = Effect.gen(function* () {
      const probe = yield* makeHealthProbe({
        check: Effect.succeed({ status: "ok" }),
        interval: Duration.seconds(60),
      })
      const latest = yield* probe.latest
      expect(latest).toBeNull()
    })

    await Effect.runPromise(program)
  })

  test("fiber runs check and updates latest", async () => {
    const counter = { value: 0 }

    const program = Effect.gen(function* () {
      const probe = yield* makeHealthProbe({
        check: Effect.sync(() => {
          counter.value++
          return { count: counter.value }
        }),
        interval: Duration.millis(50),
      })

      const fiber = yield* Effect.fork(probe.fiber)
      yield* Effect.sleep(Duration.millis(180))
      yield* Fiber.interrupt(fiber)

      const latest = yield* probe.latest
      expect(latest).not.toBeNull()
      expect(latest!.count).toBeGreaterThanOrEqual(2)
    })

    await Effect.runPromise(program)
  })

  test("publishes snapshots to PubSub", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeHealthProbe({
          check: Effect.succeed("healthy"),
          interval: Duration.millis(50),
        })

        const dequeue = yield* PubSub.subscribe(probe.changes)
        const fiber = yield* Effect.fork(probe.fiber)

        yield* Effect.sleep(Duration.millis(120))
        const size = yield* Queue.size(dequeue)
        expect(size).toBeGreaterThanOrEqual(1)

        const first = yield* Queue.take(dequeue)
        expect(first).toBe("healthy")

        yield* Fiber.interrupt(fiber)
      })
    )

    await Effect.runPromise(program)
  })

  test("calls onCheck callback on each snapshot", async () => {
    const snapshots: string[] = []

    const program = Effect.gen(function* () {
      const probe = yield* makeHealthProbe({
        check: Effect.succeed("ok"),
        interval: Duration.millis(50),
        onCheck: (s) =>
          Effect.sync(() => {
            snapshots.push(s)
          }),
      })

      const fiber = yield* Effect.fork(probe.fiber)
      yield* Effect.sleep(Duration.millis(180))
      yield* Fiber.interrupt(fiber)

      expect(snapshots.length).toBeGreaterThanOrEqual(2)
      expect(snapshots[0]).toBe("ok")
    })

    await Effect.runPromise(program)
  })

  test("handles check failures gracefully", async () => {
    let callCount = 0

    const program = Effect.gen(function* () {
      const probe = yield* makeHealthProbe({
        check: Effect.sync(() => {
          callCount++
          if (callCount === 1) throw new Error("check-error")
          return { ok: true }
        }),
        interval: Duration.millis(50),
      })

      const fiber = yield* Effect.fork(probe.fiber)
      yield* Effect.sleep(Duration.millis(180))
      yield* Fiber.interrupt(fiber)

      const latest = yield* probe.latest
      expect(latest).not.toBeNull()
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    await Effect.runPromise(program)
  })
})
