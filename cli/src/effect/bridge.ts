/**
 * Bridge between Effect typed errors and DxError for CLI display.
 *
 * `runEffect` executes an Effect program and converts any typed failure
 * into a DxError that the top-level CLI handler already knows how to render
 * (context, suggestions, cause chain, --verbose stack).
 */

import { Chunk, Effect, Exit, Cause, Option } from "effect"
import { DxError, type DxErrorContext } from "../lib/dx-error.js"
import { ErrorRegistry } from "../errors.js"
import type { FactoryError } from "@smp/factory-shared/effect/errors"

/**
 * Run an Effect that may fail with a tagged error and surface failures as
 * DxError instances that the existing CLI renderer understands.
 */
export async function runEffect<A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)

  if (Exit.isSuccess(exit)) return exit.value

  // Expected (typed) failure
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    throw effectErrorToDxError(
      failure.value as unknown as FactoryError,
      operation
    )
  }

  // Defects (unexpected / untyped errors)
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

// ---------------------------------------------------------------------------
// Internal: tag → DxError mapping
// ---------------------------------------------------------------------------

function registrySuggestions(code: string): DxErrorContext["suggestions"] {
  return ErrorRegistry[code]?.suggestions ?? []
}

function effectErrorToDxError(err: FactoryError, operation: string): DxError {
  switch (err._tag) {
    case "EntityNotFoundError": {
      return new DxError(err.message, {
        operation,
        code: "NOT_FOUND",
        metadata: { entity: err.entity, identifier: err.identifier },
        suggestions: registrySuggestions("NOT_FOUND"),
      })
    }

    case "EntityConflictError": {
      return new DxError(err.message, {
        operation,
        code: "CONFLICT",
        metadata: { entity: err.entity, identifier: err.identifier },
      })
    }

    case "AuthenticationError": {
      return new DxError(err.message, {
        operation,
        code: "AUTH_DENIED",
        suggestions: registrySuggestions("AUTH_DENIED"),
      })
    }

    case "AuthorizationError": {
      return new DxError(err.message, {
        operation,
        code: "AUTH_DENIED",
        metadata: { action: err.action, resource: err.resource },
        suggestions: registrySuggestions("AUTH_DENIED"),
      })
    }

    case "ApiUnreachableError": {
      return new DxError(err.message, {
        operation,
        code: "API_UNREACHABLE",
        metadata: { url: err.url },
        suggestions: registrySuggestions("API_UNREACHABLE"),
      })
    }

    case "ExternalServiceError": {
      return new DxError(err.message, {
        operation,
        code: "EXTERNAL_SERVICE_ERROR",
        metadata: {
          service: err.service,
          serviceOperation: err.operation,
          ...(err.statusCode != null ? { statusCode: err.statusCode } : {}),
        },
      })
    }

    case "SubprocessError": {
      return new DxError(err.message, {
        operation,
        code: "SUBPROCESS_ERROR",
        metadata: {
          command: err.command,
          exitCode: err.exitCode,
          ...(err.stderr ? { stderr: err.stderr } : {}),
        },
        suggestions: [
          {
            action: "re-run with --verbose",
            description: "See full subprocess output for details",
          },
        ],
      })
    }

    case "ValidationError": {
      return new DxError(err.message, {
        operation,
        code: "VALIDATION_ERROR",
        metadata: {
          field: err.field,
          ...(err.value !== undefined ? { value: String(err.value) } : {}),
        },
      })
    }

    case "ConfigurationError": {
      return new DxError(err.message, {
        operation,
        code: "CONFIGURATION_ERROR",
        metadata: { key: err.key },
        suggestions: [
          {
            action: "dx config",
            description: "Review and update configuration",
          },
        ],
      })
    }

    case "TimeoutError": {
      return new DxError(err.message, {
        operation,
        code: "TIMEOUT",
        metadata: {
          timedOutOperation: err.operation,
          durationMs: err.durationMs,
        },
        suggestions: [
          {
            action: "retry",
            description: `The operation "${err.operation}" exceeded ${err.durationMs}ms — try again or check connectivity`,
          },
        ],
      })
    }

    case "RateLimitError": {
      return new DxError(err.message, {
        operation,
        code: "RATE_LIMIT",
        metadata: { retryAfterMs: err.retryAfterMs },
        suggestions: [
          {
            action: "wait and retry",
            description: `Rate limited — retry after ${err.retryAfterMs}ms`,
          },
        ],
      })
    }

    case "QuotaExceededError": {
      return new DxError(err.message, {
        operation,
        code: "QUOTA_EXCEEDED",
        metadata: {
          resource: err.resource,
          current: err.current,
          maximum: err.maximum,
        },
      })
    }

    default: {
      const unknown = err as { readonly _tag: string; message?: string }
      return new DxError(unknown.message ?? `Effect error: ${unknown._tag}`, {
        operation,
      })
    }
  }
}
