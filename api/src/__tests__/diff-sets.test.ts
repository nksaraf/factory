import { describe, expect, it } from "bun:test"
import { diffSets } from "../effect/reconcile/diff-sets"

describe("diffSets", () => {
  const keyOf = (item: { slug: string }) => item.slug

  it("creates items only in desired", () => {
    const diff = diffSets({
      desired: [{ slug: "a" }, { slug: "b" }],
      observed: [] as { slug: string }[],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([{ slug: "a" }, { slug: "b" }])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([])
    expect(diff.skipped).toEqual([])
  })

  it("orphans items only in observed", () => {
    const diff = diffSets({
      desired: [] as { slug: string }[],
      observed: [{ slug: "a" }, { slug: "b" }],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([{ slug: "a" }, { slug: "b" }])
  })

  it("updates items in both sets (no isEqual)", () => {
    const diff = diffSets({
      desired: [{ slug: "a", version: 2 }],
      observed: [{ slug: "a", version: 1 }],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([
      {
        desired: { slug: "a", version: 2 },
        observed: { slug: "a", version: 1 },
      },
    ])
    expect(diff.toOrphan).toEqual([])
  })

  it("handles all three cases in one call", () => {
    const diff = diffSets({
      desired: [{ slug: "keep" }, { slug: "new" }],
      observed: [{ slug: "keep" }, { slug: "old" }],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([{ slug: "new" }])
    expect(diff.toUpdate).toHaveLength(1)
    expect(diff.toUpdate[0].desired.slug).toBe("keep")
    expect(diff.toOrphan).toEqual([{ slug: "old" }])
  })

  it("skips updates when isEqual returns true", () => {
    const diff = diffSets({
      desired: [{ slug: "a", v: 1 }],
      observed: [{ slug: "a", v: 1 }],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
      isEqual: (d, o) => d.v === o.v,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([])
    expect(diff.skipped).toHaveLength(1)
    expect(diff.skipped[0].desired.v).toBe(1)
  })

  it("includes updates when isEqual returns false", () => {
    const diff = diffSets({
      desired: [{ slug: "a", v: 2 }],
      observed: [{ slug: "a", v: 1 }],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
      isEqual: (d, o) => d.v === o.v,
    })

    expect(diff.toUpdate).toHaveLength(1)
    expect(diff.skipped).toEqual([])
  })

  it("handles empty desired and observed", () => {
    const diff = diffSets({
      desired: [] as { slug: string }[],
      observed: [] as { slug: string }[],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([])
    expect(diff.skipped).toEqual([])
  })

  it("handles duplicate keys in desired — last wins", () => {
    const diff = diffSets({
      desired: [
        { slug: "a", v: 1 },
        { slug: "a", v: 2 },
      ],
      observed: [] as { slug: string; v: number }[],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
    })

    expect(diff.toCreate).toHaveLength(1)
    expect((diff.toCreate[0] as any).v).toBe(2)
  })

  it("handles duplicate keys in observed — last wins", () => {
    const diff = diffSets({
      desired: [{ slug: "a", v: 3 }],
      observed: [
        { slug: "a", v: 1 },
        { slug: "a", v: 2 },
      ],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
    })

    expect(diff.toUpdate).toHaveLength(1)
    expect(diff.toUpdate[0].observed.v).toBe(2)
  })

  it("supports different types for desired and observed", () => {
    interface Desired {
      name: string
      image: string
    }
    interface Observed {
      name: string
      image: string
      id: string
    }

    const diff = diffSets<Desired, Observed>({
      desired: [{ name: "api", image: "v2" }],
      observed: [{ name: "api", image: "v1", id: "cmp_123" }],
      keyOfDesired: (d) => d.name,
      keyOfObserved: (o) => o.name,
    })

    expect(diff.toUpdate).toHaveLength(1)
    expect(diff.toUpdate[0].desired.image).toBe("v2")
    expect(diff.toUpdate[0].observed.id).toBe("cmp_123")
  })

  it("handles large sets efficiently (10k items, <500ms)", () => {
    const desired = Array.from({ length: 10_000 }, (_, i) => ({
      slug: `item-${i}`,
    }))
    const observed = Array.from({ length: 10_000 }, (_, i) => ({
      slug: `item-${i + 5000}`,
    }))

    const start = performance.now()
    const diff = diffSets({
      desired,
      observed,
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })
    const elapsed = performance.now() - start

    expect(diff.toCreate).toHaveLength(5_000)
    expect(diff.toUpdate).toHaveLength(5_000)
    expect(diff.toOrphan).toHaveLength(5_000)
    expect(elapsed).toBeLessThan(500)
  })
})
