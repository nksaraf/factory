import { describe, test, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { runEffect } from "../bridge.js"
import { DxError } from "../../lib/dx-error.js"
import { ExecutorError } from "../errors/site.js"
import {
  EntityNotFoundError,
  RecoverySuggestion,
} from "@smp/factory-shared/effect/errors"

describe("runEffect", () => {
  describe("success path", () => {
    test("returns the value from a successful Effect", async () => {
      const result = await runEffect(Effect.succeed(42), "test-op")
      expect(result).toBe(42)
    })

    test("returns undefined from Effect.succeed(undefined)", async () => {
      const result = await runEffect(Effect.succeed(undefined), "test-op")
      expect(result).toBeUndefined()
    })
  })

  describe("typed error path", () => {
    test("ExecutorError → DxError with errorCode and metadata", async () => {
      const effect = Effect.fail(
        new ExecutorError({
          executor: "docker-compose",
          operation: "deploy",
          component: "api",
        })
      )

      try {
        await runEffect(effect, "deploying")
        expect.unreachable("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(DxError)
        const dx = err as DxError
        expect(dx.context.code).toBe("EXECUTOR_ERROR")
        expect(dx.context.metadata?.executor).toBe("docker-compose")
        expect(dx.context.metadata?.component).toBe("api")
        expect(dx.context.operation).toBe("deploying")
      }
    })

    test("error with caller suggestions → DxError carries them", async () => {
      const suggestions = [
        new RecoverySuggestion({
          action: "check logs",
          description: "Look at container output",
        }),
      ]
      const effect = Effect.fail(
        new ExecutorError({
          executor: "docker-compose",
          operation: "deploy",
          component: "api",
          suggestions,
        })
      )

      try {
        await runEffect(effect, "deploying")
        expect.unreachable("should have thrown")
      } catch (err) {
        const dx = err as DxError
        expect(dx.context.suggestions).toHaveLength(1)
        expect(dx.context.suggestions![0]!.action).toBe("check logs")
      }
    })

    test("error without suggestions → DxError carries effectiveSuggestions defaults", async () => {
      const effect = Effect.fail(
        new ExecutorError({
          executor: "docker-compose",
          operation: "deploy",
          component: "api",
        })
      )

      try {
        await runEffect(effect, "deploying")
        expect.unreachable("should have thrown")
      } catch (err) {
        const dx = err as DxError
        expect(dx.context.suggestions).toBeDefined()
        expect(dx.context.suggestions!.length).toBeGreaterThan(0)
      }
    })

    test("EntityNotFoundError → DxError with NOT_FOUND code", async () => {
      const effect = Effect.fail(
        new EntityNotFoundError({ entity: "Site", identifier: "prod" })
      )

      try {
        await runEffect(effect, "looking up")
        expect.unreachable("should have thrown")
      } catch (err) {
        const dx = err as DxError
        expect(dx.context.code).toBe("NOT_FOUND")
        expect(dx.context.metadata?.entity).toBe("Site")
        expect(dx.context.metadata?.identifier).toBe("prod")
      }
    })

    test("error without errorCode → falls back to _tag", async () => {
      class BareError extends Schema.TaggedError<BareError>()("BareError", {}) {
        get message() {
          return "bare"
        }
      }

      try {
        await runEffect(Effect.fail(new BareError()), "test-op")
        expect.unreachable("should have thrown")
      } catch (err) {
        const dx = err as DxError
        expect(dx.context.code).toBe("BareError")
      }
    })

    test("error without cliMetadata → DxError metadata is empty object", async () => {
      class NoMetaError extends Schema.TaggedError<NoMetaError>()(
        "NoMetaError",
        {}
      ) {
        get message() {
          return "no meta"
        }
      }

      try {
        await runEffect(Effect.fail(new NoMetaError()), "test-op")
        expect.unreachable("should have thrown")
      } catch (err) {
        const dx = err as DxError
        expect(dx.context.metadata).toEqual({})
      }
    })
  })

  describe("defect path", () => {
    test("Effect.die(new Error) → DxError wraps the error", async () => {
      try {
        await runEffect(Effect.die(new Error("boom")), "crashing")
        expect.unreachable("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(DxError)
        const dx = err as DxError
        expect(dx.message).toContain("boom")
      }
    })

    test("Effect.die(string) → DxError wraps string as Error", async () => {
      try {
        await runEffect(Effect.die("string defect"), "crashing")
        expect.unreachable("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(DxError)
      }
    })
  })
})
