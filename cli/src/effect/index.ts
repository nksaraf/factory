/**
 * Effect TS foundation for the DX CLI.
 *
 * Public API:
 *   - runEffect()          — execute an Effect and surface failures as DxError
 *   - FactoryApi           — service tag for API calls
 *   - makeFactoryApiLayer  — live layer wrapping FactoryClient
 *   - CliConfig            — service tag for CLI configuration
 *   - makeCliConfigLayer   — live layer from a config record
 *   - Error types          — re-exported from @smp/factory-shared/effect
 */

// Bridge
export { runEffect } from "./bridge.js"

// Services
export { FactoryApi } from "./services/factory-api.js"

// Layers
export { makeFactoryApiLayer } from "./layers/factory-api.js"
export { CliConfig, makeCliConfigLayer } from "./layers/config.js"

// Error types (re-exported from shared for convenience)
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
} from "./errors.js"
