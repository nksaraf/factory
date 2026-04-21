import { Effect, Layer, Schedule, Duration } from "effect"
import { FactoryLink } from "../../site/factory-link.js"
import { SiteConfigTag } from "../services/site-config.js"
import {
  ControlPlaneLinkTag,
  type ControlPlaneLinkService,
} from "../services/control-plane-link.js"
import { ControlPlaneLinkError } from "../errors/site.js"

const retryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3))
)

function wrapWithRetry<T>(
  operation: string,
  fn: () => Promise<T>
): Effect.Effect<T, ControlPlaneLinkError> {
  return Effect.tryPromise({
    try: fn,
    catch: (error) =>
      new ControlPlaneLinkError({
        operation,
        cause: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.retry(retryPolicy),
    Effect.timeout(Duration.seconds(10)),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(
        new ControlPlaneLinkError({
          operation,
          cause: "Request timed out after 10s",
        })
      )
    ),
    Effect.withSpan(`ControlPlaneLink.${operation}`)
  )
}

export const FactoryControlPlaneLinkLive = Layer.effect(
  ControlPlaneLinkTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const siteName = config.siteName ?? config.focusSystem.name
    const factoryUrl = "" // resolved from host config at runtime

    const link = new FactoryLink({ factoryUrl, siteName })

    return ControlPlaneLinkTag.of({
      checkin: (payload) =>
        wrapWithRetry("checkin", () => link.checkin(payload)),

      fetchManifest: wrapWithRetry("fetchManifest", () => link.fetchManifest()),

      reportState: (states, health) =>
        wrapWithRetry("reportState", () =>
          link.reportState(states, health)
        ).pipe(Effect.catchAll(() => Effect.void)),

      checkForUpdates: (currentVersion, states, executorType) =>
        wrapWithRetry("checkForUpdates", () =>
          link.checkForUpdates(currentVersion, states, executorType)
        ),
    }) satisfies ControlPlaneLinkService
  })
)

export const ControlPlaneLinkNoop = Layer.succeed(
  ControlPlaneLinkTag,
  ControlPlaneLinkTag.of({
    checkin: () => Effect.succeed({ manifestChanged: false }),
    fetchManifest: Effect.fail(
      new ControlPlaneLinkError({
        operation: "fetchManifest",
        cause: "No control plane connection (standalone mode)",
      })
    ),
    reportState: () => Effect.void,
    checkForUpdates: () => Effect.succeed(null),
  })
)
