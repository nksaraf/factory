import { Context } from "effect"
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema"
import type { DxProjectConfig } from "../../lib/dx-project-config.js"
import type { MonorepoPackage } from "../../lib/monorepo-topology.js"

export interface FocusSystem {
  readonly name: string
  readonly sdSlug: string
  readonly rootDir: string
  readonly catalog: CatalogSystem
  readonly composeFiles: string[]
  readonly conventions: ConventionsConfig
  readonly dxConfig: DxProjectConfig
  readonly packages: MonorepoPackage[]
}

export type SiteMode = "dev" | "up" | "controller"

export interface ConnectionFlags {
  readonly connectTo?: string
  readonly connect?: string[]
  readonly profile?: string
  readonly env?: string[]
}

export interface SessionFlags {
  readonly components?: string[]
  readonly noBuild?: boolean
  readonly tunnel?: boolean
  readonly exposeConsole?: boolean
  readonly dryRun?: boolean
  readonly restart?: boolean
  readonly targets?: string[]
  readonly profiles?: string[]
  readonly detach?: boolean
  readonly quiet?: boolean
}

export interface SiteConfig {
  readonly mode: SiteMode
  readonly workingDir: string
  readonly port: number
  readonly focusSystem: FocusSystem
  readonly siteName?: string
  readonly controllerMode?: "connected" | "standalone" | "air-gapped"
  readonly reconcileIntervalMs: number
  readonly connectionFlags?: ConnectionFlags
  readonly sessionFlags?: SessionFlags
}

export class SiteConfigTag extends Context.Tag("SiteConfig")<
  SiteConfigTag,
  SiteConfig
>() {}
