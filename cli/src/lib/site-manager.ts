/**
 * SiteManager — reads/writes `.dx/site.json`, the canonical site state file.
 *
 * Same shape for dev sites, production sites, preview sites.
 * DB uses IDs; local file uses slugs. Shape is identical.
 */
import type {
  Condition,
  ComponentDeploymentMode,
  ComponentDeploymentStatus,
  LocalComponentDeployment,
  LocalSystemDeployment,
  SiteInfo,
  SiteState,
  WorkbenchInfo,
} from "@smp/factory-shared"
import { siteStateSchema } from "@smp/factory-shared"
import type { CatalogSystem } from "@smp/factory-shared/catalog"

import type { SiteManifest } from "../site/manifest.js"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

const SITE_FILE = join(".dx", "site.json")

export class SiteManager {
  private state: SiteState

  private constructor(
    private readonly rootDir: string,
    state: SiteState
  ) {
    this.state = state
  }

  /** Load existing site.json, or return null if none exists. */
  static load(rootDir: string): SiteManager | null {
    const path = join(rootDir, SITE_FILE)
    if (!existsSync(path)) return null
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"))
      const state = siteStateSchema.parse(raw)
      return new SiteManager(rootDir, state)
    } catch {
      return null
    }
  }

  /** Create a fresh site state. */
  static init(
    rootDir: string,
    site: SiteInfo,
    workbench: WorkbenchInfo
  ): SiteManager {
    const state: SiteState = {
      site,
      workbench,
      systemDeployments: [],
      updatedAt: new Date().toISOString(),
    }
    return new SiteManager(rootDir, state)
  }

  // ── System deployment CRUD ──────────────────────────────────

  getSystemDeployment(slug: string): LocalSystemDeployment | undefined {
    return this.state.systemDeployments.find((sd) => sd.slug === slug)
  }

  ensureSystemDeployment(
    slug: string,
    systemSlug: string,
    runtime: string,
    composeFiles: string[] = []
  ): LocalSystemDeployment {
    let sd = this.getSystemDeployment(slug)
    if (!sd) {
      sd = {
        slug,
        systemSlug,
        runtime,
        composeFiles,
        componentDeployments: [],
        resolvedEnv: {},
        tunnels: [],
      }
      this.state.systemDeployments.push(sd)
    }
    return sd
  }

  // ── Component deployment within a system deployment ─────────

  setComponentDeployment(sdSlug: string, cd: LocalComponentDeployment): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return

    const idx = sd.componentDeployments.findIndex(
      (c) => c.componentSlug === cd.componentSlug
    )
    if (idx >= 0) {
      sd.componentDeployments[idx] = cd
    } else {
      sd.componentDeployments.push(cd)
    }
  }

  removeComponentDeployment(sdSlug: string, componentSlug: string): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return
    sd.componentDeployments = sd.componentDeployments.filter(
      (c) => c.componentSlug !== componentSlug
    )
  }

  updateComponentStatus(
    sdSlug: string,
    componentSlug: string,
    status: Partial<ComponentDeploymentStatus>
  ): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    if (cd) {
      cd.status = { ...cd.status, ...status }
    }
  }

  /** Convenience: set mode + clear mode-specific fields, then set the right ones. */
  setComponentMode(
    sdSlug: string,
    componentSlug: string,
    mode: ComponentDeploymentMode,
    opts?: {
      workbenchSlug?: string
      serviceSlug?: string
      linkedRef?: { site: string; systemDeployment: string; component: string }
    }
  ): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return

    let cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    if (!cd) {
      cd = {
        componentSlug,
        mode,
        spec: { generation: 1 },
        status: { conditions: [] },
      }
      sd.componentDeployments.push(cd)
    }

    cd.mode = mode
    cd.workbenchSlug = undefined
    cd.serviceSlug = undefined
    cd.linkedRef = undefined

    if (mode === "native" && opts?.workbenchSlug) {
      cd.workbenchSlug = opts.workbenchSlug
    } else if (mode === "service" && opts?.serviceSlug) {
      cd.serviceSlug = opts.serviceSlug
    } else if (mode === "linked" && opts?.linkedRef) {
      cd.linkedRef = opts.linkedRef
    }
  }

  // ── Connection context ──────────────────────────────────────

  setResolvedEnv(
    sdSlug: string,
    envVars: LocalSystemDeployment["resolvedEnv"],
    tunnels: LocalSystemDeployment["tunnels"]
  ): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return
    sd.resolvedEnv = envVars
    sd.tunnels = tunnels
  }

  // ── Generation + Conditions ─────────────────────────────────

  /** Bump the spec generation for a component (signals desired state changed). */
  bumpGeneration(sdSlug: string, componentSlug: string): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    if (cd) {
      cd.spec.generation = (cd.spec.generation ?? 0) + 1
    }
  }

  /** Upsert a condition on a component's status. */
  setCondition(
    sdSlug: string,
    componentSlug: string,
    condition: Condition
  ): void {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    if (!cd) return

    const idx = cd.status.conditions.findIndex((c) => c.type === condition.type)
    if (idx >= 0) {
      cd.status.conditions[idx] = condition
    } else {
      cd.status.conditions.push(condition)
    }
  }

  /** Quick lookup for a component's deployment mode. */
  getComponentMode(
    sdSlug: string,
    componentSlug: string
  ): ComponentDeploymentMode | null {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    return cd?.mode ?? null
  }

  // ── Manifest conversion ────────────────────────────────────

  /** Convert local system deployment state → SiteManifest for the reconciler. */
  toManifest(sdSlug: string, catalog: CatalogSystem): SiteManifest | null {
    const sd = this.getSystemDeployment(sdSlug)
    if (!sd) return null

    return {
      version: 1,
      systemDeployment: {
        id: sd.slug,
        name: sd.systemSlug,
        site: this.state.site.slug,
        realmType: sd.runtime,
      },
      componentDeployments: sd.componentDeployments.map((cd) => ({
        id: cd.componentSlug,
        componentName: cd.componentSlug,
        desiredImage: cd.spec.desiredImage ?? "",
        replicas: cd.spec.replicas ?? 1,
        envOverrides: cd.spec.envOverrides ?? {},
        resourceOverrides: {},
        status:
          cd.status.phase === "stopped"
            ? ("stopped" as const)
            : ("running" as const),
      })),
      catalog,
    }
  }

  // ── Reads ───────────────────────────────────────────────────

  getState(): SiteState {
    return this.state
  }

  // ── Persistence ─────────────────────────────────────────────

  save(): void {
    this.state.updatedAt = new Date().toISOString()
    const path = join(this.rootDir, SITE_FILE)
    const tmpPath = path + ".tmp"
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2) + "\n", "utf8")
    renameSync(tmpPath, path)
  }
}
