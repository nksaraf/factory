/**
 * Bridge between Effect typed errors and DxError for CLI display.
 *
 * Errors self-describe via errorCode, cliMetadata, and effectiveSuggestions.
 * Adding a new error type requires zero changes to this file.
 */

import { Chunk, Effect, Exit, Cause, Option } from "effect"
import { DxError } from "../lib/dx-error.js"

interface SelfDescribingError {
  readonly _tag: string
  readonly message: string
  readonly errorCode?: string
  readonly cliMetadata?: Record<string, unknown>
  readonly effectiveSuggestions?: ReadonlyArray<{
    readonly action: string
    readonly description: string
  }>
}

export async function runEffect<A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)

  if (Exit.isSuccess(exit)) return exit.value

  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    throw typedErrorToDxError(
      failure.value as unknown as SelfDescribingError,
      operation
    )
  }

  const allDefects = Cause.defects(exit.cause)
  const firstDefect = Chunk.head(allDefects)
  if (Option.isSome(firstDefect)) {
    const err = firstDefect.value
    throw DxError.wrap(err instanceof Error ? err : new Error(String(err)), {
      operation,
    })
  }

  throw new DxError("Unexpected error", { operation })
}

function typedErrorToDxError(
  err: SelfDescribingError,
  operation: string
): DxError {
  return new DxError(err.message, {
    operation,
    code: err.errorCode ?? err._tag,
    metadata: err.cliMetadata ?? {},
    suggestions: err.effectiveSuggestions?.map((s) => ({
      action: s.action,
      description: s.description,
    })),
  })
}
