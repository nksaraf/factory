/**
 * Effect TS foundation for the DX CLI.
 *
 * Public API:
 *   - runEffect()          — execute an Effect and surface failures as DxError
 *   - FactoryApi           — service tag for API calls
 *   - makeFactoryApiLayer  — live layer wrapping FactoryClient
 *   - CliConfig            — service tag for CLI configuration
 *   - makeCliConfigLayer   — live layer from a config record
 *   - RemoteAccess         — resolve slug/IP → AccessTarget with transport + caching
 *   - RemoteExec           — run commands on AccessTarget with SSH diagnostics
 *   - ContainerInspector   — docker inspect on target host, cached ContainerMap
 *   - Error types          — re-exported from @smp/factory-shared/effect
 */

// Bridge
export { runEffect } from "./bridge.js"

// Services
export { FactoryApi } from "./services/factory-api.js"
export {
  RemoteAccess,
  RemoteAccessLive,
  type AccessTarget,
  type Transport,
  type SshTransport,
  type KubectlTransport,
  type LocalTransport,
  JumpHop,
} from "./services/remote-access.js"
export {
  RemoteExec,
  RemoteExecLive,
  execLocal,
  type ExecResult,
} from "./services/remote-exec.js"
export {
  ContainerInspector,
  ContainerInspectorLive,
  type ContainerEntry,
  type ContainerMap,
} from "./services/container-inspector.js"

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
  SshError,
  RecoverySuggestion,
  type FactoryError,
  FactoryErrorTag,
  hasTag,
} from "./errors.js"
