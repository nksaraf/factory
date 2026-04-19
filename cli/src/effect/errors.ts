/**
 * Re-export shared Effect error types for CLI use.
 *
 * The canonical error definitions live in @smp/factory-shared/effect/errors.
 * This module re-exports them so CLI code has a single import path, and adds
 * the CliEffectError union type for the bridge.
 */

export {
  EntityNotFoundError,
  EntityConflictError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ApiUnreachableError,
  RateLimitError,
  ExternalServiceError,
  SubprocessError,
  ConfigurationError,
  QuotaExceededError,
  TimeoutError,
  RecoverySuggestion,
  type FactoryError,
  FactoryErrorTag,
  hasTag,
} from "@smp/factory-shared/effect/errors"

import type { FactoryError } from "@smp/factory-shared/effect/errors"

/** Union of all typed CLI errors — same as shared FactoryError. */
export type CliEffectError = FactoryError
