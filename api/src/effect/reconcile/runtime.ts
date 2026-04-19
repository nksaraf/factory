import { Effect, Fiber, Ref, Schedule, Scope, Duration } from "effect"
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

interface ReconcilerHandle {
  readonly def: ReconcilerDef<any, any, any>
  readonly queue: DeduplicatingQueue<any>
  readonly cb: CircuitBreaker
  readonly lastRunAt: Ref.Ref<Date | null>
  readonly lastResult: Ref.Ref<{ processed: number; errors: number } | null>
}

export function createReconcilerRuntime(
  reconcilers: ReconcilerDef<any, any, any>[]
): Effect.Effect<ReconcilerRuntime, never, Scope.Scope> {
  return Effect.gen(function* () {
    const handles = new Map<string, ReconcilerHandle>()

    for (const def of reconcilers) {
      const queue = yield* makeDeduplicatingQueue(1000, def.keyOf)
      const cb = yield* makeCircuitBreaker({
        threshold: def.circuitBreaker?.threshold ?? 5,
        resetAfter: def.circuitBreaker?.resetAfter ?? Duration.minutes(1),
        maxResetAfter: Duration.minutes(10),
      })
      const lastRunAt = yield* Ref.make<Date | null>(null)
      const lastResult = yield* Ref.make<{
        processed: number
        errors: number
      } | null>(null)

      handles.set(def.name, { def, queue, cb, lastRunAt, lastResult })
    }

    const processKey = (handle: ReconcilerHandle, params: unknown) =>
      handle.def.reconcileOne(params).pipe(
        Effect.retry(
          handle.def.retrySchedule ??
            Schedule.exponential("100 millis").pipe(
              Schedule.intersect(Schedule.recurs(handle.def.maxRetries ?? 3)),
              Schedule.jittered
            )
        ),
        Effect.map(() => true as const),
        Effect.catchAll(() => Effect.succeed(false as const))
      )

    const runWorker = (handle: ReconcilerHandle): Effect.Effect<never> =>
      Effect.forever(
        Effect.gen(function* () {
          const params = yield* handle.queue.take
          const key = handle.def.keyOf(params)

          const canProcess = yield* handle.cb.shouldProcess
          if (!canProcess) {
            yield* handle.queue.complete(key)
            return
          }

          const success = yield* processKey(handle, params)
          yield* handle.queue.complete(key)

          if (success) {
            yield* handle.cb.recordSuccess
          }
        })
      )

    const runScopeTick = (handle: ReconcilerHandle) =>
      Effect.gen(function* () {
        yield* Ref.set(handle.lastRunAt, new Date())
        const items = yield* handle.def.scope
        yield* Effect.forEach(items, (item) => handle.queue.offer(item), {
          concurrency: "unbounded",
        })
      }).pipe(Effect.catchAll(() => Effect.void))

    const runSchedule = (handle: ReconcilerHandle): Effect.Effect<unknown> =>
      Effect.repeat(runScopeTick(handle), handle.def.schedule)

    const runtime: ReconcilerRuntime = {
      run: Effect.gen(function* () {
        for (const handle of handles.values()) {
          yield* Effect.forkScoped(runWorker(handle))
          yield* Effect.forkScoped(runSchedule(handle))
        }
        yield* Effect.never
      }),

      enqueue: <P>(reconciler: ReconcilerDef<P, any, any>, params: P) => {
        const handle = handles.get(reconciler.name)
        if (!handle) return Effect.succeed(false)
        return handle.queue.offer(params)
      },

      triggerByName: (name: string, params: unknown) => {
        const handle = handles.get(name)
        if (!handle) return Effect.succeed(false)
        return handle.queue.offer(params)
      },

      triggerAll: (name: string) => {
        const handle = handles.get(name)
        if (!handle) return Effect.void
        return runScopeTick(handle).pipe(Effect.asVoid)
      },

      status: Effect.gen(function* () {
        const result: ReconcilerStatus[] = []
        for (const [name, handle] of handles) {
          const cbState = yield* handle.cb.state
          const depth = yield* handle.queue.size
          const lastRun = yield* Ref.get(handle.lastRunAt)
          const lastRes = yield* Ref.get(handle.lastResult)
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
