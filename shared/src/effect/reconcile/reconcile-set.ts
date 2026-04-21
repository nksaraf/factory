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
