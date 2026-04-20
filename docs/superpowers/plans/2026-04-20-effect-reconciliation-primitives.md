# Effect Reconciliation Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three core reconciliation primitives (`diffSets`, `reconcileSet`, `ReconcilerRuntime`) as new Effect-native code with full test coverage. No existing code is modified — this is Phase 1 (additive only, zero risk).

**Architecture:** `diffSets` is a pure function that computes create/update/orphan from two arrays. `reconcileSet` is an Effect combinator wrapping `diffSets` with typed handlers and bounded concurrency. `ReconcilerDef` is the unified reconciler type with scope/trigger/circuit-breaker, and `ReconcilerRuntime` runs all reconcilers as Effect Fibers with `Schedule`.

**Tech Stack:** Effect 3.21.1, TypeScript (tsgo), Bun test, PGlite (integration tests), existing `Db`/`query`/`createAppLayer` services.

**Spec:** `docs/superpowers/specs/2026-04-20-effect-reconciliation-framework-design.md`

---

### File Structure

| File                                                    | Responsibility                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `api/src/effect/reconcile/diff-sets.ts` (create)        | Pure `diffSets` function — three-way set diff                    |
| `api/src/effect/reconcile/reconcile-set.ts` (create)    | `reconcileSet` Effect combinator — applies diff with handlers    |
| `api/src/effect/reconcile/reconciler.ts` (create)       | `ReconcilerDef` type + `Reconciler.make` constructor             |
| `api/src/effect/reconcile/dedup-queue.ts` (create)      | `DeduplicatingQueue` — bounded Effect Queue with key-based dedup |
| `api/src/effect/reconcile/circuit-breaker.ts` (create)  | Circuit breaker state machine (Ref-based)                        |
| `api/src/effect/reconcile/runtime.ts` (create)          | `ReconcilerRuntime` — runs reconcilers as Fibers                 |
| `api/src/effect/reconcile/index.ts` (create)            | Public exports                                                   |
| `api/src/__tests__/diff-sets.test.ts` (create)          | Pure function tests for diffSets                                 |
| `api/src/__tests__/reconcile-set.test.ts` (create)      | Effect combinator tests for reconcileSet                         |
| `api/src/__tests__/dedup-queue.test.ts` (create)        | DeduplicatingQueue tests                                         |
| `api/src/__tests__/circuit-breaker.test.ts` (create)    | Circuit breaker state machine tests                              |
| `api/src/__tests__/reconciler-runtime.test.ts` (create) | Runtime integration tests with PGlite                            |
| `api/src/effect/index.ts` (modify)                      | Add reconcile module exports                                     |

---

### Task 1: `diffSets` — The Pure Primitive

**Files:**

- Create: `api/src/__tests__/diff-sets.test.ts`
- Create: `api/src/effect/reconcile/diff-sets.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// api/src/__tests__/diff-sets.test.ts
import { describe, expect, it } from "bun:test"
import { diffSets } from "../effect/reconcile/diff-sets"

describe("diffSets", () => {
  const keyOf = (item: { slug: string }) => item.slug

  it("creates items only in desired", () => {
    const diff = diffSets({
      desired: [{ slug: "a" }, { slug: "b" }],
      observed: [],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([{ slug: "a" }, { slug: "b" }])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([])
  })

  it("orphans items only in observed", () => {
    const diff = diffSets({
      desired: [],
      observed: [{ slug: "a" }, { slug: "b" }],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([{ slug: "a" }, { slug: "b" }])
  })

  it("updates items in both sets", () => {
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
  })

  it("handles empty desired and observed", () => {
    const diff = diffSets({
      desired: [],
      observed: [],
      keyOfDesired: keyOf,
      keyOfObserved: keyOf,
    })

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toOrphan).toEqual([])
  })

  it("handles duplicate keys in desired — last wins", () => {
    const diff = diffSets({
      desired: [
        { slug: "a", v: 1 },
        { slug: "a", v: 2 },
      ],
      observed: [],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o: { slug: string }) => o.slug,
    })

    expect(diff.toCreate).toHaveLength(1)
    expect((diff.toCreate[0] as any).v).toBe(2)
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

  it("handles large sets efficiently", () => {
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
    expect(elapsed).toBeLessThan(100) // should be <10ms, 100ms is generous
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test src/__tests__/diff-sets.test.ts`
Expected: FAIL — module `../effect/reconcile/diff-sets` not found

- [ ] **Step 3: Create the reconcile directory and implement diffSets**

Run: `mkdir -p api/src/effect/reconcile`

```typescript
// api/src/effect/reconcile/diff-sets.ts

export interface SetDiff<D, O> {
  readonly toCreate: ReadonlyArray<D>
  readonly toUpdate: ReadonlyArray<{
    readonly desired: D
    readonly observed: O
  }>
  readonly toOrphan: ReadonlyArray<O>
}

export interface DiffSetsOptions<D, O> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean
}

export function diffSets<D, O = D>(
  options: DiffSetsOptions<D, O>
): SetDiff<D, O> {
  const desiredByKey = new Map<string, D>()
  for (const item of options.desired) {
    desiredByKey.set(options.keyOfDesired(item), item)
  }

  const observedByKey = new Map<string, O>()
  for (const item of options.observed) {
    observedByKey.set(options.keyOfObserved(item), item)
  }

  const toCreate: D[] = []
  const toUpdate: Array<{ desired: D; observed: O }> = []
  const toOrphan: O[] = []

  for (const [key, desired] of desiredByKey) {
    const observed = observedByKey.get(key)
    if (observed === undefined) {
      toCreate.push(desired)
    } else if (!options.isEqual?.(desired, observed)) {
      toUpdate.push({ desired, observed })
    }
  }

  for (const [key, observed] of observedByKey) {
    if (!desiredByKey.has(key)) {
      toOrphan.push(observed)
    }
  }

  return { toCreate, toUpdate, toOrphan }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test src/__tests__/diff-sets.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/effect/reconcile/diff-sets.ts api/src/__tests__/diff-sets.test.ts
git commit -m "feat: add diffSets pure function for three-way set reconciliation"
```

---

### Task 2: `reconcileSet` — Effect Combinator

**Files:**

- Create: `api/src/__tests__/reconcile-set.test.ts`
- Create: `api/src/effect/reconcile/reconcile-set.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// api/src/__tests__/reconcile-set.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test src/__tests__/reconcile-set.test.ts`
Expected: FAIL — module `../effect/reconcile/reconcile-set` not found

- [ ] **Step 3: Implement reconcileSet**

```typescript
// api/src/effect/reconcile/reconcile-set.ts
import { Effect } from "effect"
import { diffSets } from "./diff-sets"

export interface ReconcileSetOptions<D, O, E, R> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean
  readonly onCreate: (item: D) => Effect.Effect<void, E, R>
  readonly onUpdate: (desired: D, observed: O) => Effect.Effect<void, E, R>
  readonly onOrphan: (item: O) => Effect.Effect<void, E, R>
  readonly concurrency?: number
}

export interface ReconcileSetResult {
  readonly created: number
  readonly updated: number
  readonly orphaned: number
  readonly skipped: number
  readonly errors: ReadonlyArray<{
    readonly key: string
    readonly phase: "create" | "update" | "orphan"
    readonly error: unknown
  }>
}

export function reconcileSet<D, O, E, R>(
  options: ReconcileSetOptions<D, O, E, R>
): Effect.Effect<ReconcileSetResult, never, R> {
  return Effect.gen(function* () {
    const diff = diffSets({
      desired: options.desired,
      observed: options.observed,
      keyOfDesired: options.keyOfDesired,
      keyOfObserved: options.keyOfObserved,
      isEqual: options.isEqual,
    })

    const concurrency = options.concurrency ?? 1
    const errors: Array<{
      key: string
      phase: "create" | "update" | "orphan"
      error: unknown
    }> = []

    // Phase 1: creates
    const createResults = yield* Effect.forEach(
      diff.toCreate,
      (item) =>
        options.onCreate(item).pipe(
          Effect.map(() => true as const),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              errors.push({
                key: options.keyOfDesired(item),
                phase: "create",
                error,
              })
              return false as const
            })
          )
        ),
      { concurrency }
    )

    // Phase 2: updates
    const updateResults = yield* Effect.forEach(
      diff.toUpdate,
      (pair) =>
        options.onUpdate(pair.desired, pair.observed).pipe(
          Effect.map(() => true as const),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              errors.push({
                key: options.keyOfDesired(pair.desired),
                phase: "update",
                error,
              })
              return false as const
            })
          )
        ),
      { concurrency }
    )

    // Phase 3: orphans
    const orphanResults = yield* Effect.forEach(
      diff.toOrphan,
      (item) =>
        options.onOrphan(item).pipe(
          Effect.map(() => true as const),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              errors.push({
                key: options.keyOfObserved(item),
                phase: "orphan",
                error,
              })
              return false as const
            })
          )
        ),
      { concurrency }
    )

    const totalDesiredKeys = new Set(options.desired.map(options.keyOfDesired))
      .size
    const skipped =
      totalDesiredKeys - diff.toCreate.length - diff.toUpdate.length

    return {
      created: createResults.filter(Boolean).length,
      updated: updateResults.filter(Boolean).length,
      orphaned: orphanResults.filter(Boolean).length,
      skipped,
      errors,
    } satisfies ReconcileSetResult
  }).pipe(Effect.withSpan("reconcileSet"))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test src/__tests__/reconcile-set.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/effect/reconcile/reconcile-set.ts api/src/__tests__/reconcile-set.test.ts
git commit -m "feat: add reconcileSet Effect combinator with bounded concurrency and error accumulation"
```

---

### Task 3: `DeduplicatingQueue` — Bounded Queue with Key Dedup

**Files:**

- Create: `api/src/__tests__/dedup-queue.test.ts`
- Create: `api/src/effect/reconcile/dedup-queue.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// api/src/__tests__/dedup-queue.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test src/__tests__/dedup-queue.test.ts`
Expected: FAIL — module `../effect/reconcile/dedup-queue` not found

- [ ] **Step 3: Implement DeduplicatingQueue**

```typescript
// api/src/effect/reconcile/dedup-queue.ts
import { Effect, Queue, Ref, Scope, HashSet } from "effect"

export interface DeduplicatingQueue<P> {
  readonly offer: (params: P) => Effect.Effect<boolean>
  readonly take: Effect.Effect<P>
  readonly size: Effect.Effect<number>
  readonly complete: (key: string) => Effect.Effect<void>
}

export function makeDeduplicatingQueue<P>(
  capacity: number,
  keyOf: (p: P) => string
): Effect.Effect<DeduplicatingQueue<P>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const queue = yield* Queue.bounded<P>(capacity)
    const keys = yield* Ref.make(HashSet.empty<string>())

    return {
      offer: (params: P) =>
        Effect.gen(function* () {
          const key = keyOf(params)
          const current = yield* Ref.get(keys)
          if (HashSet.has(current, key)) return false
          yield* Ref.update(keys, HashSet.add(key))
          yield* Queue.offer(queue, params)
          return true
        }),

      take: Effect.gen(function* () {
        const item = yield* Queue.take(queue)
        return item
      }),

      size: Queue.size(queue),

      complete: (key: string) => Ref.update(keys, HashSet.remove(key)),
    } satisfies DeduplicatingQueue<P>
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test src/__tests__/dedup-queue.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/effect/reconcile/dedup-queue.ts api/src/__tests__/dedup-queue.test.ts
git commit -m "feat: add DeduplicatingQueue with key-based dedup for reconciler work items"
```

---

### Task 4: Circuit Breaker — Ref-Based State Machine

**Files:**

- Create: `api/src/__tests__/circuit-breaker.test.ts`
- Create: `api/src/effect/reconcile/circuit-breaker.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// api/src/__tests__/circuit-breaker.test.ts
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
    // resetAfter should have doubled from 10ms to 20ms
    expect(Duration.toMillis(result.currentResetAfter)).toBe(20)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test src/__tests__/circuit-breaker.test.ts`
Expected: FAIL — module `../effect/reconcile/circuit-breaker` not found

- [ ] **Step 3: Implement CircuitBreaker**

```typescript
// api/src/effect/reconcile/circuit-breaker.ts
import { Effect, Ref, Duration } from "effect"

export interface CircuitState {
  readonly status: "closed" | "open" | "half-open"
  readonly consecutiveAllFailureTicks: number
  readonly currentResetAfter: Duration.Duration
  readonly openedAt: number | null
}

export interface CircuitBreakerConfig {
  readonly threshold: number
  readonly resetAfter: Duration.Duration
  readonly maxResetAfter: Duration.Duration
}

export interface CircuitBreaker {
  readonly state: Effect.Effect<CircuitState>
  readonly shouldProcess: Effect.Effect<boolean>
  readonly recordSuccess: Effect.Effect<void>
  readonly recordAllFailed: Effect.Effect<void>
}

export function makeCircuitBreaker(
  config: CircuitBreakerConfig
): Effect.Effect<CircuitBreaker> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<CircuitState>({
      status: "closed",
      consecutiveAllFailureTicks: 0,
      currentResetAfter: config.resetAfter,
      openedAt: null,
    })

    return {
      state: Ref.get(ref),

      shouldProcess: Effect.gen(function* () {
        const current = yield* Ref.get(ref)

        if (current.status === "closed") return true

        if (current.status === "open") {
          if (current.openedAt === null) return false
          const elapsed = Date.now() - current.openedAt
          if (elapsed < Duration.toMillis(current.currentResetAfter))
            return false

          // Transition to half-open
          yield* Ref.update(ref, (s) => ({
            ...s,
            status: "half-open" as const,
          }))
          return true
        }

        // half-open: allow one through
        return true
      }),

      recordSuccess: Ref.set(ref, {
        status: "closed",
        consecutiveAllFailureTicks: 0,
        currentResetAfter: config.resetAfter,
        openedAt: null,
      }),

      recordAllFailed: Effect.gen(function* () {
        const current = yield* Ref.get(ref)

        if (current.status === "half-open") {
          // Half-open failure → re-open with doubled reset period
          const doubled = Duration.millis(
            Math.min(
              Duration.toMillis(current.currentResetAfter) * 2,
              Duration.toMillis(config.maxResetAfter)
            )
          )
          yield* Ref.set(ref, {
            status: "open",
            consecutiveAllFailureTicks: current.consecutiveAllFailureTicks,
            currentResetAfter: doubled,
            openedAt: Date.now(),
          })
          return
        }

        const newCount = current.consecutiveAllFailureTicks + 1
        if (newCount >= config.threshold) {
          yield* Ref.set(ref, {
            status: "open",
            consecutiveAllFailureTicks: newCount,
            currentResetAfter: current.currentResetAfter,
            openedAt: Date.now(),
          })
        } else {
          yield* Ref.update(ref, (s) => ({
            ...s,
            consecutiveAllFailureTicks: newCount,
          }))
        }
      }),
    } satisfies CircuitBreaker
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test src/__tests__/circuit-breaker.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/effect/reconcile/circuit-breaker.ts api/src/__tests__/circuit-breaker.test.ts
git commit -m "feat: add circuit breaker state machine for reconciler error isolation"
```

---

### Task 5: `ReconcilerDef` Type + `Reconciler.make`

**Files:**

- Create: `api/src/effect/reconcile/reconciler.ts`

- [ ] **Step 1: Create the reconciler types and constructor**

```typescript
// api/src/effect/reconcile/reconciler.ts
import type { Effect, Schedule, Duration } from "effect"

export interface ReconcilerDef<Params, E, R> {
  readonly name: string
  readonly schedule: Schedule.Schedule<unknown>
  readonly keyOf: (params: Params) => string
  readonly scope: Effect.Effect<ReadonlyArray<Params>, E, R>
  readonly reconcileOne: (params: Params) => Effect.Effect<void, E, R>
  readonly concurrency?: number
  readonly finalize?: (key: string) => Effect.Effect<boolean, E, R>
  readonly maxRetries?: number
  readonly retrySchedule?: Schedule.Schedule<unknown>
  readonly circuitBreaker?: {
    readonly threshold: number
    readonly resetAfter: Duration.Duration
  }
}

export interface ReconcilerStatus {
  readonly name: string
  readonly circuit: "closed" | "open" | "half-open"
  readonly consecutiveFailures: number
  readonly lastRunAt: Date | null
  readonly lastResult: { processed: number; errors: number } | null
  readonly queueDepth: number
}

export const Reconciler = {
  make: <Params, E, R>(
    config: ReconcilerDef<Params, E, R>
  ): ReconcilerDef<Params, E, R> => config,
}
```

- [ ] **Step 2: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add api/src/effect/reconcile/reconciler.ts
git commit -m "feat: add ReconcilerDef type and Reconciler.make constructor"
```

---

### Task 6: `ReconcilerRuntime` — Run Reconcilers as Fibers

**Files:**

- Create: `api/src/__tests__/reconciler-runtime.test.ts`
- Create: `api/src/effect/reconcile/runtime.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// api/src/__tests__/reconciler-runtime.test.ts
import { describe, expect, it } from "bun:test"
import { Effect, Duration, Fiber, Schedule, Ref, Scope } from "effect"
import { Reconciler, type ReconcilerDef } from "../effect/reconcile/reconciler"
import { createReconcilerRuntime } from "../effect/reconcile/runtime"

describe("ReconcilerRuntime", () => {
  it("enqueues and processes a work item", async () => {
    const processed: string[] = []

    const testReconciler = Reconciler.make<string, never, never>({
      name: "test",
      schedule: Schedule.spaced("1 hour"), // won't tick in test
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

          // Give worker fiber time to start
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

          // Enqueue same key twice
          const first = yield* runtime.enqueue(testReconciler, { id: "a" })
          const second = yield* runtime.enqueue(testReconciler, { id: "a" })

          expect(first).toBe(true)
          expect(second).toBe(false) // deduped

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

          // Wait for at least one scope tick
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test src/__tests__/reconciler-runtime.test.ts`
Expected: FAIL — module `../effect/reconcile/runtime` not found

- [ ] **Step 3: Implement ReconcilerRuntime**

```typescript
// api/src/effect/reconcile/runtime.ts
import { Effect, Fiber, Queue, Ref, Schedule, Scope, Duration } from "effect"
import type { ReconcilerDef, ReconcilerStatus } from "./reconciler"
import { makeDeduplicatingQueue, type DeduplicatingQueue } from "./dedup-queue"
import { makeCircuitBreaker, type CircuitBreaker } from "./circuit-breaker"

export interface ReconcilerRuntime {
  readonly run: Effect.Effect<never>
  readonly enqueue: <P>(
    reconciler: ReconcilerDef<P, any, any>,
    params: P
  ) => Effect.Effect<boolean>
  readonly triggerByName: (
    name: string,
    params: unknown
  ) => Effect.Effect<boolean>
  readonly triggerAll: (name: string) => Effect.Effect<void>
  readonly status: Effect.Effect<ReadonlyArray<ReconcilerStatus>>
}

interface ReconcilerEntry {
  readonly def: ReconcilerDef<any, any, any>
  readonly queue: DeduplicatingQueue<any>
  readonly circuitBreaker: CircuitBreaker
  readonly lastRunAt: Ref.Ref<Date | null>
  readonly lastResult: Ref.Ref<{ processed: number; errors: number } | null>
}

export function createReconcilerRuntime(
  reconcilers: ReconcilerDef<any, any, any>[]
): Effect.Effect<ReconcilerRuntime, never, Scope.Scope> {
  return Effect.gen(function* () {
    const entries = new Map<string, ReconcilerEntry>()

    for (const def of reconcilers) {
      const queue = yield* makeDeduplicatingQueue(1000, def.keyOf)
      const circuitBreaker = yield* makeCircuitBreaker({
        threshold: def.circuitBreaker?.threshold ?? 5,
        resetAfter: def.circuitBreaker?.resetAfter ?? Duration.minutes(1),
        maxResetAfter: Duration.minutes(10),
      })
      const lastRunAt = yield* Ref.make<Date | null>(null)
      const lastResult = yield* Ref.make<{
        processed: number
        errors: number
      } | null>(null)

      entries.set(def.name, {
        def,
        queue,
        circuitBreaker,
        lastRunAt,
        lastResult,
      })
    }

    const processKey = (entry: ReconcilerEntry, params: unknown) =>
      entry.def.reconcileOne(params).pipe(
        Effect.retry(
          entry.def.retrySchedule ??
            Schedule.exponential("1 second").pipe(
              Schedule.intersect(Schedule.recurs(entry.def.maxRetries ?? 3)),
              Schedule.jittered
            )
        ),
        Effect.catchAll((error) =>
          Effect.logError("reconcileOne failed", {
            reconciler: entry.def.name,
            key: entry.def.keyOf(params),
            error,
          })
        ),
        Effect.map(() => true as const),
        Effect.catchAllDefect((defect) =>
          Effect.gen(function* () {
            yield* Effect.logError("reconcileOne defect", {
              reconciler: entry.def.name,
              key: entry.def.keyOf(params),
              defect,
            })
            return false as const
          })
        )
      )

    const runWorker = (entry: ReconcilerEntry): Effect.Effect<never> =>
      Effect.gen(function* () {
        while (true) {
          const params = yield* entry.queue.take
          const key = entry.def.keyOf(params)

          const canProcess = yield* entry.circuitBreaker.shouldProcess
          if (!canProcess) {
            yield* entry.queue.complete(key)
            continue
          }

          const success = yield* processKey(entry, params)
          yield* entry.queue.complete(key)

          if (success) {
            yield* entry.circuitBreaker.recordSuccess
          }
        }
      })

    const runScopeTick = (entry: ReconcilerEntry) =>
      entry.def.scope.pipe(
        Effect.flatMap((items) =>
          Effect.forEach(items, (item) => entry.queue.offer(item), {
            concurrency: "unbounded",
          })
        ),
        Effect.tap(() => Ref.set(entry.lastRunAt, new Date())),
        Effect.catchAll((error) =>
          Effect.logError("scope failed", { reconciler: entry.def.name, error })
        )
      )

    const runSchedule = (entry: ReconcilerEntry): Effect.Effect<never> =>
      Effect.repeat(
        Effect.gen(function* () {
          const canProcess = yield* entry.circuitBreaker.shouldProcess
          if (!canProcess) return

          yield* runScopeTick(entry)
        }),
        entry.def.schedule
      ) as Effect.Effect<never>

    const runtime: ReconcilerRuntime = {
      run: Effect.gen(function* () {
        const fibers: Fiber.Fiber<never>[] = []

        for (const entry of entries.values()) {
          // Worker fiber: drains queue
          const workerFiber = yield* Effect.fork(runWorker(entry))
          fibers.push(workerFiber)

          // Schedule fiber: periodic scope discovery
          const scheduleFiber = yield* Effect.fork(runSchedule(entry))
          fibers.push(scheduleFiber)
        }

        // Block forever — fibers run until interrupted
        yield* Effect.never
      }),

      enqueue: <P>(reconciler: ReconcilerDef<P, any, any>, params: P) => {
        const entry = entries.get(reconciler.name)
        if (!entry) return Effect.succeed(false)
        return entry.queue.offer(params)
      },

      triggerByName: (name: string, params: unknown) => {
        const entry = entries.get(name)
        if (!entry) return Effect.succeed(false)
        return entry.queue.offer(params)
      },

      triggerAll: (name: string) => {
        const entry = entries.get(name)
        if (!entry) return Effect.void
        return runScopeTick(entry).pipe(Effect.asVoid)
      },

      status: Effect.gen(function* () {
        const result: ReconcilerStatus[] = []
        for (const [name, entry] of entries) {
          const cbState = yield* entry.circuitBreaker.state
          const depth = yield* entry.queue.size
          const lastRun = yield* Ref.get(entry.lastRunAt)
          const lastRes = yield* Ref.get(entry.lastResult)
          result.push({
            name,
            circuit: cbState.status,
            consecutiveFailures: cbState.consecutiveAllFailureTicks,
            lastRunAt: lastRun,
            lastResult: lastRes,
            queueDepth: depth,
          })
        }
        return result
      }),
    }

    return runtime
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test src/__tests__/reconciler-runtime.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/effect/reconcile/runtime.ts api/src/__tests__/reconciler-runtime.test.ts
git commit -m "feat: add ReconcilerRuntime — runs reconcilers as Effect Fibers with Schedule"
```

---

### Task 7: Public Exports + Index

**Files:**

- Create: `api/src/effect/reconcile/index.ts`
- Modify: `api/src/effect/index.ts`

- [ ] **Step 1: Create the reconcile module index**

```typescript
// api/src/effect/reconcile/index.ts

// Pure primitive
export { diffSets, type SetDiff, type DiffSetsOptions } from "./diff-sets"

// Effect combinator
export {
  reconcileSet,
  type ReconcileSetOptions,
  type ReconcileSetResult,
} from "./reconcile-set"

// Reconciler definition
export {
  Reconciler,
  type ReconcilerDef,
  type ReconcilerStatus,
} from "./reconciler"

// Runtime
export { createReconcilerRuntime, type ReconcilerRuntime } from "./runtime"

// Internal (exported for testing/advanced use)
export { makeDeduplicatingQueue, type DeduplicatingQueue } from "./dedup-queue"
export {
  makeCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from "./circuit-breaker"
```

- [ ] **Step 2: Add reconcile exports to the main Effect index**

Add the following to the end of `api/src/effect/index.ts`:

```typescript
// Reconciliation framework
export {
  diffSets,
  reconcileSet,
  Reconciler,
  createReconcilerRuntime,
  type SetDiff,
  type ReconcileSetResult,
  type ReconcilerDef,
  type ReconcilerRuntime,
  type ReconcilerStatus,
} from "./reconcile/index"
```

- [ ] **Step 3: Type check**

Run: `cd api && tsgo --noEmit`
Expected: No new errors

- [ ] **Step 4: Run full test suite to ensure nothing is broken**

Run: `cd api && pnpm test`
Expected: All existing tests PASS, plus the 4 new test files PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/effect/reconcile/index.ts api/src/effect/index.ts
git commit -m "feat: export reconciliation framework from Effect module"
```

---

## Verification

After all tasks are complete:

1. **Type check:** `cd api && tsgo --noEmit` — no errors
2. **diffSets tests:** `cd api && bun test src/__tests__/diff-sets.test.ts` — 9 tests pass
3. **reconcileSet tests:** `cd api && bun test src/__tests__/reconcile-set.test.ts` — 8 tests pass
4. **DeduplicatingQueue tests:** `cd api && bun test src/__tests__/dedup-queue.test.ts` — 5 tests pass
5. **CircuitBreaker tests:** `cd api && bun test src/__tests__/circuit-breaker.test.ts` — 9 tests pass
6. **ReconcilerRuntime tests:** `cd api && bun test src/__tests__/reconciler-runtime.test.ts` — 5 tests pass
7. **Full suite:** `cd api && pnpm test` ��� all existing tests continue passing
8. **Import check:** Verify `import { diffSets, reconcileSet, Reconciler, createReconcilerRuntime } from "../effect"` works from any file in `api/src/`
