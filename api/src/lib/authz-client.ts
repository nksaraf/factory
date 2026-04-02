import { logger } from "../logger";

/**
 * ABAC context passed alongside RBAC/ReBAC checks.
 * Evaluated AFTER SpiceDB slot/scope checks pass.
 */
export interface AuthzContext {
  ip?: string;
  userAgent?: string;
  geo?: { country?: string; region?: string };
  time?: string;
  aal?: "aal1" | "aal2" | "aal3";
  principalType?: "human" | "service" | "device" | "agent";
  [key: string]: unknown;
}

/**
 * HTTP client for the universal AuthZ API (`/authz/*`).
 *
 * Replaces `FactoryAuthResourceClient` (which calls `/resource-permissions/*`).
 * All methods are fire-and-forget for lifecycle operations — failures are
 * logged but non-fatal, matching the existing Factory pattern.
 */
export class FactoryAuthzClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // ─── Permission Checks ──────────────────────────────────────────────

  async checkPermission(params: {
    principal: string;
    action: string;
    resourceType: string;
    resourceId: string;
    context?: AuthzContext;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.allowed === true;
    } catch (err) {
      logger.warn(
        { err, resourceId: params.resourceId },
        "authz check error",
      );
      return false;
    }
  }

  async checkPermissionBatch(params: {
    principal: string;
    action: string;
    resourceType: string;
    resourceIds: string[];
    context?: AuthzContext;
  }): Promise<Map<string, boolean>> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/check/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        return new Map(params.resourceIds.map((id) => [id, false]));
      }
      const data = await res.json();
      const results = new Map<string, boolean>();
      for (const r of data.results ?? []) {
        results.set(r.resourceId, r.allowed === true);
      }
      return results;
    } catch (err) {
      logger.warn({ err }, "authz batch check error");
      return new Map(params.resourceIds.map((id) => [id, false]));
    }
  }

  async listAccessible(params: {
    principal: string;
    action: string;
    resourceType: string;
  }): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.resourceIds ?? [];
    } catch (err) {
      logger.warn({ err }, "authz list error");
      return [];
    }
  }

  async listSubjects(params: {
    action: string;
    resourceType: string;
    resourceId: string;
  }): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.subjectIds ?? [];
    } catch (err) {
      logger.warn({ err }, "authz subjects error");
      return [];
    }
  }

  // ─── Resource Lifecycle ─────────────────────────────────────────────

  async registerResource(params: {
    id: string;
    resourceTypeId: string;
    orgId: string;
    parentId?: string;
    createdBy?: string;
    scopes?: Array<{ scopeTypeId: string; scopeNodeId: string }>;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.id },
          "authz resource register failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.id },
        "authz resource register error",
      );
    }
  }

  async deleteResource(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/resources/${id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: id },
          "authz resource delete failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: id },
        "authz resource delete error",
      );
    }
  }

  async updateResourceScopes(params: {
    id: string;
    resourceTypeId: string;
    add?: Array<{ scopeTypeId: string; scopeNodeId: string }>;
    remove?: Array<{ scopeTypeId: string; scopeNodeId: string }>;
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/authz/resources/${params.id}/scopes/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceTypeId: params.resourceTypeId,
            add: params.add,
            remove: params.remove,
          }),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.id },
          "authz resource scopes update failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.id },
        "authz resource scopes update error",
      );
    }
  }

  // ─── Scope Node Lifecycle ───────────────────────────────────────────

  async registerScopeNode(params: {
    id: string;
    scopeTypeId: string;
    orgId: string;
    parentId?: string;
    path: string;
    label: string;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/scope-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, scopeNodeId: params.id },
          "authz scope node register failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, scopeNodeId: params.id },
        "authz scope node register error",
      );
    }
  }

  async deleteScopeNode(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/scope-nodes/${id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, scopeNodeId: id },
          "authz scope node delete failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, scopeNodeId: id },
        "authz scope node delete error",
      );
    }
  }

  async grantScopeMembership(params: {
    nodeId: string;
    principalId: string;
    role: "member" | "lead" | "admin";
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/authz/scope-nodes/${params.nodeId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principalId: params.principalId,
            role: params.role,
          }),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, nodeId: params.nodeId },
          "authz scope membership grant failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, nodeId: params.nodeId },
        "authz scope membership grant error",
      );
    }
  }

  async revokeScopeMembership(params: {
    nodeId: string;
    principalId: string;
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/authz/scope-nodes/${params.nodeId}/members/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ principalId: params.principalId }),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, nodeId: params.nodeId },
          "authz scope membership revoke failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, nodeId: params.nodeId },
        "authz scope membership revoke error",
      );
    }
  }

  // ─── Org Membership ─────────────────────────────────────────────────

  async addOrgMember(params: {
    orgId: string;
    principalId: string;
    isAdmin?: boolean;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/org-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: params.orgId,
          principalId: params.principalId,
          isAdmin: params.isAdmin ?? false,
        }),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, orgId: params.orgId },
          "authz org member add failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, orgId: params.orgId },
        "authz org member add error",
      );
    }
  }

  async removeOrgMember(params: {
    orgId: string;
    principalId: string;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/org-members/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, orgId: params.orgId },
          "authz org member remove failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, orgId: params.orgId },
        "authz org member remove error",
      );
    }
  }

  // ─── Resource Roles ─────────────────────────────────────────────────

  async grantResourceRole(params: {
    resourceId: string;
    principalId: string;
    slots: number[];
    mode?: "cascade" | "local";
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/authz/resources/${params.resourceId}/roles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principalId: params.principalId,
            slots: params.slots,
            mode: params.mode ?? "cascade",
          }),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.resourceId },
          "authz resource role grant failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.resourceId },
        "authz resource role grant error",
      );
    }
  }

  async revokeResourceRole(params: {
    resourceId: string;
    principalId: string;
    slots: number[];
  }): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/authz/resources/${params.resourceId}/roles/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principalId: params.principalId,
            slots: params.slots,
          }),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, resourceId: params.resourceId },
          "authz resource role revoke failed",
        );
      }
    } catch (err) {
      logger.warn(
        { err, resourceId: params.resourceId },
        "authz resource role revoke error",
      );
    }
  }

  // ─── Scope Resolution ───────────────────────────────────────────────

  async resolveScope(params: {
    principal: string;
    orgId: string;
    scopeType: string;
    action?: string;
  }): Promise<{ paths: string[]; unrestricted: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/authz/resolve-scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) return { paths: [], unrestricted: false };
      const data = await res.json();
      return {
        paths: data.paths ?? [],
        unrestricted: data.unrestricted === true,
      };
    } catch (err) {
      logger.warn({ err }, "authz scope resolution error");
      return { paths: [], unrestricted: false };
    }
  }
}
