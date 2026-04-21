import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Recovery suggestions
// ---------------------------------------------------------------------------

export class RecoverySuggestion extends Schema.Class<RecoverySuggestion>(
  "RecoverySuggestion"
)({
  action: Schema.String,
  description: Schema.String,
  command: Schema.optional(Schema.String),
  agentActionable: Schema.optional(Schema.Boolean),
}) {}

const Suggestions = Schema.optional(Schema.Array(RecoverySuggestion))

function suggest(
  action: string,
  description: string,
  opts?: { command?: string; agentActionable?: boolean }
): RecoverySuggestion {
  return new RecoverySuggestion({ action, description, ...opts })
}

export const CommonSuggestions = {
  rerunVerbose: () =>
    suggest("re-run with --verbose", "See full output for details"),
  checkStatus: () =>
    suggest("dx status", "Check environment health", { agentActionable: true }),
  checkConfig: () =>
    suggest("dx config", "Review and update configuration", {
      agentActionable: true,
    }),
  login: () =>
    suggest("dx auth login", "Re-authenticate with Factory", {
      agentActionable: true,
    }),
  checkConnectivity: () =>
    suggest("dx status", "Check service connectivity", {
      agentActionable: true,
    }),
  healState: () =>
    suggest("dx sync", "Heal local state", { agentActionable: true }),
}

// ---------------------------------------------------------------------------
// Entity errors
// ---------------------------------------------------------------------------

export class EntityNotFoundError extends Schema.TaggedError<EntityNotFoundError>()(
  "EntityNotFoundError",
  {
    entity: Schema.String,
    identifier: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `${this.entity} not found: ${this.identifier}`
  }

  get httpStatus(): number {
    return 404
  }

  get errorCode(): string {
    return "NOT_FOUND"
  }

  get cliMetadata(): Record<string, unknown> {
    return { entity: this.entity, identifier: this.identifier }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest("list", `List ${this.entity} resources to validate names`, {
          agentActionable: true,
        }),
      ]
    )
  }
}

export class EntityConflictError extends Schema.TaggedError<EntityConflictError>()(
  "EntityConflictError",
  {
    entity: Schema.String,
    identifier: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `${this.entity} already exists: ${this.identifier}`
  }

  get httpStatus(): number {
    return 409
  }

  get errorCode(): string {
    return "CONFLICT"
  }

  get cliMetadata(): Record<string, unknown> {
    return { entity: this.entity, identifier: this.identifier }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest("list", `Check existing ${this.entity} resources`, {
          agentActionable: true,
        }),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  {
    field: Schema.String,
    reason: Schema.String,
    value: Schema.optional(Schema.Unknown),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Validation failed on "${this.field}": ${this.reason}`
  }

  get httpStatus(): number {
    return 422
  }

  get errorCode(): string {
    return "VALIDATION_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      field: this.field,
      ...(this.value !== undefined ? { value: String(this.value) } : {}),
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? []
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  {
    reason: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Authentication failed: ${this.reason}`
  }

  get httpStatus(): number {
    return 401
  }

  get errorCode(): string {
    return "AUTH_DENIED"
  }

  get cliMetadata(): Record<string, unknown> {
    return {}
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        CommonSuggestions.login(),
        suggest("dx whoami", "Verify stored session", {
          agentActionable: true,
        }),
      ]
    )
  }
}

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()(
  "AuthorizationError",
  {
    action: Schema.String,
    resource: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Not authorized to ${this.action} on ${this.resource}`
  }

  get httpStatus(): number {
    return 403
  }

  get errorCode(): string {
    return "AUTH_DENIED"
  }

  get cliMetadata(): Record<string, unknown> {
    return { action: this.action, resource: this.resource }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.login()]
  }
}

// ---------------------------------------------------------------------------
// Network / external
// ---------------------------------------------------------------------------

export class ApiUnreachableError extends Schema.TaggedError<ApiUnreachableError>()(
  "ApiUnreachableError",
  {
    url: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `API unreachable at ${this.url}${suffix}`
  }

  get httpStatus(): number {
    return 502
  }

  get errorCode(): string {
    return "API_UNREACHABLE"
  }

  get cliMetadata(): Record<string, unknown> {
    return { url: this.url }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        CommonSuggestions.checkStatus(),
        suggest(`curl -sS ${this.url}/health`, "Test API endpoint directly", {
          agentActionable: true,
        }),
      ]
    )
  }
}

export class RateLimitError extends Schema.TaggedError<RateLimitError>()(
  "RateLimitError",
  {
    retryAfterMs: Schema.Number,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Rate limit exceeded, retry after ${this.retryAfterMs}ms`
  }

  get httpStatus(): number {
    return 429
  }

  get errorCode(): string {
    return "RATE_LIMIT"
  }

  get cliMetadata(): Record<string, unknown> {
    return { retryAfterMs: this.retryAfterMs }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(
          "wait and retry",
          `Rate limited — retry after ${this.retryAfterMs}ms`
        ),
      ]
    )
  }
}

export class ExternalServiceError extends Schema.TaggedError<ExternalServiceError>()(
  "ExternalServiceError",
  {
    service: Schema.String,
    operation: Schema.String,
    statusCode: Schema.optional(Schema.Number),
    responseBody: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const status = this.statusCode ? ` (${this.statusCode})` : ""
    return `External service "${this.service}" failed on ${this.operation}${status}`
  }

  get httpStatus(): number {
    return 502
  }

  get errorCode(): string {
    return "EXTERNAL_SERVICE_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      service: this.service,
      serviceOperation: this.operation,
      ...(this.statusCode != null ? { statusCode: this.statusCode } : {}),
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.checkConnectivity()]
  }
}

// ---------------------------------------------------------------------------
// Process / system
// ---------------------------------------------------------------------------

export class SubprocessError extends Schema.TaggedError<SubprocessError>()(
  "SubprocessError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
    stdout: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const detail = this.stderr ? `: ${this.stderr.slice(0, 200)}` : ""
    return `Command "${this.command}" exited with code ${this.exitCode}${detail}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "SUBPROCESS_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      command: this.command,
      exitCode: this.exitCode,
      ...(this.stderr ? { stderr: this.stderr } : {}),
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.rerunVerbose()]
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    key: Schema.String,
    reason: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Configuration error for "${this.key}": ${this.reason}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "CONFIGURATION_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return { key: this.key }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.checkConfig()]
  }
}

// ---------------------------------------------------------------------------
// Quota / limits
// ---------------------------------------------------------------------------

export class QuotaExceededError extends Schema.TaggedError<QuotaExceededError>()(
  "QuotaExceededError",
  {
    resource: Schema.String,
    current: Schema.Number,
    maximum: Schema.Number,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Quota exceeded for ${this.resource}: ${this.current}/${this.maximum}`
  }

  get httpStatus(): number {
    return 429
  }

  get errorCode(): string {
    return "QUOTA_EXCEEDED"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      resource: this.resource,
      current: this.current,
      maximum: this.maximum,
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? []
  }
}

// ---------------------------------------------------------------------------
// State / persistence
// ---------------------------------------------------------------------------

export class StateCorruptionError extends Schema.TaggedError<StateCorruptionError>()(
  "StateCorruptionError",
  {
    path: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `State file corrupted at ${this.path}${suffix}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "STATE_CORRUPTION"
  }

  get cliMetadata(): Record<string, unknown> {
    return { path: this.path }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        CommonSuggestions.healState(),
        suggest(
          `rm ${this.path} && dx dev`,
          "Delete corrupted state and restart",
          { agentActionable: true }
        ),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

export class TimeoutError extends Schema.TaggedError<TimeoutError>()(
  "TimeoutError",
  {
    operation: Schema.String,
    durationMs: Schema.Number,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Operation "${this.operation}" timed out after ${this.durationMs}ms`
  }

  get httpStatus(): number {
    return 504
  }

  get errorCode(): string {
    return "TIMEOUT"
  }

  get cliMetadata(): Record<string, unknown> {
    return { timedOutOperation: this.operation, durationMs: this.durationMs }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(
          "retry",
          `"${this.operation}" exceeded ${this.durationMs}ms — try again or check connectivity`
        ),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Union type + discriminant helper
// ---------------------------------------------------------------------------

export type FactoryError =
  | EntityNotFoundError
  | EntityConflictError
  | ValidationError
  | AuthenticationError
  | AuthorizationError
  | ApiUnreachableError
  | RateLimitError
  | ExternalServiceError
  | SubprocessError
  | ConfigurationError
  | QuotaExceededError
  | TimeoutError
  | StateCorruptionError

export const FactoryErrorTag = {
  EntityNotFoundError: "EntityNotFoundError",
  EntityConflictError: "EntityConflictError",
  ValidationError: "ValidationError",
  AuthenticationError: "AuthenticationError",
  AuthorizationError: "AuthorizationError",
  ApiUnreachableError: "ApiUnreachableError",
  RateLimitError: "RateLimitError",
  ExternalServiceError: "ExternalServiceError",
  SubprocessError: "SubprocessError",
  ConfigurationError: "ConfigurationError",
  QuotaExceededError: "QuotaExceededError",
  TimeoutError: "TimeoutError",
  StateCorruptionError: "StateCorruptionError",
} as const satisfies Record<FactoryError["_tag"], string>

export function hasTag<T extends FactoryError["_tag"]>(
  error: FactoryError,
  tag: T
): error is Extract<FactoryError, { readonly _tag: T }> {
  return error._tag === tag
}
