import { describe, expect, it } from "bun:test"
import { Effect, Fiber, Ref, Schedule, Scope } from "effect"
import { Reconciler } from "../effect/reconcile/reconciler"
import { createReconcilerRuntime } from "../effect/reconcile/runtime"

const runScoped = <A>(effect: Effect.Effect<A, never, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

describe("ReconcilerRuntime", () => {
  it("enqueues and processes a work item", async () => {
    await runScoped(
      Effect.gen(function* () {
        const processed = yield* Ref.make<string[]>([])

        const r = Reconciler.make<string, never, never>({
          name: "test",
          schedule: Schedule.spaced("1 hour"),
          keyOf: (id) => id,
          scope: Effect.succeed([]),
          reconcileOne: (id) => Ref.update(processed, (arr) => [...arr, id]),
          concurrency: 1,
          maxRetries: 0,
        })

        const runtime = yield* createReconcilerRuntime([r])
        const fiber = yield* Effect.forkScoped(runtime.run)

        yield* Effect.sleep("20 millis")

        yield* runtime.enqueue(r, "item-1")
        yield* Effect.sleep("100 millis")

        const result = yield* Ref.get(processed)
        expect(result).toContain("item-1")

        yield* Fiber.interrupt(fiber)
      })
    )
  })

  it("deduplicates by key", async () => {
    await runScoped(
      Effect.gen(function* () {
        let callCount = 0

        const r = Reconciler.make<{ id: string }, never, never>({
          name: "dedup",
          schedule: Schedule.spaced("1 hour"),
          keyOf: (p) => p.id,
          scope: Effect.succeed([]),
          reconcileOne: () =>
            Effect.gen(function* () {
              callCount++
              yield* Effect.sleep("100 millis")
            }),
          concurrency: 1,
          maxRetries: 0,
        })

        const runtime = yield* createReconcilerRuntime([r])
        const fiber = yield* Effect.forkScoped(runtime.run)
        yield* Effect.sleep("20 millis")

        const first = yield* runtime.enqueue(r, { id: "a" })
        const second = yield* runtime.enqueue(r, { id: "a" })

        expect(first).toBe(true)
        expect(second).toBe(false)

        yield* Effect.sleep("200 millis")
        expect(callCount).toBe(1)

        yield* Fiber.interrupt(fiber)
      })
    )
  })

  it("scope tick discovers and processes items", async () => {
    await runScoped(
      Effect.gen(function* () {
        const processed = yield* Ref.make<string[]>([])

        const r = Reconciler.make<string, never, never>({
          name: "scope-test",
          schedule: Schedule.spaced("50 millis"),
          keyOf: (id) => id,
          scope: Effect.succeed(["auto-1", "auto-2"]),
          reconcileOne: (id) => Ref.update(processed, (arr) => [...arr, id]),
          concurrency: 5,
          maxRetries: 0,
        })

        const runtime = yield* createReconcilerRuntime([r])
        const fiber = yield* Effect.forkScoped(runtime.run)

        yield* Effect.sleep("250 millis")

        const result = yield* Ref.get(processed)
        expect(result).toContain("auto-1")
        expect(result).toContain("auto-2")

        yield* Fiber.interrupt(fiber)
      })
    )
  })

  it("returns status for registered reconcilers", async () => {
    await runScoped(
      Effect.gen(function* () {
        const r1 = Reconciler.make<string, never, never>({
          name: "r1",
          schedule: Schedule.spaced("1 hour"),
          keyOf: (id) => id,
          scope: Effect.succeed([]),
          reconcileOne: () => Effect.void,
        })
        const r2 = Reconciler.make<string, never, never>({
          name: "r2",
          schedule: Schedule.spaced("1 hour"),
          keyOf: (id) => id,
          scope: Effect.succeed([]),
          reconcileOne: () => Effect.void,
        })

        const runtime = yield* createReconcilerRuntime([r1, r2])
        const status = yield* runtime.status

        expect(status).toHaveLength(2)
        expect(status.map((s) => s.name).sort()).toEqual(["r1", "r2"])
        expect(status[0].circuit).toBe("closed")
        expect(status[1].circuit).toBe("closed")
      })
    )
  })

  it("triggerByName enqueues by reconciler name", async () => {
    await runScoped(
      Effect.gen(function* () {
        const processed = yield* Ref.make<string[]>([])

        const r = Reconciler.make<string, never, never>({
          name: "trigger-test",
          schedule: Schedule.spaced("1 hour"),
          keyOf: (id) => id,
          scope: Effect.succeed([]),
          reconcileOne: (id) => Ref.update(processed, (arr) => [...arr, id]),
          concurrency: 1,
          maxRetries: 0,
        })

        const runtime = yield* createReconcilerRuntime([r])
        const fiber = yield* Effect.forkScoped(runtime.run)
        yield* Effect.sleep("20 millis")

        yield* runtime.triggerByName("trigger-test", "dynamic-item")
        yield* Effect.sleep("100 millis")

        const result = yield* Ref.get(processed)
        expect(result).toContain("dynamic-item")

        yield* Fiber.interrupt(fiber)
      })
    )
  })
})
