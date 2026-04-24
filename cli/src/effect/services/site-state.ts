import { Context, Effect } from "effect"
import type {
  Condition,
  ComponentDeploymentMode,
  ComponentDeploymentStatus,
  LocalComponentDeployment,
  LocalSystemDeployment,
  SiteInfo,
  LocalSiteStatus,
  SiteMode,
  SiteSpec,
  SiteState as SiteStateData,
  WorkbenchInfo,
  LinkedRef,
  SystemLinkedRef,
  ResolvedEnvEntryLocal,
} from "@smp/factory-shared"
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { StateCorruptionError } from "@smp/factory-shared/effect/errors"
import type { SiteManifest } from "../../site/manifest.js"

export interface SavedComponentStatus {
  status: ComponentDeploymentStatus
  mode: ComponentDeploymentMode
}

export interface ISiteState {
  readonly getState: Effect.Effect<SiteStateData>
  readonly getSpec: Effect.Effect<SiteSpec>
  readonly getStatus: Effect.Effect<LocalSiteStatus>
  readonly getSystemDeployment: (
    slug: string
  ) => Effect.Effect<LocalSystemDeployment | undefined>
  readonly getComponentMode: (
    sdSlug: string,
    component: string
  ) => Effect.Effect<ComponentDeploymentMode | null>

  readonly ensureSystemDeployment: (
    slug: string,
    systemSlug: string,
    runtime: string,
    composeFiles: string[]
  ) => Effect.Effect<LocalSystemDeployment>
  readonly ensureLinkedSystemDeployment: (
    slug: string,
    systemSlug: string,
    linkedRef: SystemLinkedRef
  ) => Effect.Effect<LocalSystemDeployment>
  readonly setComponentMode: (
    sdSlug: string,
    component: string,
    mode: ComponentDeploymentMode,
    opts?: {
      workbenchSlug?: string
      serviceSlug?: string
      linkedRef?: LinkedRef
    }
  ) => Effect.Effect<void>
  readonly updateComponentStatus: (
    sdSlug: string,
    component: string,
    status: Partial<ComponentDeploymentStatus>
  ) => Effect.Effect<void>
  readonly setCondition: (
    sdSlug: string,
    component: string,
    condition: Condition
  ) => Effect.Effect<void>
  readonly setPhase: (phase: LocalSiteStatus["phase"]) => Effect.Effect<void>
  readonly setResolvedEnv: (
    sdSlug: string,
    env: Record<string, ResolvedEnvEntryLocal>,
    tunnels: LocalSystemDeployment["tunnels"]
  ) => Effect.Effect<void>
  readonly bumpGeneration: (
    sdSlug: string,
    component: string
  ) => Effect.Effect<void>
  readonly setMode: (mode: SiteMode) => Effect.Effect<void>

  readonly resetIntent: Effect.Effect<Map<string, SavedComponentStatus>>
  readonly restoreStatus: (
    sdSlug: string,
    component: string,
    saved: Map<string, SavedComponentStatus>
  ) => Effect.Effect<void>
  readonly save: Effect.Effect<void, StateCorruptionError>

  readonly toManifest: (
    sdSlug: string,
    catalog: CatalogSystem
  ) => Effect.Effect<SiteManifest | null>

  readonly init: (
    site: SiteInfo,
    workbench: WorkbenchInfo,
    mode: SiteMode
  ) => Effect.Effect<void>
}

export class SiteState extends Context.Tag("SiteState")<
  SiteState,
  ISiteState
>() {}
