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

// ── Remote backend (stub — implemented in step 4) ──────────

export class RemoteSiteBackend implements SiteBackend {
  readonly kind = "remote" as const

  constructor(readonly siteSlug: string) {}

  async getState(): Promise<SiteState> {
    throw new Error(
      `Remote site operations not yet implemented. Site: ${this.siteSlug}`
    )
  }

  async getSpec(): Promise<SiteSpec> {
    throw new Error(
      `Remote site operations not yet implemented. Site: ${this.siteSlug}`
    )
  }

  async getStatus(): Promise<LocalSiteStatus> {
    throw new Error(
      `Remote site operations not yet implemented. Site: ${this.siteSlug}`
    )
  }

  async getSystemDeployments(): Promise<LocalSystemDeployment[]> {
    throw new Error(
      `Remote site operations not yet implemented. Site: ${this.siteSlug}`
    )
  }

  async getComponentStatus(): Promise<ComponentDeploymentStatus | null> {
    throw new Error(
      `Remote site operations not yet implemented. Site: ${this.siteSlug}`
    )
  }
}

// ── Resolver ───────────────────────────────────────────────

export function resolveSiteBackend(opts: {
  siteSlug?: string
  rootDir?: string
}): SiteBackend {
  if (opts.siteSlug) {
    return new RemoteSiteBackend(opts.siteSlug)
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
