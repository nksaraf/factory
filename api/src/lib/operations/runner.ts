/**
 * Operations Runner — unified abstraction for all background operations.
 *
 * Wraps any periodic background task (sync loop, reconciler, cleanup) with:
 * - DB-tracked runs (operation_run table)
 * - Per-run child logger for log correlation
 * - Overlap guard (prevent concurrent runs)
 * - Manual trigger support
 * - Run history queries
 */

import { eq, desc, and } from "drizzle-orm"
import type { InferSelectModel } from "drizzle-orm"
import type { Logger } from "pino"

import type { Database } from "../../db/connection"
import { operationRun } from "../../db/schema/ops"
import { logger as rootLogger } from "../../logger"

export type OperationRunRow = InferSelectModel<typeof operationRun>

export interface OperationRunnerConfig {
  /** Unique name for this operation, e.g. "proxmox", "reconciler" */
  name: string
  /** Interval in ms between scheduled runs */
  intervalMs: number
  /** Whether to run immediately on startup (default: true) */
  runOnStartup?: boolean
  /** The operation to execute. Receives a child logger, returns summary stats. */
  execute: (log: Logger) => Promise<Record<string, unknown>>
}

export interface OperationRunner {
  /** Unique operation name */
  readonly name: string
  /** Configured interval in ms */
  readonly intervalMs: number
  /** Trigger a manual run. Returns the run ID. Rejects if already running. */
  trigger(): Promise<string>
  /** Stop the interval loop */
  stop(): void
  /** Get the most recent run */
  lastRun(): Promise<OperationRunRow | null>
  /** Get paginated run history */
  history(opts: { limit: number; offset: number }): Promise<OperationRunRow[]>
}

export function createOperationRunner(
  db: Database,
  config: OperationRunnerConfig
): OperationRunner {
  const { name, intervalMs, execute } = config
  const runOnStartup = config.runOnStartup !== false
  const opLogger = rootLogger.child({ op: name })

  let isRunning = false
  let timer: ReturnType<typeof setInterval> | null = null

  /** Execute and track a run that already has a DB row inserted. */
  async function executeTracked(
    runId: string,
    trigger: "schedule" | "manual" | "startup"
  ): Promise<void> {
    const startTime = Date.now()
    const runLogger = opLogger.child({ runId, trigger })
    runLogger.info("operation started")

    try {
      const summary = await execute(runLogger)
      const durationMs = Date.now() - startTime

      await db
        .update(operationRun)
        .set({
          status: "succeeded",
          completedAt: new Date(),
          durationMs,
          summary: summary as Record<string, unknown>,
        })
        .where(eq(operationRun.id, runId))

      runLogger.info({ durationMs, ...summary }, "operation succeeded")
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)

      await db
        .update(operationRun)
        .set({
          status: "failed",
          completedAt: new Date(),
          durationMs,
          error: errorMessage,
        })
        .where(eq(operationRun.id, runId))
        .catch((dbErr) => {
          opLogger.error(
            { err: dbErr },
            "failed to update operation_run status"
          )
        })

      runLogger.error({ err, durationMs }, "operation failed")
    } finally {
      isRunning = false
    }
  }

  /** Insert a DB row and execute the operation. Returns run ID, or null if skipped. */
  async function runOnce(
    trigger: "schedule" | "manual" | "startup"
  ): Promise<string | null> {
    if (isRunning) {
      if (trigger === "schedule") {
        opLogger.debug(
          "skipping scheduled run — previous run still in progress"
        )
        return null
      }
      throw new Error(`Operation "${name}" is already running`)
    }

    isRunning = true

    const [row] = await db
      .insert(operationRun)
      .values({ name, trigger, status: "running" })
      .returning()

    await executeTracked(row.id, trigger)
    return row.id
  }

  // Start the loop
  if (runOnStartup) {
    // Fire-and-forget startup run
    runOnce("startup").catch((err) => {
      opLogger.error({ err }, "startup run failed")
    })
  }

  timer = setInterval(() => {
    runOnce("schedule").catch((err) => {
      opLogger.error({ err }, "scheduled run failed")
    })
  }, intervalMs)

  return {
    name,
    intervalMs,

    async trigger(): Promise<string> {
      if (isRunning) throw new Error(`Operation "${name}" is already running`)
      // Fire-and-forget — don't block the HTTP caller on long operations.
      // We eagerly insert the DB row here, then run the operation in the background.
      isRunning = true
      const [row] = await db
        .insert(operationRun)
        .values({ name, trigger: "manual", status: "running" })
        .returning()
      const runId = row.id

      // Run in background — caller gets the runId immediately
      executeTracked(runId, "manual").catch((err) => {
        opLogger.error({ err }, "manual trigger failed")
      })

      return runId
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },

    async lastRun(): Promise<OperationRunRow | null> {
      const [row] = await db
        .select()
        .from(operationRun)
        .where(eq(operationRun.name, name))
        .orderBy(desc(operationRun.startedAt))
        .limit(1)
      return row ?? null
    },

    async history({
      limit,
      offset,
    }: {
      limit: number
      offset: number
    }): Promise<OperationRunRow[]> {
      return db
        .select()
        .from(operationRun)
        .where(eq(operationRun.name, name))
        .orderBy(desc(operationRun.startedAt))
        .limit(limit)
        .offset(offset)
    },
  }
}
