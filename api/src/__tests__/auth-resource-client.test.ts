import { afterEach, describe, expect, it, vi } from "vitest"

import { FactoryAuthResourceClient } from "../lib/auth-resource-client"

describe("FactoryAuthResourceClient", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("createResource calls correct endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    await client.createResource({
      id: "site_123",
      typeId: "rtype_site",
      displayName: "Prod East",
      organizationId: "org_acme",
      parentId: "team_platform",
      createdBy: "usr_alice",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://auth:3000/api/v1/auth/resource-permissions/resource/create",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("deleteResource calls correct endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    await client.deleteResource("site_123")
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://auth:3000/api/v1/auth/resource-permissions/resource/delete",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("checkPermission returns boolean", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    const allowed = await client.checkPermission({
      resourceId: "site_123",
      permission: "deploy",
      userId: "usr_bob",
    })
    expect(allowed).toBe(true)
  })

  it("checkPermission returns false on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    const allowed = await client.checkPermission({
      resourceId: "site_123",
      permission: "deploy",
      userId: "usr_bob",
    })
    expect(allowed).toBe(false)
  })

  it("swallows errors on createResource (fire-and-forget)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network")) as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    await client.createResource({ id: "x", typeId: "t" })
  })

  it("checkPermission returns false on network error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network")) as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    const allowed = await client.checkPermission({
      resourceId: "x",
      permission: "read",
      userId: "u",
    })
    expect(allowed).toBe(false)
  })

  it("createResourceType calls correct endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const client = new FactoryAuthResourceClient("http://auth:3000/api/v1/auth")
    await client.createResourceType({
      name: "site",
      displayName: "Site",
      allowedPermissions: ["create", "read", "deploy"],
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://auth:3000/api/v1/auth/resource-permissions/type/create",
      expect.objectContaining({ method: "POST" })
    )
  })
})
