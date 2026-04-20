import { describe, expect, it } from "bun:test"
import { Effect, Scope } from "effect"
import { makeDeduplicatingQueue } from "../effect/reconcile/dedup-queue"

const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

describe("DeduplicatingQueue", () => {
  it("offers and takes items", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ id: string }>(10, (p) => p.id)
        const offered = yield* q.offer({ id: "a" })
        expect(offered).toBe(true)

        const item = yield* q.take
        expect(item.id).toBe("a")
      })
    )
  })

  it("deduplicates by key — second offer returns false", async () => {
    await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ id: string }>(10, (p) => p.id)
        const first = yield* q.offer({ id: "a" })
        const second = yield* q.offer({ id: "a" })

        expect(first).toBe(true)
        expect(second).toBe(false)

        const size = yield* q.size
        expect(size).toBe(1)
      })
    )
  })

  it("allows re-enqueue after complete", async () => {
    await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ id: string }>(10, (p) => p.id)
        yield* q.offer({ id: "a" })
        yield* q.take
        yield* q.complete("a")

        const reOffered = yield* q.offer({ id: "a" })
        expect(reOffered).toBe(true)
      })
    )
  })

  it("tracks size correctly", async () => {
    await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ id: string }>(10, (p) => p.id)
        expect(yield* q.size).toBe(0)

        yield* q.offer({ id: "a" })
        yield* q.offer({ id: "b" })
        expect(yield* q.size).toBe(2)

        yield* q.take
        expect(yield* q.size).toBe(1)
      })
    )
  })

  it("handles different items with different keys", async () => {
    await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ id: string; v: number }>(
          10,
          (p) => p.id
        )
        yield* q.offer({ id: "a", v: 1 })
        yield* q.offer({ id: "b", v: 2 })
        yield* q.offer({ id: "c", v: 3 })

        expect(yield* q.size).toBe(3)

        const first = yield* q.take
        const second = yield* q.take
        const third = yield* q.take

        const ids = [first.id, second.id, third.id].sort()
        expect(ids).toEqual(["a", "b", "c"])
      })
    )
  })
})
