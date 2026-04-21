import { describe, test, expect } from "bun:test"
import { Effect, Scope } from "effect"
import { makeJsonFileConfigStore, makeMemoryConfigStore } from "./config-store"
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), `config-store-test-${Date.now()}`)

function cleanTestDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
}

describe("ConfigStore", () => {
  describe("memory", () => {
    test("get returns initial value", async () => {
      const store = await Effect.runPromise(makeMemoryConfigStore({ count: 0 }))
      const value = await Effect.runPromise(store.get)
      expect(value).toEqual({ count: 0 })
    })

    test("set then get", async () => {
      const store = await Effect.runPromise(makeMemoryConfigStore({ count: 0 }))
      await Effect.runPromise(store.set({ count: 5 }))
      const value = await Effect.runPromise(store.get)
      expect(value).toEqual({ count: 5 })
    })

    test("update", async () => {
      const store = await Effect.runPromise(makeMemoryConfigStore({ count: 0 }))
      await Effect.runPromise(store.update((v) => ({ count: v.count + 1 })))
      const value = await Effect.runPromise(store.get)
      expect(value).toEqual({ count: 1 })
    })

    test("delete resets to initial", async () => {
      const store = await Effect.runPromise(
        makeMemoryConfigStore({ count: 10 })
      )
      await Effect.runPromise(store.set({ count: 99 }))
      await Effect.runPromise(store.delete)
      const value = await Effect.runPromise(store.get)
      expect(value).toEqual({ count: 10 })
    })
  })

  describe("jsonFile", () => {
    test("creates file on set and reads back", async () => {
      cleanTestDir()
      mkdirSync(testDir, { recursive: true })
      const path = join(testDir, "test-set.json")

      const program = Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeJsonFileConfigStore({
            path,
            parse: JSON.parse,
            serialize: (v) => JSON.stringify(v, null, 2),
            defaultValue: { name: "default" },
          })

          const initial = yield* store.get
          expect(initial).toEqual({ name: "default" })

          yield* store.set({ name: "updated" })
          const after = yield* store.get
          expect(after).toEqual({ name: "updated" })

          const raw = readFileSync(path, "utf-8")
          expect(JSON.parse(raw)).toEqual({ name: "updated" })
        })
      )

      await Effect.runPromise(program)
      cleanTestDir()
    })

    test("reads existing file on init", async () => {
      cleanTestDir()
      mkdirSync(testDir, { recursive: true })
      const path = join(testDir, "test-read.json")
      const { writeFileSync } = await import("node:fs")
      writeFileSync(path, JSON.stringify({ existing: true }))

      const program = Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeJsonFileConfigStore({
            path,
            parse: JSON.parse,
            serialize: (v) => JSON.stringify(v),
            defaultValue: { existing: false },
          })

          const value = yield* store.get
          expect(value).toEqual({ existing: true })
        })
      )

      await Effect.runPromise(program)
      cleanTestDir()
    })

    test("update persists to disk", async () => {
      cleanTestDir()
      mkdirSync(testDir, { recursive: true })
      const path = join(testDir, "test-update.json")

      const program = Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeJsonFileConfigStore({
            path,
            parse: JSON.parse,
            serialize: (v) => JSON.stringify(v),
            defaultValue: { n: 0 },
          })

          yield* store.update((v: any) => ({ n: v.n + 1 }))
          yield* store.update((v: any) => ({ n: v.n + 1 }))

          const value = yield* store.get
          expect(value).toEqual({ n: 2 })
        })
      )

      await Effect.runPromise(program)

      const raw = readFileSync(path, "utf-8")
      expect(JSON.parse(raw)).toEqual({ n: 2 })
      cleanTestDir()
    })

    test("delete removes file", async () => {
      cleanTestDir()
      mkdirSync(testDir, { recursive: true })
      const path = join(testDir, "test-delete.json")

      const program = Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeJsonFileConfigStore({
            path,
            parse: JSON.parse,
            serialize: (v) => JSON.stringify(v),
            defaultValue: { x: 1 },
          })

          yield* store.set({ x: 99 })
          expect(existsSync(path)).toBe(true)

          yield* store.delete
          expect(existsSync(path)).toBe(false)

          const value = yield* store.get
          expect(value).toEqual({ x: 1 })
        })
      )

      await Effect.runPromise(program)
      cleanTestDir()
    })
  })
})
