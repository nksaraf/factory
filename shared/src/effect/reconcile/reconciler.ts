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
