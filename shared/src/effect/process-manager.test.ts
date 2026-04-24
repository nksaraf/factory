import { describe, test, expect } from "bun:test"
import { Effect, Scope, Exit } from "effect"
import {
  ProcessManager,
  ProcessManagerLive,
  ProcessError,
} from "./process-manager"

describe("ProcessError", () => {
  test("message with component", () => {
    const err = new ProcessError({ operation: "spawn", component: "api" })
    expect(err.message).toBe("Process spawn failed for api")
    expect(err.httpStatus).toBe(500)
  })

  test("message with pid", () => {
    const err = new ProcessError({ operation: "kill", pid: 12345 })
    expect(err.message).toBe("Process kill failed for PID 12345")
  })

  test("message with cause", () => {
    const err = new ProcessError({
      operation: "spawn",
      component: "api",
      cause: "ENOENT",
    })
    expect(err.message).toBe("Process spawn failed for api: ENOENT")
  })

  test("message fallback to 'process'", () => {
    const err = new ProcessError({ operation: "inspect" })
    expect(err.message).toBe("Process inspect failed for process")
  })
})

describe("ProcessManager", () => {
  test("spawn returns a PID", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["sleep", "10"],
            cwd: "/tmp",
          })
          expect(result.pid).toBeGreaterThan(0)
          expect(typeof result.pid).toBe("number")
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("isRunning returns true for spawned process", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["sleep", "10"],
            cwd: "/tmp",
          })
          const running = yield* pm.isRunning(result.pid)
          expect(running).toBe(true)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("isRunning returns false for non-existent PID", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const running = yield* pm.isRunning(999999)
        expect(running).toBe(false)
      }).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("scope closure kills spawned process", async () => {
    let spawnedPid: number | undefined

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["sleep", "30"],
            cwd: "/tmp",
          })
          spawnedPid = result.pid
          const running = yield* pm.isRunning(result.pid)
          expect(running).toBe(true)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )

    expect(spawnedPid).toBeDefined()
    await new Promise((r) => setTimeout(r, 200))
    let alive = false
    try {
      process.kill(spawnedPid!, 0)
      alive = true
    } catch {}
    expect(alive).toBe(false)
  })

  test("kill sends signal to a process", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["sleep", "30"],
            cwd: "/tmp",
          })
          yield* pm.kill(result.pid)
          yield* Effect.sleep(100)
          const running = yield* pm.isRunning(result.pid)
          expect(running).toBe(false)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("spawn with empty command fails with ProcessError", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          yield* pm.spawn({ cmd: [], cwd: "/tmp" })
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("spawn with logFile writes output", async () => {
    const { mkdirSync, existsSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")
    const logDir = join(tmpdir(), `pm-test-${Date.now()}`)
    mkdirSync(logDir, { recursive: true })
    const logFile = join(logDir, "test.log")

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["echo", "hello"],
            cwd: "/tmp",
            logFile,
            component: "test-comp",
          })
          expect(result.pid).toBeGreaterThan(0)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )

    expect(existsSync(logFile)).toBe(true)
    rmSync(logDir, { recursive: true })
  })

  test("kill on non-existent PID fails with ProcessError", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        yield* pm.kill(999999)
      }).pipe(Effect.provide(ProcessManagerLive))
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("killTree on non-existent PID succeeds (best effort)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        yield* pm.killTree(999999)
      }).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("killTree terminates process group", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["sleep", "30"],
            cwd: "/tmp",
          })
          yield* pm.killTree(result.pid)
          yield* Effect.sleep(200)
          const running = yield* pm.isRunning(result.pid)
          expect(running).toBe(false)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("spawn with detached false runs in foreground", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          const result = yield* pm.spawn({
            cmd: ["echo", "test"],
            cwd: "/tmp",
            detached: false,
          })
          expect(result.pid).toBeGreaterThan(0)
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
  })

  test("spawn with component name in error", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          yield* pm.spawn({
            cmd: [],
            cwd: "/tmp",
            component: "my-api",
          })
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
