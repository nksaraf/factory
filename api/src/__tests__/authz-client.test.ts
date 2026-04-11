import { afterEach, describe, expect, it, vi } from "vitest"

import { FactoryAuthzClient } from "../lib/authz-client"

const BASE = "http://auth:3000/api/v1/auth"

function mockFetch(response: Partial<Response> = { ok: true }) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    ...response,
  })
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

describe("FactoryAuthzClient", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ─── Permission Checks ──────────────────────────────────────────────

  describe("checkPermission", () => {
    it("calls POST /authz/check and returns body.allowed", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({ allowed: true, reason: "allowed" }),
      })
      const client = new FactoryAuthzClient(BASE)
      const result = await client.checkPermission({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(result).toBe(true)
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/check`,
        expect.objectContaining({ method: "POST" })
      )
    })

    it("returns false when body.allowed is false", async () => {
      mockFetch({
        ok: true,
        json: async () => ({ allowed: false, reason: "resource_slot_denied" }),
      })
      const client = new FactoryAuthzClient(BASE)
      const result = await client.checkPermission({
        principal: "user-1",
        action: "delete",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(result).toBe(false)
    })

    it("returns false on network error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network")) as unknown as typeof fetch
      const client = new FactoryAuthzClient(BASE)
      const result = await client.checkPermission({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(result).toBe(false)
    })

    it("returns false on non-OK response", async () => {
      mockFetch({ ok: false, status: 500 } as any)
      const client = new FactoryAuthzClient(BASE)
      const result = await client.checkPermission({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(result).toBe(false)
    })

    it("passes ABAC context in request body", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({ allowed: true }),
      })
      const client = new FactoryAuthzClient(BASE)
      await client.checkPermission({
        principal: "user-1",
        action: "delete",
        resourceType: "sandbox",
        resourceId: "sb-1",
        context: { aal: "aal2", ip: "10.0.1.5" },
      })
      const body = JSON.parse(spy.mock.calls[0][1].body)
      expect(body.context).toEqual({ aal: "aal2", ip: "10.0.1.5" })
    })
  })

  describe("checkPermissionBatch", () => {
    it("calls POST /authz/check/batch and maps results", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({
          results: [
            { resourceId: "sb-1", allowed: true },
            { resourceId: "sb-2", allowed: false },
          ],
        }),
      })
      const client = new FactoryAuthzClient(BASE)
      const results = await client.checkPermissionBatch({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceIds: ["sb-1", "sb-2"],
      })
      expect(results.get("sb-1")).toBe(true)
      expect(results.get("sb-2")).toBe(false)
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/check/batch`,
        expect.objectContaining({ method: "POST" })
      )
    })

    it("returns all-false on network error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network")) as unknown as typeof fetch
      const client = new FactoryAuthzClient(BASE)
      const results = await client.checkPermissionBatch({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceIds: ["sb-1", "sb-2"],
      })
      expect(results.get("sb-1")).toBe(false)
      expect(results.get("sb-2")).toBe(false)
    })
  })

  describe("listAccessible", () => {
    it("calls POST /authz/list and returns resourceIds", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({ resourceIds: ["sb-1", "sb-3"] }),
      })
      const client = new FactoryAuthzClient(BASE)
      const ids = await client.listAccessible({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
      })
      expect(ids).toEqual(["sb-1", "sb-3"])
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/list`,
        expect.objectContaining({ method: "POST" })
      )
    })

    it("returns empty on error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network")) as unknown as typeof fetch
      const client = new FactoryAuthzClient(BASE)
      const ids = await client.listAccessible({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
      })
      expect(ids).toEqual([])
    })
  })

  describe("listSubjects", () => {
    it("calls POST /authz/subjects and returns subjectIds", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({ subjectIds: ["user-1", "user-2"] }),
      })
      const client = new FactoryAuthzClient(BASE)
      const ids = await client.listSubjects({
        action: "read",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(ids).toEqual(["user-1", "user-2"])
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/subjects`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  // ─── Resource Lifecycle ─────────────────────────────────────────────

  describe("registerResource", () => {
    it("calls POST /authz/resources", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.registerResource({
        id: "sb-1",
        resourceTypeId: "sandbox",
        orgId: "org-1",
        createdBy: "user-1",
        scopes: [{ scopeTypeId: "team", scopeNodeId: "team-alpha" }],
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resources`,
        expect.objectContaining({ method: "POST" })
      )
    })

    it("swallows network errors", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network")) as unknown as typeof fetch
      const client = new FactoryAuthzClient(BASE)
      await client.registerResource({
        id: "sb-1",
        resourceTypeId: "sandbox",
        orgId: "org-1",
      })
      // no throw
    })
  })

  describe("deleteResource", () => {
    it("calls POST /authz/resources/:id/delete", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.deleteResource("sb-1")
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resources/sb-1/delete`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  describe("updateResourceScopes", () => {
    it("calls POST /authz/resources/:id/scopes/update", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.updateResourceScopes({
        id: "sb-1",
        resourceTypeId: "sandbox",
        add: [{ scopeTypeId: "team", scopeNodeId: "team-beta" }],
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resources/sb-1/scopes/update`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  // ─── Scope Node Lifecycle ───────────────────────────────────────────

  describe("registerScopeNode", () => {
    it("calls POST /authz/scope-nodes", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.registerScopeNode({
        id: "team-alpha",
        scopeTypeId: "team",
        orgId: "org-1",
        path: "engineering.platform",
        label: "Platform",
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/scope-nodes`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  describe("deleteScopeNode", () => {
    it("calls POST /authz/scope-nodes/:id/delete", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.deleteScopeNode("team-alpha")
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/scope-nodes/team-alpha/delete`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  describe("grantScopeMembership", () => {
    it("calls POST /authz/scope-nodes/:id/members", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.grantScopeMembership({
        nodeId: "team-alpha",
        principalId: "user-1",
        role: "member",
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/scope-nodes/team-alpha/members`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  describe("revokeScopeMembership", () => {
    it("calls POST /authz/scope-nodes/:id/members/revoke", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.revokeScopeMembership({
        nodeId: "team-alpha",
        principalId: "user-1",
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/scope-nodes/team-alpha/members/revoke`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  // ─── Org Membership ─────────────────────────────────────────────────

  describe("addOrgMember", () => {
    it("calls POST /authz/org-members", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.addOrgMember({
        orgId: "org-1",
        principalId: "user-1",
        isAdmin: true,
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/org-members`,
        expect.objectContaining({ method: "POST" })
      )
      const body = JSON.parse(spy.mock.calls[0][1].body)
      expect(body.isAdmin).toBe(true)
    })
  })

  describe("removeOrgMember", () => {
    it("calls POST /authz/org-members/remove with body", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.removeOrgMember({
        orgId: "org-1",
        principalId: "user-1",
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/org-members/remove`,
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  // ─── Resource Roles ─────────────────────────────────────────────────

  describe("grantResourceRole", () => {
    it("calls POST /authz/resources/:id/roles", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.grantResourceRole({
        resourceId: "sb-1",
        principalId: "user-1",
        slots: [1, 2, 3],
        mode: "cascade",
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resources/sb-1/roles`,
        expect.objectContaining({ method: "POST" })
      )
      const body = JSON.parse(spy.mock.calls[0][1].body)
      expect(body.slots).toEqual([1, 2, 3])
      expect(body.mode).toBe("cascade")
    })
  })

  describe("revokeResourceRole", () => {
    it("calls POST /authz/resources/:id/roles/revoke with body", async () => {
      const spy = mockFetch()
      const client = new FactoryAuthzClient(BASE)
      await client.revokeResourceRole({
        resourceId: "sb-1",
        principalId: "user-1",
        slots: [3, 4],
      })
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resources/sb-1/roles/revoke`,
        expect.objectContaining({ method: "POST" })
      )
      const body = JSON.parse(spy.mock.calls[0][1].body)
      expect(body.slots).toEqual([3, 4])
    })
  })

  // ─── Scope Resolution ───────────────────────────────────────────────

  describe("resolveScope", () => {
    it("calls POST /authz/resolve-scope and returns result", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({
          paths: ["engineering", "engineering.platform"],
          unrestricted: false,
        }),
      })
      const client = new FactoryAuthzClient(BASE)
      const result = await client.resolveScope({
        principal: "user-1",
        orgId: "org-1",
        scopeType: "team",
        action: "view",
      })
      expect(result.paths).toEqual(["engineering", "engineering.platform"])
      expect(result.unrestricted).toBe(false)
      expect(spy).toHaveBeenCalledWith(
        `${BASE}/authz/resolve-scope`,
        expect.objectContaining({ method: "POST" })
      )
    })

    it("returns empty on error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network")) as unknown as typeof fetch
      const client = new FactoryAuthzClient(BASE)
      const result = await client.resolveScope({
        principal: "user-1",
        orgId: "org-1",
        scopeType: "team",
      })
      expect(result.paths).toEqual([])
      expect(result.unrestricted).toBe(false)
    })
  })

  // ─── URL Handling ───────────────────────────────────────────────────

  describe("URL normalization", () => {
    it("strips trailing slashes from base URL", async () => {
      const spy = mockFetch({
        ok: true,
        json: async () => ({ allowed: true }),
      })
      const client = new FactoryAuthzClient("http://auth:3000///")
      await client.checkPermission({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceId: "sb-1",
      })
      expect(spy.mock.calls[0][0]).toBe("http://auth:3000/authz/check")
    })
  })
})
