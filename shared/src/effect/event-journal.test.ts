import { describe, test, expect } from "bun:test"
import { Effect, PubSub, Queue } from "effect"
import { makeEventJournal } from "./event-journal"

describe("EventJournal", () => {
  test("emit and recent", async () => {
    const program = Effect.gen(function* () {
      const journal = yield* makeEventJournal<string>({ maxSize: 5 })

      yield* journal.emit("a")
      yield* journal.emit("b")
      yield* journal.emit("c")

      const events = yield* journal.recent
      expect(events).toEqual(["a", "b", "c"])
    })

    await Effect.runPromise(program)
  })

  test("respects maxSize", async () => {
    const program = Effect.gen(function* () {
      const journal = yield* makeEventJournal<number>({ maxSize: 3 })

      for (let i = 1; i <= 5; i++) {
        yield* journal.emit(i)
      }

      const events = yield* journal.recent
      expect(events).toEqual([3, 4, 5])
    })

    await Effect.runPromise(program)
  })

  test("subscribe receives events", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const journal = yield* makeEventJournal<string>({ maxSize: 10 })
        const dequeue = yield* PubSub.subscribe(journal.subscribe)

        yield* journal.emit("first")
        yield* journal.emit("second")

        const first = yield* Queue.take(dequeue)
        const second = yield* Queue.take(dequeue)

        expect(first).toBe("first")
        expect(second).toBe("second")
      })
    )

    await Effect.runPromise(program)
  })

  test("empty journal returns empty array", async () => {
    const program = Effect.gen(function* () {
      const journal = yield* makeEventJournal<string>()
      const events = yield* journal.recent
      expect(events).toEqual([])
    })

    await Effect.runPromise(program)
  })

  test("default maxSize is 200", async () => {
    const program = Effect.gen(function* () {
      const journal = yield* makeEventJournal<number>()

      for (let i = 0; i < 210; i++) {
        yield* journal.emit(i)
      }

      const events = yield* journal.recent
      expect(events.length).toBe(200)
      expect(events[0]).toBe(10)
      expect(events[199]).toBe(209)
    })

    await Effect.runPromise(program)
  })
})
