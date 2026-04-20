import { describe, expect, it } from "bun:test"
import { Effect, Duration, Fiber, Schedule, Ref, Scope } from "effect"
import { Reconciler, type ReconcilerDef } from "../effect/reconcile/reconciler"
import { createReconcilerRuntime } from "../effect/reconcile/runtime"

describe("ReconcilerRuntime", () => {
  it("enqueues and processes a work item", async () => {
    const processed: string[] = []

    const testReconciler = Reconciler.make<string, never, never>({
      name: "test",
      schedule: Schedule.spaced("1 hour"),
      keyOf: (id) => id,
      scope: Effect.succeed([]),
      reconcileOne: (id) =>
        Effect.sync(() => {
          processed.push(id)
        }),
      concurrency: 1,
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createReconcilerRuntime([testReconciler])
          const fiber = yield* runtime.run.pipe(Effect.fork)

          yield* Effect.sleep("10 millis")

          yield* runtime.enqueue(testReconciler, "item-1")
          yield* Effect.sleep("50 millis")

          expect(processed).toContain("item-1")

          yield* Fiber.interrupt(fiber)
        })
      )
    )
  })

  it("deduplicates by key", async () => {
    let callCount = 0

    const testReconciler = Reconciler.make<{ id: string }, never, never>({
      name: "dedup-test",
      schedule: Schedule.spaced("1 hour"),
      keyOf: (p) => p.id,
      scope: Effect.succeed([]),
      reconcileOne: () =>
        Effect.gen(function* () {
          callCount++
          yield* Effect.sleep("50 millis")
        }),
      concurrency: 1,
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createReconcilerRuntime([testReconciler])
          const fiber = yield* runtime.run.pipe(Effect.fork)
          yield* Effect.sleep("10 millis")

          const first = yield* runtime.enqueue(testReconciler, { id: "a" })
          const second = yield* runtime.enqueue(testReconciler, { id: "a" })

          expect(first).toBe(true)
          expect(second).toBe(false)

          yield* Effect.sleep("100 millis")
          expect(callCount).toBe(1)

          yield* Fiber.interrupt(fiber)
        })
      )
    )
  })

  it("scope tick discovers and processes items", async () => {
    const processed: string[] = []

    const testReconciler = Reconciler.make<string, never, never>({
      name: "scope-test",
      schedule: Schedule.spaced("50 millis"),
      keyOf: (id) => id,
      scope: Effect.succeed(["auto-1", "auto-2"]),
      reconcileOne: (id) =>
        Effect.sync(() => {
          processed.push(id)
        }),
      concurrency: 5,
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createReconcilerRuntime([testReconciler])
          const fiber = yield* runtime.run.pipe(Effect.fork)

          yield* Effect.sleep("150 millis")

          expect(processed).toContain("auto-1")
          expect(processed).toContain("auto-2")

          yield* Fiber.interrupt(fiber)
        })
      )
    )
  })

  it("returns status for registered reconcilers", async () => {
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

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createReconcilerRuntime([r1, r2])
          const status = yield* runtime.status

          expect(status).toHaveLength(2)
          expect(status.map((s) => s.name).sort()).toEqual(["r1", "r2"])
          expect(status[0].circuit).toBe("closed")
        })
      )
    )
  })

  it("triggerByName enqueues by reconciler name", async () => {
    const processed: string[] = []

    const testReconciler = Reconciler.make<string, never, never>({
      name: "trigger-test",
      schedule: Schedule.spaced("1 hour"),
      keyOf: (id) => id,
      scope: Effect.succeed([]),
      reconcileOne: (id) =>
        Effect.sync(() => {
          processed.push(id)
        }),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createReconcilerRuntime([testReconciler])
          const fiber = yield* runtime.run.pipe(Effect.fork)
          yield* Effect.sleep("10 millis")

          yield* runtime.triggerByName("trigger-test", "dynamic-item")
          yield* Effect.sleep("50 millis")

          expect(processed).toContain("dynamic-item")

          yield* Fiber.interrupt(fiber)
        })
      )
    )
  })
})
