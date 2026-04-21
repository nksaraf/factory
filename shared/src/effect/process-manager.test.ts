import { describe, test, expect } from "bun:test"
import { Effect, Scope, Exit } from "effect"
import {
  ProcessManagerTag,
  ProcessManagerLive,
  ProcessError,
} from "./process-manager"

describe("ProcessManager", () => {
  test("spawn returns a PID", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManagerTag
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
          const pm = yield* ProcessManagerTag
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
        const pm = yield* ProcessManagerTag
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
          const pm = yield* ProcessManagerTag
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
          const pm = yield* ProcessManagerTag
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
          const pm = yield* ProcessManagerTag
          yield* pm.spawn({ cmd: [], cwd: "/tmp" })
        })
      ).pipe(Effect.provide(ProcessManagerLive))
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("killTree terminates process group", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pm = yield* ProcessManagerTag
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
})
