/**
 * Bridge between Effect typed errors and the existing AppError hierarchy.
 *
 * `runEffect` executes an Effect program and, on failure, translates the
 * typed error (identified by `_tag`) into the corresponding AppError
 * subclass so the Elysia error-handler plugin continues to work unchanged.
 */

import { Effect, Exit, Cause, Option, Chunk } from "effect"
import type { FactoryError } from "@smp/factory-shared/effect/errors"
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  InternalError,
  ServiceUnavailableError,
} from "../lib/errors"

class RateLimitAppError extends AppError {
  readonly status = 429 as const
  readonly code = "rate_limit" as const
}

function toAppError(error: {
  readonly _tag: string
  readonly message?: string
  readonly [key: string]: unknown
}): AppError {
  const msg = typeof error.message === "string" ? error.message : error._tag

  switch (error._tag) {
    case "EntityNotFoundError":
      return new NotFoundError(msg)
    case "EntityConflictError":
      return new ConflictError(msg)
    case "DatabaseError": {
      const variant = (error as { variant?: string }).variant
      switch (variant) {
        case "unique_violation":
          return new ConflictError(msg, {
            constraint: (error as any).constraint,
          })
        case "foreign_key_violation":
        case "check_violation":
        case "not_null_violation":
          return new ValidationError(msg, {
            constraint: (error as any).constraint,
          })
        case "serialization_failure":
        case "deadlock":
        case "connection_failed":
        case "timeout":
          return new ServiceUnavailableError(msg)
        default:
          return new InternalError(msg)
      }
    }
    case "ValidationError":
      return new ValidationError(msg)
    case "AuthenticationError":
      return new UnauthorizedError(msg)
    case "AuthorizationError":
      return new ForbiddenError(msg)
    case "ExternalServiceError":
    case "TimeoutError":
    case "ApiUnreachableError":
    case "SubprocessError":
      return new ServiceUnavailableError(msg)
    case "RateLimitError":
    case "QuotaExceededError":
      return new RateLimitAppError(msg)
    case "ConfigurationError":
      return new InternalError(msg)
    case "DnsApiError":
      return new ServiceUnavailableError(msg)
    case "DnsAuthError":
      return new UnauthorizedError(msg)
    case "DnsZoneNotFoundError":
      return new NotFoundError(msg)
    case "SecretDecryptionError":
      return new InternalError(msg)
    default:
      return new InternalError(msg)
  }
}

/**
 * Run an Effect and translate typed errors into thrown AppError instances.
 *
 * The effect must have all dependencies already provided (`R = never`).
 * On success the resolved value is returned; on failure the error's `_tag`
 * is mapped to the appropriate AppError subclass and thrown.
 */
export async function runEffect<A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)

  if (Exit.isSuccess(exit)) return exit.value

  // Expected (typed) failure
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    throw toAppError(failure.value)
  }

  // Defects (unexpected errors) — wrap as InternalError
  const allDefects = Cause.defects(exit.cause)
  const firstDefect = Chunk.head(allDefects)
  if (Option.isSome(firstDefect)) {
    const err = firstDefect.value
    throw err instanceof AppError
      ? err
      : new InternalError(err instanceof Error ? err.message : String(err))
  }

  throw new InternalError("Unexpected internal error")
}
