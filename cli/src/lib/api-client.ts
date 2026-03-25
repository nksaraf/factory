export class FactoryClient {
  constructor(
    private baseUrl: string = process.env.DX_API_URL ?? "http://localhost:3000",
    private token?: string
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
    return res.json()
  }

  // Fleet API methods — releases
  async listReleases(opts?: { status?: string }) {
    return this.request("GET", `/api/v1/fleet/releases${opts?.status ? `?status=${opts.status}` : ""}`)
  }
  async createRelease(body: { version: string }) {
    return this.request("POST", "/api/v1/fleet/releases", body)
  }
  async getRelease(version: string) {
    return this.request("GET", `/api/v1/fleet/releases/${version}`)
  }
  async promoteRelease(version: string, body: { target?: string }) {
    return this.request("POST", `/api/v1/fleet/releases/${version}/promote`, body)
  }

  // Fleet API methods — sites
  async listSites() {
    return this.request("GET", "/api/v1/fleet/sites")
  }
  async createSite(body: { name: string; product: string }) {
    return this.request("POST", "/api/v1/fleet/sites", body)
  }
  async getSite(name: string) {
    return this.request("GET", `/api/v1/fleet/sites/${name}`)
  }
  async deleteSite(name: string) {
    return this.request("DELETE", `/api/v1/fleet/sites?name=${name}`)
  }
  async assignReleaseToSite(name: string, body: { releaseVersion: string }) {
    return this.request("POST", `/api/v1/fleet/sites/${name}/assign-release`, body)
  }
  async siteCheckin(name: string, body: Record<string, unknown>) {
    return this.request("POST", `/api/v1/fleet/sites/${name}/checkin`, body)
  }
  async getSiteManifest(name: string) {
    return this.request("GET", `/api/v1/fleet/sites/${name}/manifest`)
  }

  // Fleet API methods — sandboxes
  async listSandboxes(opts?: { all?: boolean }) {
    return this.request("GET", `/api/v1/fleet/sandboxes${opts?.all ? "?all=true" : ""}`)
  }
  async createSandbox(body: Record<string, unknown>) {
    return this.request("POST", "/api/v1/fleet/sandboxes", body)
  }
  async destroySandbox(id: string) {
    return this.request("DELETE", `/api/v1/fleet/sandboxes/${id}`)
  }

  // Fleet API methods — rollouts
  async listRollouts() {
    return this.request("GET", "/api/v1/fleet/rollouts")
  }
  async createRollout(body: { releaseId: string; deploymentTargetId: string }) {
    return this.request("POST", "/api/v1/fleet/rollouts", body)
  }
  async getRollout(id: string) {
    return this.request("GET", `/api/v1/fleet/rollouts/${id}`)
  }

  // Fleet API methods — deployment targets
  async listDeploymentTargets(opts?: { kind?: string; status?: string }) {
    return this.request("GET", `/api/v1/fleet/deployment-targets`)
  }
  async getDeploymentTarget(id: string) {
    return this.request("GET", `/api/v1/fleet/deployment-targets/${id}`)
  }

  // Fleet API methods — snapshots
  async listSnapshots() {
    return this.request("GET", "/api/v1/fleet/snapshots")
  }
  async getSnapshot(id: string) {
    return this.request("GET", `/api/v1/fleet/snapshots/${id}`)
  }
  async deleteSnapshot(id: string) {
    return this.request("DELETE", `/api/v1/fleet/snapshots/${id}`)
  }
}
