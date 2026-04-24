import { Context, Effect } from "effect"
import type {
  DxContextWithProject,
  ProjectContextData,
  WorkbenchContextData,
} from "../../lib/dx-context.js"
import type { FocusSystem } from "./site-config.js"

export interface DiscoveredWorkspace {
  readonly focusSystem: FocusSystem
  readonly workbench: {
    readonly slug: string
    readonly kind: string
    readonly dir: string
    readonly branch?: string
  } | null
  readonly host: {
    readonly factoryUrl: string | null
  }
  /** @transitional Remove in Phase 8 cleanup — use focusSystem instead */
  readonly raw: DxContextWithProject
}

export interface IWorkspaceDiscovery {
  readonly discover: Effect.Effect<DiscoveredWorkspace>
}

export class WorkspaceDiscovery extends Context.Tag("WorkspaceDiscovery")<
  WorkspaceDiscovery,
  IWorkspaceDiscovery
>() {}
