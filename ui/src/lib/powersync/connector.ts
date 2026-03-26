/**
 * PowerSync connector — provides auth credentials and handles write uploads.
 *
 * - fetchCredentials(): returns the JWT and PowerSync service URL
 * - uploadData(): routes client writes through the existing Elysia REST API
 */
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  CrudEntry,
} from "@powersync/web"

export interface PowerSyncConnectorOptions {
  /** PowerSync service URL (e.g. http://localhost:8090) */
  powersyncUrl: string
  /** Factory API base URL for write-through (e.g. http://localhost:8181/api/v1/factory) */
  factoryApiUrl: string
}

export class FactoryPowerSyncConnector implements PowerSyncBackendConnector {
  private options: PowerSyncConnectorOptions

  constructor(options: PowerSyncConnectorOptions) {
    this.options = options
  }

  async fetchCredentials() {
    const token =
      localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")

    if (!token) {
      throw new Error("No auth token available for PowerSync")
    }

    return {
      endpoint: this.options.powersyncUrl,
      token,
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const tx = await database.getNextCrudTransaction()
    if (!tx) return

    try {
      for (const op of tx.crud) {
        await this.handleCrudOp(op)
      }
      await tx.complete()
    } catch (err) {
      console.error("[PowerSync] Upload failed:", err)
      throw err
    }
  }

  /**
   * Route individual CRUD operations to the appropriate Factory API endpoint.
   * This keeps the Elysia API as the single write authority for validation,
   * auth checks, and business logic.
   */
  private async handleCrudOp(op: CrudEntry): Promise<void> {
    const token =
      localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const baseUrl = this.options.factoryApiUrl

    // Map PowerSync table names to Factory API endpoints
    const endpointMap: Record<string, string> = {
      deployment_target: "/fleet/deployment-target",
      workload: "/fleet/workload",
      sandbox: "/fleet/sandbox",
      release: "/fleet/release",
      rollout: "/fleet/rollout",
      site: "/fleet/site",
    }

    const endpoint = endpointMap[op.table]
    if (!endpoint) {
      console.warn(
        `[PowerSync] No write endpoint mapped for table: ${op.table}`
      )
      return
    }

    const url = `${baseUrl}${endpoint}`

    switch (op.op) {
      case "PUT":
        await fetch(`${url}/${op.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(op.opData),
        })
        break
      case "PATCH":
        await fetch(`${url}/${op.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(op.opData),
        })
        break
      case "DELETE":
        await fetch(`${url}/${op.id}`, {
          method: "DELETE",
          headers,
        })
        break
    }
  }
}
