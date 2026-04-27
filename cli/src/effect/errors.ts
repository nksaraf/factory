/**
 * Re-export shared Effect error types for CLI use.
 *
 * The canonical error definitions live in @smp/factory-shared/effect/errors.
 * This module re-exports them so CLI code has a single import path.
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
  StateCorruptionError,
  SshError,
  RecoverySuggestion,
  type FactoryError,
  FactoryErrorTag,
  hasTag,
} from "@smp/factory-shared/effect/errors"

export {
  ExecutorError,
  ProcessSpawnError,
  DockerNotAvailableError,
  BuildError,
  ManifestError,
  ControlPlaneLinkError,
  ComponentNotFoundError,
  CircularDependencyError,
  TunnelError,
  ConnectionError,
  ProbeFailedError,
  FinalizerTimeoutError,
  type SiteError,
} from "./errors/site.js"

import type { FactoryError } from "@smp/factory-shared/effect/errors"
import type { SiteError } from "./errors/site.js"

export type CliEffectError = FactoryError | SiteError
