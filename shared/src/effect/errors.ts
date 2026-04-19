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
}) {}

const Suggestions = Schema.optional(Schema.Array(RecoverySuggestion))

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
  }
) {
  get message(): string {
    return `Validation failed on "${this.field}": ${this.reason}`
  }

  get httpStatus(): number {
    return 422
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
}

// ---------------------------------------------------------------------------
// Network / external
// ---------------------------------------------------------------------------

export class ApiUnreachableError extends Schema.TaggedError<ApiUnreachableError>()(
  "ApiUnreachableError",
  {
    url: Schema.String,
    cause: Schema.optional(Schema.String),
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `API unreachable at ${this.url}${suffix}`
  }

  get httpStatus(): number {
    return 502
  }
}

export class RateLimitError extends Schema.TaggedError<RateLimitError>()(
  "RateLimitError",
  {
    retryAfterMs: Schema.Number,
  }
) {
  get message(): string {
    return `Rate limit exceeded, retry after ${this.retryAfterMs}ms`
  }

  get httpStatus(): number {
    return 429
  }
}

export class ExternalServiceError extends Schema.TaggedError<ExternalServiceError>()(
  "ExternalServiceError",
  {
    service: Schema.String,
    operation: Schema.String,
    statusCode: Schema.optional(Schema.Number),
    responseBody: Schema.optional(Schema.String),
  }
) {
  get message(): string {
    const status = this.statusCode ? ` (${this.statusCode})` : ""
    return `External service "${this.service}" failed on ${this.operation}${status}`
  }

  get httpStatus(): number {
    return 502
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
  }
) {
  get message(): string {
    const detail = this.stderr ? `: ${this.stderr.slice(0, 200)}` : ""
    return `Command "${this.command}" exited with code ${this.exitCode}${detail}`
  }

  get httpStatus(): number {
    return 500
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
  }
) {
  get message(): string {
    return `Quota exceeded for ${this.resource}: ${this.current}/${this.maximum}`
  }

  get httpStatus(): number {
    return 429
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
  }
) {
  get message(): string {
    return `Operation "${this.operation}" timed out after ${this.durationMs}ms`
  }

  get httpStatus(): number {
    return 504
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
} as const satisfies Record<FactoryError["_tag"], string>

export function hasTag<T extends FactoryError["_tag"]>(
  error: FactoryError,
  tag: T
): error is Extract<FactoryError, { readonly _tag: T }> {
  return error._tag === tag
}
