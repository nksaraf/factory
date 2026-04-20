import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  reconcileSet,
  type ReconcileSetResult,
} from "../effect/reconcile/reconcile-set"

describe("reconcileSet", () => {
  it("calls onCreate for items only in desired", async () => {
    const created: string[] = []

    const result = await Effect.runPromise(
      reconcileSet({
        desired: [{ slug: "a" }, { slug: "b" }],
        observed: [],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o: { slug: string }) => o.slug,
        onCreate: (d) =>
          Effect.sync(() => {
            created.push(d.slug)
          }),
        onUpdate: () => Effect.void,
        onOrphan: () => Effect.void,
      })
    )

    expect(created).toEqual(["a", "b"])
    expect(result.created).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.orphaned).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("calls onUpdate for items in both sets", async () => {
    const updated: Array<{ d: number; o: number }> = []

    const result = await Effect.runPromise(
      reconcileSet({
        desired: [{ slug: "a", v: 2 }],
        observed: [{ slug: "a", v: 1 }],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o) => o.slug,
        onCreate: () => Effect.void,
        onUpdate: (d, o) =>
          Effect.sync(() => {
            updated.push({ d: d.v, o: o.v })
          }),
        onOrphan: () => Effect.void,
      })
    )

    expect(updated).toEqual([{ d: 2, o: 1 }])
    expect(result.updated).toBe(1)
  })

  it("calls onOrphan for items only in observed", async () => {
    const orphaned: string[] = []

    const result = await Effect.runPromise(
      reconcileSet({
        desired: [],
        observed: [{ slug: "stale" }],
        keyOfDesired: (d: { slug: string }) => d.slug,
        keyOfObserved: (o) => o.slug,
        onCreate: () => Effect.void,
        onUpdate: () => Effect.void,
        onOrphan: (o) =>
          Effect.sync(() => {
            orphaned.push(o.slug)
          }),
      })
    )

    expect(orphaned).toEqual(["stale"])
    expect(result.orphaned).toBe(1)
  })

  it("handles all three cases in one call", async () => {
    const log: string[] = []

    const result = await Effect.runPromise(
      reconcileSet({
        desired: [{ slug: "keep" }, { slug: "new" }],
        observed: [{ slug: "keep" }, { slug: "old" }],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o) => o.slug,
        onCreate: (d) =>
          Effect.sync(() => {
            log.push(`create:${d.slug}`)
          }),
        onUpdate: (d) =>
          Effect.sync(() => {
            log.push(`update:${d.slug}`)
          }),
        onOrphan: (o) =>
          Effect.sync(() => {
            log.push(`orphan:${o.slug}`)
          }),
      })
    )

    expect(log).toContain("create:new")
    expect(log).toContain("update:keep")
    expect(log).toContain("orphan:old")
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.orphaned).toBe(1)
  })

  it("captures per-item errors without stopping the loop", async () => {
    const result = await Effect.runPromise(
      reconcileSet({
        desired: [{ slug: "good" }, { slug: "bad" }],
        observed: [{ slug: "stale" }],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o) => o.slug,
        onCreate: (d) =>
          d.slug === "bad"
            ? Effect.fail(new Error("create failed"))
            : Effect.void,
        onUpdate: () => Effect.void,
        onOrphan: () => Effect.fail(new Error("orphan failed")),
      })
    )

    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toMatchObject({ key: "bad", phase: "create" })
    expect(result.errors[1]).toMatchObject({ key: "stale", phase: "orphan" })
  })

  it("respects isEqual — skips updates for equal items", async () => {
    const log: string[] = []

    const result = await Effect.runPromise(
      reconcileSet({
        desired: [
          { slug: "a", v: 1 },
          { slug: "b", v: 2 },
        ],
        observed: [
          { slug: "a", v: 1 },
          { slug: "b", v: 1 },
        ],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o) => o.slug,
        isEqual: (d, o) => d.v === o.v,
        onCreate: () => Effect.void,
        onUpdate: (d) =>
          Effect.sync(() => {
            log.push(d.slug)
          }),
        onOrphan: () => Effect.void,
      })
    )

    expect(log).toEqual(["b"])
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it("runs with bounded concurrency", async () => {
    let maxConcurrent = 0
    let current = 0

    const result = await Effect.runPromise(
      reconcileSet({
        desired: Array.from({ length: 20 }, (_, i) => ({ slug: `item-${i}` })),
        observed: [],
        keyOfDesired: (d) => d.slug,
        keyOfObserved: (o: { slug: string }) => o.slug,
        onCreate: () =>
          Effect.gen(function* () {
            current++
            if (current > maxConcurrent) maxConcurrent = current
            yield* Effect.sleep("1 millis")
            current--
          }),
        onUpdate: () => Effect.void,
        onOrphan: () => Effect.void,
        concurrency: 5,
      })
    )

    expect(result.created).toBe(20)
    expect(maxConcurrent).toBeLessThanOrEqual(5)
  })

  it("works with empty desired and observed", async () => {
    const result = await Effect.runPromise(
      reconcileSet({
        desired: [],
        observed: [],
        keyOfDesired: (d: { slug: string }) => d.slug,
        keyOfObserved: (o: { slug: string }) => o.slug,
        onCreate: () => Effect.void,
        onUpdate: () => Effect.void,
        onOrphan: () => Effect.void,
      })
    )

    expect(result.created).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.orphaned).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
  })
})
