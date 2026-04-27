import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { ProcessManager, ProcessManagerLive } from "../process-manager.js"

describe("ProcessManager.capture", () => {
  const run = <A>(effect: Effect.Effect<A, never, ProcessManager>) =>
    Effect.runPromise(Effect.provide(effect, ProcessManagerLive))

  it("captures stdout", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({ cmd: ["echo", "hello"] })
        expect(r.code).toBe(0)
        expect(r.stdout.trim()).toBe("hello")
      })
    )
  })

  it("captures stderr", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({
          cmd: ["bash", "-c", "echo err >&2"],
        })
        expect(r.stderr.trim()).toBe("err")
      })
    )
  })

  it("captures non-zero exit code", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({ cmd: ["bash", "-c", "exit 42"] })
        expect(r.code).toBe(42)
      })
    )
  })

  it("times out long commands", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({
          cmd: ["sleep", "60"],
          timeoutMs: 200,
        })
        expect(r.code).not.toBe(0)
      })
    )
  })

  it("handles empty cmd gracefully", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({ cmd: [] })
        expect(r.code).toBe(-1)
      })
    )
  })

  it("handles missing binary", async () => {
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        const r = yield* pm.capture({
          cmd: ["__nonexistent_binary_xyz__"],
        })
        expect(r.code).toBe(-1)
      })
    )
  })
})

describe("ProcessManager.stream", () => {
  const run = <A>(effect: Effect.Effect<A, never, ProcessManager>) =>
    Effect.runPromise(Effect.provide(effect, ProcessManagerLive))

  it("delivers lines to onStdout", async () => {
    const lines: string[] = []
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        yield* pm.stream({
          cmd: ["bash", "-c", "echo line1; echo line2; echo line3"],
          onStdout: (line) => lines.push(line),
        })
      })
    )
    expect(lines).toEqual(["line1", "line2", "line3"])
  })

  it("delivers stderr lines when onStderr provided", async () => {
    const errLines: string[] = []
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        yield* pm.stream({
          cmd: ["bash", "-c", "echo out; echo err >&2"],
          onStdout: () => {},
          onStderr: (line) => errLines.push(line),
        })
      })
    )
    expect(errLines).toEqual(["err"])
  })

  it("returns exit code", async () => {
    const code = await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        return yield* pm.stream({
          cmd: ["bash", "-c", "echo ok; exit 7"],
          onStdout: () => {},
        })
      })
    )
    expect(code).toBe(7)
  })

  it("respects AbortSignal", async () => {
    const ac = new AbortController()
    const lines: string[] = []
    setTimeout(() => ac.abort(), 100)
    await run(
      Effect.gen(function* () {
        const pm = yield* ProcessManager
        yield* pm.stream({
          cmd: ["bash", "-c", "while true; do echo tick; sleep 0.02; done"],
          onStdout: (line) => lines.push(line),
          signal: ac.signal,
        })
      })
    )
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThan(100)
  })
})

describe("ProcessManager.interactive", () => {
  it("returns exit code from non-TTY command", async () => {
    const code = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const pm = yield* ProcessManager
          return yield* pm.interactive({ cmd: ["true"] })
        }),
        ProcessManagerLive
      )
    )
    expect(code).toBe(0)
  })
})
