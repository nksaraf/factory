import { and, eq, gt } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../db/connection"
import { idempotencyKey } from "../db/schema/org"
import { AppError } from "../lib/errors"

const LOCK_TIMEOUT_MS = 60_000
const KEY_TTL_MS = 24 * 60 * 60 * 1000

class IdempotencyConflictError extends AppError {
  readonly status = 409 as const
  readonly code = "idempotency_conflict" as const
  constructor() {
    super("A request with this idempotency key is already in progress")
  }
}

export function idempotencyPlugin(db: Database) {
  return new Elysia({ name: "idempotency" })
    .derive({ as: "scoped" }, () => {
      const state = {
        keyId: null as string | null,
        replay: null as { code: number; body: unknown } | null,
      }
      return { __idempotency: state }
    })
    .onBeforeHandle({ as: "scoped" }, async (ctx) => {
      const key = ctx.request.headers.get("idempotency-key")
      if (!key || ctx.request.method !== "POST") return

      const userId = "anonymous"
      const path = new URL(ctx.request.url).pathname
      const body = (ctx as any).body ?? {}
      const minCreatedAt = new Date(Date.now() - KEY_TTL_MS)

      const existing = await db
        .select()
        .from(idempotencyKey)
        .where(
          and(
            eq(idempotencyKey.userId, userId),
            eq(idempotencyKey.key, key),
            gt(idempotencyKey.createdAt, minCreatedAt)
          )
        )
        .limit(1)

      if (existing.length > 0) {
        const row = existing[0]

        if (row.finishedAt) {
          ctx.set.status = row.responseCode ?? 200
          ctx.__idempotency.replay = {
            code: row.responseCode ?? 200,
            body: row.responseBody,
          }
          return row.responseBody
        }

        const lockedAge = Date.now() - new Date(row.lockedAt).getTime()
        if (lockedAge < LOCK_TIMEOUT_MS) {
          throw new IdempotencyConflictError()
        }

        // Stale lock — optimistic lock refresh to prevent TOCTOU race
        const [refreshed] = await db
          .update(idempotencyKey)
          .set({ lockedAt: new Date(), requestBody: body })
          .where(
            and(
              eq(idempotencyKey.id, row.id),
              eq(idempotencyKey.lockedAt, row.lockedAt)
            )
          )
          .returning()
        if (!refreshed) throw new IdempotencyConflictError()
        ctx.__idempotency.keyId = row.id
        return
      }

      // New key — use onConflictDoNothing to handle concurrent first requests
      const [inserted] = await db
        .insert(idempotencyKey)
        .values({
          key,
          userId,
          requestMethod: ctx.request.method,
          requestPath: path,
          requestBody: body,
          expiresAt: new Date(Date.now() + KEY_TTL_MS),
        })
        .onConflictDoNothing()
        .returning()

      if (!inserted) {
        throw new IdempotencyConflictError()
      }

      ctx.__idempotency.keyId = inserted.id
    })
    .onAfterHandle({ as: "scoped" }, async (ctx) => {
      if (!ctx.__idempotency.keyId) return

      let responseCode = 200
      let responseBody: unknown = ctx.response

      if (typeof ctx.set.status === "number") {
        responseCode = ctx.set.status
      }

      if (ctx.response instanceof Response) {
        responseCode = ctx.response.status
        try {
          responseBody = await ctx.response.clone().json()
        } catch {
          responseBody = null
        }
      }

      await db
        .update(idempotencyKey)
        .set({
          responseCode,
          responseBody: responseBody as any,
          finishedAt: new Date(),
        })
        .where(eq(idempotencyKey.id, ctx.__idempotency.keyId))
    })
    .onError({ as: "scoped" }, async (ctx) => {
      const keyId = (ctx as any).__idempotency?.keyId as string | null
      if (!keyId) return

      const error = ctx.error
      const status =
        error instanceof AppError
          ? error.status
          : typeof ctx.set.status === "number"
            ? ctx.set.status
            : 500

      const errorBody = {
        error: {
          code: error instanceof AppError ? error.code : "internal_error",
          message: error instanceof Error ? error.message : String(error),
        },
      }

      await db
        .update(idempotencyKey)
        .set({
          responseCode: status,
          responseBody: errorBody as any,
          finishedAt: new Date(),
        })
        .where(eq(idempotencyKey.id, keyId))
    })
}
