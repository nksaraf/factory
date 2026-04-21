import { Effect, Fiber, Queue, Ref, Schedule, Scope, Duration } from "effect"
import type { ReconcilerDef, ReconcilerStatus } from "./reconciler"
import { makeDeduplicatingQueue, type DeduplicatingQueue } from "./dedup-queue"
import { makeCircuitBreaker, type CircuitBreaker } from "./circuit-breaker"

export interface ReconcilerRuntime {
  readonly run: Effect.Effect<never, never, never>
  readonly enqueue: <P>(
    reconciler: ReconcilerDef<P, any, any>,
    params: P
  ) => Effect.Effect<boolean, never, never>
  readonly triggerByName: (
    name: string,
    params: unknown
  ) => Effect.Effect<boolean, never, never>
  readonly triggerAll: (name: string) => Effect.Effect<void, never, never>
  readonly status: Effect.Effect<ReadonlyArray<ReconcilerStatus>, never, never>
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
          Effect.gen(function* () {
            yield* Effect.logError("reconcileOne failed").pipe(
              Effect.annotateLogs({
                reconciler: entry.def.name,
                key: entry.def.keyOf(params),
                error: String(error),
              })
            )
            return false as const
          })
        ),
        Effect.map(() => true as const),
        Effect.catchAllDefect((defect) =>
          Effect.gen(function* () {
            yield* Effect.logError("reconcileOne defect").pipe(
              Effect.annotateLogs({
                reconciler: entry.def.name,
                key: entry.def.keyOf(params),
                defect: String(defect),
              })
            )
            return false as const
          })
        )
      )

    const runWorker = (entry: ReconcilerEntry) =>
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
      }) as Effect.Effect<never>

    const runScopeTick = (entry: ReconcilerEntry) =>
      entry.def.scope.pipe(
        Effect.flatMap((items) =>
          Effect.forEach(items, (item) => entry.queue.offer(item), {
            concurrency: "unbounded",
          })
        ),
        Effect.tap(() => Ref.set(entry.lastRunAt, new Date())),
        Effect.catchAll((error) =>
          Effect.logError("scope failed").pipe(
            Effect.annotateLogs({
              reconciler: entry.def.name,
              error: String(error),
            })
          )
        )
      )

    const runSchedule = (entry: ReconcilerEntry) =>
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
        for (const entry of entries.values()) {
          yield* Effect.fork(runWorker(entry))
          yield* Effect.fork(runSchedule(entry))
        }

        return yield* Effect.never
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
        return runScopeTick(entry).pipe(Effect.asVoid) as Effect.Effect<
          void,
          never,
          never
        >
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
