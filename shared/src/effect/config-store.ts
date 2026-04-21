import { Effect, Ref, Scope } from "effect"
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { StateCorruptionError } from "./errors"

export interface ConfigStore<T> {
  readonly get: Effect.Effect<T, StateCorruptionError>
  readonly set: (value: T) => Effect.Effect<void, StateCorruptionError>
  readonly update: (
    f: (current: T) => T
  ) => Effect.Effect<void, StateCorruptionError>
  readonly delete: Effect.Effect<void>
}

export interface ConfigStoreJsonFileOptions<T> {
  readonly path: string
  readonly parse: (raw: string) => T
  readonly serialize: (value: T) => string
  readonly defaultValue: T
}

function readJsonFile<T>(
  path: string,
  parse: (raw: string) => T,
  defaultValue: T
): Effect.Effect<T, StateCorruptionError> {
  return Effect.try({
    try: () => {
      if (!existsSync(path)) return defaultValue
      const raw = readFileSync(path, "utf-8").trim()
      if (!raw) return defaultValue
      return parse(raw)
    },
    catch: (error) =>
      new StateCorruptionError({
        path,
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

function writeJsonFileAtomic(
  path: string,
  content: string
): Effect.Effect<void, StateCorruptionError> {
  return Effect.try({
    try: () => {
      const dir = dirname(path)
      mkdirSync(dir, { recursive: true })
      const tmpPath = join(dir, `.${Date.now()}.tmp`)
      writeFileSync(tmpPath, content)
      renameSync(tmpPath, path)
    },
    catch: (error) =>
      new StateCorruptionError({
        path,
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

function deleteFile(path: string): Effect.Effect<void> {
  return Effect.sync(() => {
    try {
      unlinkSync(path)
    } catch {}
  })
}

export function makeJsonFileConfigStore<T>(
  options: ConfigStoreJsonFileOptions<T>
): Effect.Effect<ConfigStore<T>, StateCorruptionError, Scope.Scope> {
  return Effect.gen(function* () {
    const initial = yield* readJsonFile(
      options.path,
      options.parse,
      options.defaultValue
    )
    const ref = yield* Ref.make(initial)

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref)
        yield* writeJsonFileAtomic(
          options.path,
          options.serialize(current)
        ).pipe(Effect.catchAll(() => Effect.void))
      })
    )

    const store: ConfigStore<T> = {
      get: Ref.get(ref),

      set: (value: T) =>
        Effect.gen(function* () {
          yield* Ref.set(ref, value)
          yield* writeJsonFileAtomic(options.path, options.serialize(value))
        }).pipe(
          Effect.withSpan("ConfigStore.set", {
            attributes: { path: options.path },
          })
        ),

      update: (f: (current: T) => T) =>
        Effect.gen(function* () {
          const next = yield* Ref.modify(ref, (current) => {
            const updated = f(current)
            return [updated, updated] as const
          })
          yield* writeJsonFileAtomic(options.path, options.serialize(next))
        }).pipe(
          Effect.withSpan("ConfigStore.update", {
            attributes: { path: options.path },
          })
        ),

      delete: Effect.gen(function* () {
        yield* Ref.set(ref, options.defaultValue)
        yield* deleteFile(options.path)
      }),
    }

    return store
  })
}

export function makeMemoryConfigStore<T>(
  initial: T
): Effect.Effect<ConfigStore<T>> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make(initial)

    return {
      get: Ref.get(ref),
      set: (value: T) => Ref.set(ref, value),
      update: (f: (current: T) => T) => Ref.update(ref, f),
      delete: Ref.set(ref, initial),
    } satisfies ConfigStore<T>
  })
}

export const ConfigStoreUtils = {
  jsonFile: makeJsonFileConfigStore,
  memory: makeMemoryConfigStore,
}
