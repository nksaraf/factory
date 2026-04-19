import { describe, expect, test } from "bun:test"
import { diffSets } from "../effect/reconcile/diff-sets"

describe("diffSets", () => {
  test("creates items only in desired", () => {
    type Item = { id: string; name: string }
    const result = diffSets<Item, Item>({
      desired: [
        { id: "a", name: "Alice" },
        { id: "b", name: "Bob" },
      ],
      observed: [],
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    expect(result.toCreate).toEqual([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ])
    expect(result.toUpdate).toEqual([])
    expect(result.toOrphan).toEqual([])
  })

  test("orphans items only in observed", () => {
    type Item = { id: string; value: number }
    const result = diffSets<Item, Item>({
      desired: [],
      observed: [
        { id: "x", value: 1 },
        { id: "y", value: 2 },
      ],
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
    expect(result.toOrphan).toEqual([
      { id: "x", value: 1 },
      { id: "y", value: 2 },
    ])
  })

  test("updates items in both sets", () => {
    const desired = [{ id: "a", name: "Alice-updated" }]
    const observed = [{ id: "a", name: "Alice" }]
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([
      { desired: desired[0], observed: observed[0] },
    ])
    expect(result.toOrphan).toEqual([])
  })

  test("handles all three cases in one call", () => {
    const desired = [
      { id: "create-me", val: "new" },
      { id: "update-me", val: "updated" },
    ]
    const observed = [
      { id: "update-me", val: "old" },
      { id: "orphan-me", val: "stale" },
    ]
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    expect(result.toCreate).toEqual([{ id: "create-me", val: "new" }])
    expect(result.toUpdate).toEqual([
      { desired: desired[1], observed: observed[0] },
    ])
    expect(result.toOrphan).toEqual([{ id: "orphan-me", val: "stale" }])
  })

  test("skips updates when isEqual returns true", () => {
    const desired = [{ id: "a", name: "Alice" }]
    const observed = [{ id: "a", name: "Alice" }]
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
      isEqual: (d, o) => d.name === o.name,
    })
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
    expect(result.toOrphan).toEqual([])
  })

  test("includes updates when isEqual returns false", () => {
    const desired = [{ id: "a", name: "Alice-v2" }]
    const observed = [{ id: "a", name: "Alice" }]
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
      isEqual: (d, o) => d.name === o.name,
    })
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([
      { desired: desired[0], observed: observed[0] },
    ])
    expect(result.toOrphan).toEqual([])
  })

  test("handles empty desired and observed", () => {
    const result = diffSets<string, string>({
      desired: [],
      observed: [],
      keyOfDesired: (d) => d,
      keyOfObserved: (o) => o,
    })
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
    expect(result.toOrphan).toEqual([])
  })

  test("handles duplicate keys in desired — last wins", () => {
    const desired = [
      { id: "a", name: "first" },
      { id: "a", name: "last" },
    ]
    const observed = [{ id: "a", name: "observed" }]
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    // last wins: "last" should be the one in toUpdate
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toHaveLength(1)
    expect(result.toUpdate[0]?.desired.name).toBe("last")
    expect(result.toOrphan).toEqual([])
  })

  test("supports different types for desired and observed", () => {
    type Desired = { slug: string; targetCount: number }
    type Observed = { name: string; currentCount: number }

    const desired: Desired[] = [
      { slug: "web", targetCount: 3 },
      { slug: "worker", targetCount: 1 },
    ]
    const observed: Observed[] = [
      { name: "web", currentCount: 2 },
      { name: "db", currentCount: 1 },
    ]

    const result = diffSets<Desired, Observed>({
      desired,
      observed,
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.name,
    })

    expect(result.toCreate).toEqual([{ slug: "worker", targetCount: 1 }])
    expect(result.toUpdate).toEqual([
      { desired: desired[0], observed: observed[0] },
    ])
    expect(result.toOrphan).toEqual([{ name: "db", currentCount: 1 }])
  })

  test("handles large sets efficiently (10k items, <100ms)", () => {
    const N = 10_000
    // First half overlap (updates), second half only in desired (creates), first quarter of observed also has extras (orphans)
    const desired = Array.from({ length: N }, (_, i) => ({
      id: `item-${i}`,
      v: i,
    }))
    const observed = Array.from({ length: N / 2 }, (_, i) => ({
      id: `item-${i}`,
      v: i - 1,
    })).concat(
      Array.from({ length: N / 4 }, (_, i) => ({ id: `orphan-${i}`, v: i }))
    )

    const start = performance.now()
    const result = diffSets({
      desired,
      observed,
      keyOfDesired: (d) => d.id,
      keyOfObserved: (o) => o.id,
    })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100)
    expect(result.toCreate).toHaveLength(N / 2)
    expect(result.toUpdate).toHaveLength(N / 2)
    expect(result.toOrphan).toHaveLength(N / 4)
  })
})
