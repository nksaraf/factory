/**
 * Shared error handler plugin.
 *
 * Translates AppError subclasses, ZodError, and Postgres constraint
 * violations into structured JSON responses with correct HTTP status codes.
 *
 * Used by both the legacy app and the standalone v2 app.
 */

import { Elysia } from "elysia"
import { ZodError } from "zod"
import { AppError } from "../lib/errors"

export function errorHandlerPlugin() {
  return new Elysia({ name: "error-handler" }).onError(
    { as: "scoped" },
    ({ error, set }) => {
      // AppError hierarchy → structured { error: { code, message, details? } }
      if (error instanceof AppError) {
        set.status = error.status
        return {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details != null ? { details: error.details } : {}),
          },
        }
      }

      // Zod validation errors → 400 with formatted issues
      if (error instanceof ZodError) {
        set.status = 400
        return {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            details: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
        }
      }

      // Postgres unique constraint violation → 409 Conflict
      if (isPostgresError(error) && error.code === "23505") {
        set.status = 409
        return {
          error: {
            code: "conflict",
            message:
              error.detail ?? "Duplicate key value violates unique constraint",
          },
        }
      }

      // Postgres FK violation → 400
      if (isPostgresError(error) && error.code === "23503") {
        set.status = 400
        return {
          error: {
            code: "foreign_key_violation",
            message: error.detail ?? "Referenced entity does not exist",
          },
        }
      }

      // Catch-all for unhandled errors → 500 JSON
      if (error instanceof Error) {
        set.status = (error as any).status ?? 500
        return {
          error: {
            code: "internal_error",
            message: error.message,
          },
        }
      }
    }
  )
}

/** Duck-type check for Postgres driver errors (node-postgres / postgres.js). */
function isPostgresError(
  error: unknown
): error is { code: string; detail?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as any).code === "string" &&
    (error as any).code.length === 5
  )
}
