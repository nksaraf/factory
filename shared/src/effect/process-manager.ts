import { Context, Effect, Layer, Scope, Duration } from "effect"
import { Schema } from "effect"
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import { openSync, closeSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export class ProcessError extends Schema.TaggedError<ProcessError>()(
  "ProcessError",
  {
    operation: Schema.Literal("spawn", "kill", "inspect"),
    pid: Schema.optional(Schema.Number),
    component: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.String),
  }
) {
  get message(): string {
    const target =
      this.component ?? (this.pid != null ? `PID ${this.pid}` : "process")
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Process ${this.operation} failed for ${target}${suffix}`
  }

  get httpStatus(): number {
    return 500
  }
}

export interface SpawnOpts {
  readonly cmd: string[]
  readonly cwd: string
  readonly env?: Record<string, string | undefined>
  readonly logFile?: string
  readonly detached?: boolean
  readonly component?: string
}

export interface SpawnResult {
  readonly pid: number
  readonly process: ChildProcess
}

export interface ProcessManager {
  readonly spawn: (
    opts: SpawnOpts
  ) => Effect.Effect<SpawnResult, ProcessError, Scope.Scope>
  readonly kill: (
    pid: number,
    signal?: string
  ) => Effect.Effect<void, ProcessError>
  readonly killTree: (pid: number) => Effect.Effect<void, ProcessError>
  readonly isRunning: (pid: number) => Effect.Effect<boolean>
}

export class ProcessManagerTag extends Context.Tag("ProcessManager")<
  ProcessManagerTag,
  ProcessManager
>() {}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sendSignal(
  pid: number,
  signal: string
): Effect.Effect<void, ProcessError> {
  return Effect.try({
    try: () => {
      process.kill(pid, signal as NodeJS.Signals)
    },
    catch: (error) =>
      new ProcessError({
        operation: "kill",
        pid,
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

function sendGroupSignal(pid: number, signal: string): Effect.Effect<void> {
  return Effect.sync(() => {
    try {
      process.kill(-pid, signal as NodeJS.Signals)
    } catch {}
  })
}

function waitForExit(
  pid: number,
  timeoutMs: number = 2000
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const attempts = Math.ceil(timeoutMs / 50)
    for (let i = 0; i < attempts; i++) {
      if (!isAlive(pid)) return true
      yield* Effect.sleep(Duration.millis(50))
    }
    return !isAlive(pid)
  })
}

export const ProcessManagerLive = Layer.succeed(
  ProcessManagerTag,
  ProcessManagerTag.of({
    spawn: (opts: SpawnOpts) =>
      Effect.gen(function* () {
        const [cmd, ...args] = opts.cmd
        if (!cmd) {
          return yield* Effect.fail(
            new ProcessError({
              operation: "spawn",
              component: opts.component,
              cause: "Empty command",
            })
          )
        }

        let stdout: number | "ignore" = "ignore"
        let stderr: number | "ignore" = "ignore"
        let logFd: number | undefined

        if (opts.logFile) {
          mkdirSync(dirname(opts.logFile), { recursive: true })
          logFd = openSync(opts.logFile, "a")
          stdout = logFd
          stderr = logFd
        }

        const proc = yield* Effect.try({
          try: () =>
            nodeSpawn(cmd, args, {
              cwd: opts.cwd,
              env: opts.env as Record<string, string>,
              stdio: ["ignore", stdout, stderr],
              detached: opts.detached ?? true,
              shell: false,
            }),
          catch: (error) => {
            if (logFd !== undefined) closeSync(logFd)
            return new ProcessError({
              operation: "spawn",
              component: opts.component,
              cause: error instanceof Error ? error.message : String(error),
            })
          },
        })

        if (logFd !== undefined) closeSync(logFd)

        if (!proc.pid) {
          return yield* Effect.fail(
            new ProcessError({
              operation: "spawn",
              component: opts.component,
              cause: "Failed to get PID from spawned process",
            })
          )
        }

        proc.unref()
        const pid = proc.pid

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            if (!isAlive(pid)) return
            yield* sendGroupSignal(pid, "SIGTERM").pipe(
              Effect.catchAll(() => sendSignal(pid, "SIGTERM")),
              Effect.catchAll(() => Effect.void)
            )
            const exited = yield* waitForExit(pid)
            if (!exited) {
              yield* sendGroupSignal(pid, "SIGKILL").pipe(
                Effect.catchAll(() => sendSignal(pid, "SIGKILL")),
                Effect.catchAll(() => Effect.void)
              )
            }
          })
        )

        return { pid, process: proc } satisfies SpawnResult
      }).pipe(
        Effect.withSpan("ProcessManager.spawn", {
          attributes: {
            "process.cmd": opts.cmd.join(" "),
            "process.cwd": opts.cwd,
            ...(opts.component ? { "process.component": opts.component } : {}),
          },
        })
      ),

    kill: (pid: number, signal?: string) =>
      sendSignal(pid, signal ?? "SIGTERM").pipe(
        Effect.withSpan("ProcessManager.kill", {
          attributes: {
            "process.pid": pid,
            "process.signal": signal ?? "SIGTERM",
          },
        })
      ),

    killTree: (pid: number) =>
      Effect.gen(function* () {
        yield* sendGroupSignal(pid, "SIGTERM").pipe(
          Effect.catchAll(() => sendSignal(pid, "SIGTERM")),
          Effect.catchAll(() => Effect.void)
        )
        const exited = yield* waitForExit(pid)
        if (exited) return
        yield* sendGroupSignal(pid, "SIGKILL").pipe(
          Effect.catchAll(() => sendSignal(pid, "SIGKILL")),
          Effect.catchAll(() => Effect.void)
        )
      }).pipe(
        Effect.withSpan("ProcessManager.killTree", {
          attributes: { "process.pid": pid },
        })
      ),

    isRunning: (pid: number) => Effect.succeed(isAlive(pid)),
  })
)
