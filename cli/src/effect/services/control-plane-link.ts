import { Context, Effect } from "effect"
import type { SiteManifest } from "../../site/manifest.js"
import type { ComponentState } from "../../site/execution/executor.js"
import type { ControlPlaneLinkError } from "../errors/site.js"
import type {
  CheckinPayload,
  CheckinResponse,
} from "../../site/factory-link.js"

export type { CheckinPayload, CheckinResponse }

export interface IControlPlaneLink {
  readonly checkin: (
    payload: CheckinPayload
  ) => Effect.Effect<CheckinResponse, ControlPlaneLinkError>
  readonly fetchManifest: Effect.Effect<SiteManifest, ControlPlaneLinkError>
  readonly reportState: (
    states: ComponentState[],
    health: Record<string, string>
  ) => Effect.Effect<void, ControlPlaneLinkError>
  readonly checkForUpdates: (
    currentVersion: number,
    states: ComponentState[],
    executorType: string
  ) => Effect.Effect<SiteManifest | null, ControlPlaneLinkError>
}

export class ControlPlaneLink extends Context.Tag("ControlPlaneLink")<
  ControlPlaneLink,
  IControlPlaneLink
>() {}
