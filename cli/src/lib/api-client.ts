export class FactoryClient {
  readonly url: string
  private token?: string

  constructor(
    baseUrl: string = process.env.DX_API_URL ?? "http://localhost:3000",
    token?: string
  ) {
    this.url = baseUrl
    this.token = token
  }

  /** Build auth headers for raw fetch calls (e.g. SSE streaming). */
  authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {}
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
    return res.json()
  }

  // Ops API methods — releases
  async listReleases(opts?: { status?: string }) {
    return this.request(
      "GET",
      `/api/v1/factory/ops/releases${opts?.status ? `?status=${opts.status}` : ""}`
    )
  }
  async createRelease(body: { version: string }) {
    return this.request("POST", "/api/v1/factory/ops/releases", body)
  }
  async getRelease(version: string) {
    return this.request("GET", `/api/v1/factory/ops/releases/${version}`)
  }
  async promoteRelease(version: string, body: { target?: string }) {
    return this.request(
      "POST",
      `/api/v1/factory/ops/releases/${version}/promote`,
      body
    )
  }

  // Ops API methods — sites
  async listSites() {
    return this.request("GET", "/api/v1/factory/ops/sites")
  }
  async createSite(body: { name: string; product: string }) {
    return this.request("POST", "/api/v1/factory/ops/sites", body)
  }
  async getSite(name: string) {
    return this.request("GET", `/api/v1/factory/ops/sites/${name}`)
  }
  async deleteSite(name: string) {
    return this.request("POST", `/api/v1/factory/ops/sites/${name}/delete`)
  }
  async assignReleaseToSite(name: string, body: { releaseVersion: string }) {
    return this.request(
      "POST",
      `/api/v1/factory/ops/sites/${name}/assign-release`,
      body
    )
  }
  async siteCheckin(name: string, body: Record<string, unknown>) {
    return this.request(
      "POST",
      `/api/v1/factory/ops/sites/${name}/checkin`,
      body
    )
  }
  async getSiteManifest(name: string) {
    return this.request("GET", `/api/v1/factory/ops/sites/${name}/manifest`)
  }

  // Ops API methods — workbenches
  async listWorkbenches(opts?: { all?: boolean }) {
    return this.request(
      "GET",
      `/api/v1/factory/ops/workbenches${opts?.all ? "?all=true" : ""}`
    )
  }
  async createWorkbench(body: Record<string, unknown>) {
    return this.request("POST", "/api/v1/factory/ops/workbenches", body)
  }
  async destroyWorkbench(id: string) {
    return this.request("POST", `/api/v1/factory/ops/workbenches/${id}/delete`)
  }

  // Ops API methods — rollouts
  async listRollouts() {
    return this.request("GET", "/api/v1/factory/ops/rollouts")
  }
  async createRollout(body: { releaseId: string; systemDeploymentId: string }) {
    return this.request("POST", "/api/v1/factory/ops/rollouts", body)
  }
  async getRollout(id: string) {
    return this.request("GET", `/api/v1/factory/ops/rollouts/${id}`)
  }

  // Ops API methods — system deployments
  async listSystemDeployments(opts?: { kind?: string; status?: string }) {
    return this.request("GET", `/api/v1/factory/ops/system-deployments`)
  }
  async getSystemDeployment(id: string) {
    return this.request("GET", `/api/v1/factory/ops/system-deployments/${id}`)
  }

  // Ops API methods — workbench snapshots
  async listWorkbenchSnapshots() {
    return this.request("GET", "/api/v1/factory/ops/workbench-snapshots")
  }
  async getWorkbenchSnapshot(id: string) {
    return this.request("GET", `/api/v1/factory/ops/workbench-snapshots/${id}`)
  }
  async deleteWorkbenchSnapshot(id: string) {
    return this.request(
      "POST",
      `/api/v1/factory/ops/workbench-snapshots/${id}/delete`
    )
  }

  // Generic CRUD for dynamic module/entity paths (Eden can't type runtime-variable paths)
  async getEntity(
    module: string,
    entity: string,
    slugOrId: string
  ): Promise<{ data: Record<string, unknown> | null }> {
    return this.request(
      "GET",
      `/api/v1/factory/${module}/${entity}/${slugOrId}`
    )
  }
  async listEntities(
    module: string,
    entity: string
  ): Promise<{ data: Record<string, unknown>[] }> {
    return this.request("GET", `/api/v1/factory/${module}/${entity}`)
  }
  async createEntity(
    module: string,
    entity: string,
    body: Record<string, unknown>
  ): Promise<{ data: unknown }> {
    return this.request("POST", `/api/v1/factory/${module}/${entity}`, body)
  }
  async updateEntity(
    module: string,
    entity: string,
    slugOrId: string,
    body: Record<string, unknown>
  ): Promise<{ data: unknown }> {
    return this.request(
      "POST",
      `/api/v1/factory/${module}/${entity}/${slugOrId}/update`,
      body
    )
  }
  async deleteEntity(
    module: string,
    entity: string,
    slugOrId: string
  ): Promise<{ deleted: boolean }> {
    return this.request(
      "POST",
      `/api/v1/factory/${module}/${entity}/${slugOrId}/delete`
    )
  }

  async entityAction(
    module: string,
    entity: string,
    slugOrId: string,
    action: string,
    body?: Record<string, unknown>
  ): Promise<{ data: unknown; action: string }> {
    return this.request(
      "POST",
      `/api/v1/factory/${module}/${entity}/${slugOrId}/${action}`,
      body ?? {}
    )
  }

  // Infra API — generic action on an entity (Eden can't type dynamic action paths)
  async infraAction(
    entity: string,
    slugOrId: string,
    action: string,
    body?: Record<string, unknown>
  ) {
    return this.request<{ data: unknown }>(
      "POST",
      `/api/v1/factory/infra/${entity}/${slugOrId}/${action}`,
      body ?? {}
    )
  }

  // Infra API — inventory scanner
  async inventoryScan(entities: unknown[], dryRun = false): Promise<unknown> {
    return this.request("POST", "/api/v1/factory/infra/inventory", {
      entities,
      dryRun,
    })
  }

  // Infra API — inventory export (reads DB, returns YAML-ready entity groups)
  async inventoryExport(kinds?: string[]): Promise<unknown> {
    return this.request(
      "POST",
      "/api/v1/factory/infra/inventory/export",
      kinds?.length ? { kinds } : {}
    )
  }

  // Infra API — DNS provider sync
  async dnsScan(estateId: string) {
    return this.request("POST", "/api/v1/factory/infra/dns-sync", { estateId })
  }

  // Infra API — ip-addresses (hyphenated path, Eden can't see ontologyRoutes CRUD)
  async listIpAddresses(query?: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    if (query)
      for (const [k, v] of Object.entries(query)) {
        if (v) params.set(k, v)
      }
    const qs = params.toString()
    return this.request<{ data: unknown[] }>(
      "GET",
      `/api/v1/factory/infra/ip-addresses${qs ? `?${qs}` : ""}`
    )
  }
  async listAvailableIps(query?: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    if (query)
      for (const [k, v] of Object.entries(query)) {
        if (v) params.set(k, v)
      }
    const qs = params.toString()
    return this.request<{ data: unknown[] }>(
      "GET",
      `/api/v1/factory/infra/ip-addresses/available${qs ? `?${qs}` : ""}`
    )
  }
  async registerIpAddress(body: Record<string, unknown>) {
    return this.request<{ data: unknown }>(
      "POST",
      "/api/v1/factory/infra/ip-addresses",
      body
    )
  }
  async ipAddressAction(
    slugOrId: string,
    action: string,
    body?: Record<string, unknown>
  ) {
    return this.request<{ data: unknown }>(
      "POST",
      `/api/v1/factory/infra/ip-addresses/${slugOrId}/${action}`,
      body ?? {}
    )
  }
}
