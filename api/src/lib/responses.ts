/**
 * Uniform API response envelope helpers.
 * All API routes should use these instead of ad-hoc response shapes.
 */

import type { AppError } from "./errors"
import type { PaginationMeta } from "./pagination"

export type { PaginationMeta }

// ── Response types ──────────────────────────────────────

export interface ListResponse<T> {
  data: T[]
  meta: PaginationMeta
}

export interface SingleResponse<T> {
  data: T
}

export interface ActionResponse<T> {
  data: T
  action: string
}

export interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

// ── Builder functions ───────────────────────────────────

export function ok<T>(data: T): SingleResponse<T> {
  return { data }
}

export function list<T>(data: T[], meta: PaginationMeta): ListResponse<T> {
  return { data, meta }
}

export function action<T>(data: T, actionName: string): ActionResponse<T> {
  return { data, action: actionName }
}

/**
 * Build an ErrorResponse from an AppError.
 * Used by the global Elysia error handler.
 */
export function errorResponse(err: AppError): ErrorResponse {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    },
  }
}
