import { describe, expect, it } from "bun:test"
import { Effect, Scope } from "effect"
import { makeDeduplicatingQueue } from "../effect/reconcile/dedup-queue"

const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

describe("DeduplicatingQueue", () => {
  it("offers and takes items", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ key: string; value: number }>(
          10,
          (p) => p.key
        )
        yield* q.offer({ key: "a", value: 1 })
        const item = yield* q.take
        return item
      })
    )
    expect(result).toEqual({ key: "a", value: 1 })
  })

  it("deduplicates by key — second offer returns false", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ key: string }>(
          10,
          (p) => p.key
        )
        const first = yield* q.offer({ key: "dup" })
        const second = yield* q.offer({ key: "dup" })
        const sz = yield* q.size
        return { first, second, sz }
      })
    )
    expect(result.first).toBe(true)
    expect(result.second).toBe(false)
    expect(result.sz).toBe(1)
  })

  it("allows re-enqueue after complete", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ key: string }>(
          10,
          (p) => p.key
        )
        yield* q.offer({ key: "x" })
        yield* q.take
        yield* q.complete("x")
        const reoffered = yield* q.offer({ key: "x" })
        return reoffered
      })
    )
    expect(result).toBe(true)
  })

  it("tracks size correctly", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ key: string }>(
          10,
          (p) => p.key
        )
        yield* q.offer({ key: "a" })
        yield* q.offer({ key: "b" })
        const sizeAfterTwo = yield* q.size
        yield* q.take
        const sizeAfterOne = yield* q.size
        return { sizeAfterTwo, sizeAfterOne }
      })
    )
    expect(result.sizeAfterTwo).toBe(2)
    expect(result.sizeAfterOne).toBe(1)
  })

  it("handles different items with different keys", async () => {
    const result = await runScoped(
      Effect.gen(function* () {
        const q = yield* makeDeduplicatingQueue<{ key: string; v: number }>(
          10,
          (p) => p.key
        )
        yield* q.offer({ key: "a", v: 1 })
        yield* q.offer({ key: "b", v: 2 })
        yield* q.offer({ key: "c", v: 3 })
        const item1 = yield* q.take
        const item2 = yield* q.take
        const item3 = yield* q.take
        return [item1.key, item2.key, item3.key].sort()
      })
    )
    expect(result).toEqual(["a", "b", "c"])
  })
})
