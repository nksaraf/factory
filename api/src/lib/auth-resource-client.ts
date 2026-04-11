import { logger } from "../logger"

/**
 * @deprecated Use {@link FactoryAuthzClient} from `./authz-client` instead.
 * This client targets the old `/resource-permissions/*` endpoints.
 * The new `FactoryAuthzClient` targets `/authz/*` with SpiceDB-backed
 * ReBAC, scope-based access, and ABAC context policies.
 */
export class FactoryAuthResourceClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  async createResource(params: {
    id: string
    typeId: string
    displayName?: string
    organizationId?: string
    parentId?: string | null
    createdBy?: string
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/resource-permissions/resource/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      )
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.id },
          "auth resource sync: create failed"
        )
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.id },
        "auth resource sync: create error"
      )
    }
  }

  async deleteResource(id: string): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/resource-permissions/resource/delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }
      )
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: id },
          "auth resource sync: delete failed"
        )
      }
    } catch (err) {
      logger.warn({ err, resourceId: id }, "auth resource sync: delete error")
    }
  }

  async updateResource(params: {
    id: string
    parentId?: string | null
    displayName?: string
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/resource-permissions/resource/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      )
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.id },
          "auth resource sync: update failed"
        )
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.id },
        "auth resource sync: update error"
      )
    }
  }

  async checkPermission(params: {
    resourceId: string
    permission: string
    userId: string
  }): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/resource-permissions/permission/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      )
      if (!res.ok) return false
      const data = await res.json()
      return data.success === true
    } catch (err) {
      logger.warn(
        { err, resourceId: params.resourceId },
        "auth permission check error"
      )
      return false
    }
  }

  async createResourceType(params: {
    name: string
    displayName: string
    allowedPermissions: string[]
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/resource-permissions/type/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      )
      if (!res.ok) {
        logger.warn(
          { status: res.status, type: params.name },
          "auth resource type sync: create failed"
        )
      }
    } catch (err) {
      logger.warn(
        { err, type: params.name },
        "auth resource type sync: create error"
      )
    }
  }
}
