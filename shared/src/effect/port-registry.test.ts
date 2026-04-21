import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { makePortRegistry, PortConflictError } from "./port-registry"

describe("PortRegistry", () => {
  test("allocate returns ports for requests", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makePortRegistry()
      const result = yield* registry.allocate([
        { name: "http", preferred: 49100 },
        { name: "grpc", preferred: 49101 },
      ])

      expect(result.http).toBe(49100)
      expect(result.grpc).toBe(49101)
    })

    await Effect.runPromise(program)
  })

  test("snapshot returns allocations", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makePortRegistry()
      yield* registry.allocate([
        { name: "api", preferred: 49200, component: "factory-api" },
      ])

      const snapshot = yield* registry.snapshot
      expect(snapshot).toHaveLength(1)
      expect(snapshot[0]!.name).toBe("api")
      expect(snapshot[0]!.port).toBe(49200)
      expect(snapshot[0]!.component).toBe("factory-api")
    })

    await Effect.runPromise(program)
  })

  test("release removes allocation", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makePortRegistry()
      yield* registry.allocate([{ name: "temp", preferred: 49300 }])

      let snapshot = yield* registry.snapshot
      expect(snapshot).toHaveLength(1)

      yield* registry.release(49300)

      snapshot = yield* registry.snapshot
      expect(snapshot).toHaveLength(0)
    })

    await Effect.runPromise(program)
  })

  test("isAvailable checks port", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makePortRegistry()
      const available = yield* registry.isAvailable(49400)
      expect(available).toBe(true)
    })

    await Effect.runPromise(program)
  })

  test("allocateMulti groups by service", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makePortRegistry()
      const result = yield* registry.allocateMulti([
        {
          service: "api",
          ports: [
            { name: "http", preferred: 49500 },
            { name: "debug", preferred: 49501 },
          ],
        },
        {
          service: "web",
          ports: [{ name: "http", preferred: 49502 }],
        },
      ])

      expect(result.api!.http).toBe(49500)
      expect(result.api!.debug).toBe(49501)
      expect(result.web!.http).toBe(49502)
    })

    await Effect.runPromise(program)
  })

  test("finds free port when preferred is taken", async () => {
    const { createServer } = await import("node:net")
    const server = createServer()
    await new Promise<void>((resolve) => {
      server.listen(49600, "127.0.0.1", () => resolve())
    })

    try {
      const program = Effect.gen(function* () {
        const registry = yield* makePortRegistry()
        const result = yield* registry.allocate([
          { name: "test", preferred: 49600 },
        ])
        expect(result.test).not.toBe(49600)
        expect(typeof result.test).toBe("number")
      })

      await Effect.runPromise(program)
    } finally {
      server.close()
    }
  })
})
