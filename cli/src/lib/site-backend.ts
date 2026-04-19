/**
 * SiteBackend — state persistence interface for site lifecycle.
 *
 * Local = `.dx/site.json` (SiteManager).
 * Remote = Factory API (future — step 4).
 *
 * Commands read/write through this interface so `--site <slug>` transparently
 * routes to the right backend.
 */
import type {
  LocalSiteStatus,
  SiteSpec,
  SiteState,
  LocalSystemDeployment,
  ComponentDeploymentStatus,
} from "@smp/factory-shared"

export interface SiteBackend {
  readonly kind: "local" | "remote"

  getState(): Promise<SiteState>
  getSpec(): Promise<SiteSpec>
  getStatus(): Promise<LocalSiteStatus>

  getSystemDeployments(): Promise<LocalSystemDeployment[]>
  getComponentStatus(
    sdSlug: string,
    componentSlug: string
  ): Promise<ComponentDeploymentStatus | null>
}

// ── Local backend (wraps SiteManager) ──────────────────────

import { SiteManager } from "./site-manager.js"

export class LocalSiteBackend implements SiteBackend {
  readonly kind = "local" as const

  constructor(private readonly site: SiteManager) {}

  static load(rootDir: string): LocalSiteBackend | null {
    const site = SiteManager.load(rootDir)
    if (!site) return null
    return new LocalSiteBackend(site)
  }

  async getState(): Promise<SiteState> {
    return this.site.getState()
  }

  async getSpec(): Promise<SiteSpec> {
    return this.site.getSpec()
  }

  async getStatus(): Promise<LocalSiteStatus> {
    return this.site.getStatus()
  }

  async getSystemDeployments(): Promise<LocalSystemDeployment[]> {
    return this.site.getSpec().systemDeployments
  }

  async getComponentStatus(
    sdSlug: string,
    componentSlug: string
  ): Promise<ComponentDeploymentStatus | null> {
    const sd = this.site.getSystemDeployment(sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    return cd?.status ?? null
  }

  getSiteManager(): SiteManager {
    return this.site
  }
}

// ── Remote backend (Factory API) ───────────────────────────

import { siteStateSchema } from "@smp/factory-shared"
import type { FactoryClient } from "./api-client.js"

export class RemoteSiteBackend implements SiteBackend {
  readonly kind = "remote" as const
  private cached: SiteState | null = null

  constructor(
    readonly siteSlug: string,
    private readonly client: FactoryClient
  ) {}

  private async fetchState(): Promise<SiteState> {
    if (this.cached) return this.cached
    try {
      const raw = await this.client.request<unknown>(
        "GET",
        `/api/v1/factory/ops/site-live/${this.siteSlug}`
      )
      this.cached = siteStateSchema.parse(raw)
      return this.cached
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("404")) {
        throw new Error(
          `Site "${this.siteSlug}" not found, or the Factory API does not support the /state endpoint yet. ` +
            `Ensure the site exists and the API is updated.`
        )
      }
      throw new Error(
        `Failed to fetch state for site "${this.siteSlug}": ${msg}`
      )
    }
  }

  async getState(): Promise<SiteState> {
    return this.fetchState()
  }

  async getSpec(): Promise<SiteSpec> {
    const state = await this.fetchState()
    return state.spec
  }

  async getStatus(): Promise<LocalSiteStatus> {
    const state = await this.fetchState()
    return state.status
  }

  async getSystemDeployments(): Promise<LocalSystemDeployment[]> {
    const state = await this.fetchState()
    return state.spec.systemDeployments
  }

  async getComponentStatus(
    sdSlug: string,
    componentSlug: string
  ): Promise<ComponentDeploymentStatus | null> {
    const state = await this.fetchState()
    const sd = state.spec.systemDeployments.find((s) => s.slug === sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === componentSlug
    )
    return cd?.status ?? null
  }
}

// ── Resolver ───────────────────────────────────────────────

export async function resolveSiteBackend(opts: {
  siteSlug?: string
  rootDir?: string
}): Promise<SiteBackend> {
  if (opts.siteSlug) {
    const { getFactoryRestClient } = await import("../client.js")
    const client = await getFactoryRestClient()
    return new RemoteSiteBackend(opts.siteSlug, client)
  }

  if (!opts.rootDir) {
    throw new Error(
      "No --site flag and no project root found. Run from a project directory or pass --site <slug>."
    )
  }

  const local = LocalSiteBackend.load(opts.rootDir)
  if (!local) {
    throw new Error(
      "No site state found. Run `dx up` or `dx dev` first to create a site."
    )
  }

  return local
}
