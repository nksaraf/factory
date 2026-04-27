import { describe, test, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { ControlPlaneLink } from "../services/control-plane-link.js"
import { ControlPlaneLinkNoop } from "../layers/control-plane-link.js"
import { ControlPlaneLinkError } from "../errors/site.js"

describe("ControlPlaneLinkNoop", () => {
  test("checkin returns { manifestChanged: false }", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const link = yield* ControlPlaneLink
        const result = yield* link.checkin({} as any)
        expect(result).toEqual({ manifestChanged: false })
      }).pipe(Effect.provide(ControlPlaneLinkNoop))
    )
  })

  test("fetchManifest fails with ControlPlaneLinkError", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const link = yield* ControlPlaneLink
        yield* link.fetchManifest
      }).pipe(Effect.provide(ControlPlaneLinkNoop))
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("fetchManifest error is typed (not a defect)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const link = yield* ControlPlaneLink
        const result = yield* link.fetchManifest.pipe(Effect.either)
        expect(result._tag).toBe("Left")
      }).pipe(Effect.provide(ControlPlaneLinkNoop))
    )
  })

  test("reportState returns void (no error)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const link = yield* ControlPlaneLink
        yield* link.reportState([], {})
      }).pipe(Effect.provide(ControlPlaneLinkNoop))
    )
  })

  test("checkForUpdates returns null", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const link = yield* ControlPlaneLink
        const result = yield* link.checkForUpdates(1, [], "docker-compose")
        expect(result).toBeNull()
      }).pipe(Effect.provide(ControlPlaneLinkNoop))
    )
  })
})
