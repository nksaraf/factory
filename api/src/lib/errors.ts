/**
 * Application error classes for the Factory API.
 * Thrown in services, caught by global Elysia error handler.
 */

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  readonly status = 404 as const;
  readonly code = "not_found" as const;
}

export class ValidationError extends AppError {
  readonly status = 400 as const;
  readonly code = "validation_error" as const;
}

export class ConflictError extends AppError {
  readonly status = 409 as const;
  readonly code = "conflict" as const;
}

export class UnauthorizedError extends AppError {
  readonly status = 401 as const;
  readonly code = "unauthorized" as const;
}

export class ForbiddenError extends AppError {
  readonly status = 403 as const;
  readonly code = "forbidden" as const;
}

export class BadRequestError extends AppError {
  readonly status = 400 as const;
  readonly code = "bad_request" as const;
}

export class InternalError extends AppError {
  readonly status = 500 as const;
  readonly code = "internal_error" as const;
}

export class ServiceUnavailableError extends AppError {
  readonly status = 503 as const;
  readonly code = "service_unavailable" as const;
}

/**
 * Returns the value if non-nullish, otherwise throws NotFoundError.
 * Use in service/controller code to assert existence:
 *
 *   const system = notFoundOr(await db.getSystem(slug), "system", slug);
 */
export function notFoundOr<T>(
  value: T | null | undefined,
  entity: string,
  identifier: string,
): T {
  if (value == null) {
    throw new NotFoundError(`${entity} '${identifier}' not found`);
  }
  return value;
}
