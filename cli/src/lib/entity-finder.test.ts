import { beforeEach, describe, expect, it, mock } from "bun:test"

import { EntityFinder } from "./entity-finder.js"

// ─── Mock the factory client (Bun: mock.module + live ref for beforeEach) ───

type MockCtx = {
  workbenchesListGet: ReturnType<typeof mock>
  workbenchesByIdGet: ReturnType<typeof mock>
  hostsListGet: ReturnType<typeof mock>
  hostsByIdGet: ReturnType<typeof mock>
  accessResolveGet: ReturnType<typeof mock>
}

const mockClientCtx: { api: MockCtx | null } = { api: null }

function workbenchesCollection(ctx: MockCtx) {
  function workbenches(_opts: { slugOrId: string }) {
    return { get: ctx.workbenchesByIdGet }
  }
  ;(workbenches as unknown as { get: ReturnType<typeof mock> }).get =
    ctx.workbenchesListGet
  return workbenches
}

mock.module("../client.js", () => ({
  getFactoryClient: () => {
    const ctx = mockClientCtx.api
    if (!ctx) {
      throw new Error("entity-finder test: mockClientCtx.api not set")
    }
    return Promise.resolve({
      api: {
        v1: {
          factory: {
            ops: {
              workbenches: workbenchesCollection(ctx),
            },
            infra: {
              access: {
                resolve: (_opts: { slug: string }) => ({
                  get: ctx.accessResolveGet,
                }),
              },
            },
          },
        },
      },
    })
  },
  getFactoryRestClient: () => {
    const ctx = mockClientCtx.api
    if (!ctx) {
      throw new Error("entity-finder test: mockClientCtx.api not set")
    }
    return Promise.resolve({
      listEntities: async (_module: string, _entity: string) => {
        const res = await ctx.hostsListGet()
        return { data: res?.data?.data ?? [] }
      },
      getEntity: async (_module: string, _entity: string, slugOrId: string) => {
        const res = await ctx.hostsByIdGet({ slugOrId })
        return { data: res?.data?.data ?? res?.data ?? null }
      },
    })
  },
}))

let mockApi: MockCtx

function emptyResponse() {
  return { data: { data: [] } }
}

function listResponse(items: unknown[]) {
  return { data: { data: items } }
}

function notFoundGet() {
  return mock().mockRejectedValue(new Error("not found"))
}

describe("EntityFinder", () => {
  beforeEach(() => {
    mockApi = {
      workbenchesListGet: mock().mockResolvedValue(emptyResponse()),
      workbenchesByIdGet: notFoundGet(),
      hostsListGet: mock().mockResolvedValue(emptyResponse()),
      hostsByIdGet: notFoundGet(),
      accessResolveGet: notFoundGet(),
    }
    mockClientCtx.api = mockApi
  })

  describe("resolve() — transport type assignment", () => {
    it("resolves a VM as SSH transport", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "vm_123",
            name: "lepton-59",
            slug: "lepton-59",
            type: "vm",
            spec: { lifecycle: "running", ipAddress: "192.168.1.59" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-59")

      expect(entity).not.toBeNull()
      expect(entity!.type).toBe("vm")
      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshHost).toBe("192.168.1.59")
      expect(entity!.podName).toBeUndefined()
    })

    it("resolves a host as SSH transport", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "host_456",
            name: "lepton-squirtle",
            slug: "lepton-squirtle",
            type: "bare-metal",
            spec: { lifecycle: "active", ipAddress: "192.168.1.1" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-squirtle")

      expect(entity).not.toBeNull()
      expect(entity!.type).toBe("host")
      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshHost).toBe("192.168.1.1")
    })

    it("resolves a container workbench as kubectl transport", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(
        listResponse([
          {
            id: "sbx_789",
            name: "Maria Network Access Dev",
            slug: "maria-network-access-dev",
            spec: { realmType: "container", lifecycle: "running" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("maria-network-access-dev")

      expect(entity).not.toBeNull()
      expect(entity!.type).toBe("workbench")
      expect(entity!.transport).toBe("kubectl")
      expect(entity!.podName).toBeDefined()
    })

    it("resolves a VM-backed workbench as SSH transport", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(
        listResponse([
          {
            id: "sbx_vm1",
            name: "VM Sandbox",
            slug: "vm-sandbox",
            spec: {
              realmType: "vm",
              lifecycle: "running",
              ipAddress: "10.0.0.5",
            },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("vm-sandbox")

      expect(entity).not.toBeNull()
      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshHost).toBe("10.0.0.5")
      expect(entity!.podName).toBeUndefined()
    })
  })

  describe("resolve() — priority order", () => {
    it("workbench match takes priority over host with same slug", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(
        listResponse([
          {
            id: "sbx_1",
            name: "dev-box",
            slug: "dev-box",
            spec: {
              realmType: "vm",
              lifecycle: "running",
              ipAddress: "10.0.0.1",
            },
          },
        ])
      )
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "vm_1",
            name: "dev-box",
            slug: "dev-box",
            type: "vm",
            spec: { ipAddress: "10.0.0.2" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("dev-box")

      expect(entity!.id).toBe("sbx_1")
    })

    it("falls through to hosts when no workbench matches", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "vm_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            type: "vm",
            spec: { ipAddress: "192.168.1.59" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-59")

      expect(entity!.type).toBe("vm")
      expect(entity!.transport).toBe("ssh")
    })

    it("uses host list when workbench phase finds nothing", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "host_59",
            name: "lepton-59",
            slug: "lepton-59",
            type: "bare-metal",
            spec: { ipAddress: "192.168.1.59" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-59")

      expect(entity!.type).toBe("host")
      expect(entity!.transport).toBe("ssh")
    })

    it("returns null when nothing matches", async () => {
      const finder = new EntityFinder()
      const entity = await finder.resolve("nonexistent")

      expect(entity).toBeNull()
    })
  })

  describe("resolve() — list endpoints (no server-side slug filter)", () => {
    it("loads workbenches via list get()", async () => {
      const finder = new EntityFinder()
      await finder.resolve("lepton-59")

      expect(mockApi.workbenchesListGet).toHaveBeenCalled()
    })

    it("loads hosts via list get() when resolving", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "h1",
            slug: "lepton-59",
            name: "lepton-59",
            spec: { ipAddress: "10.0.0.1" },
          },
        ])
      )
      const finder = new EntityFinder()
      await finder.resolve("lepton-59")

      expect(mockApi.hostsListGet).toHaveBeenCalled()
    })
  })

  describe("resolve() — the lepton-59 bug scenario", () => {
    it("does NOT resolve lepton-59 as an unrelated workbench", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(emptyResponse())
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "host_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            type: "bare-metal",
            spec: { ipAddress: "192.168.1.59" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-59")

      expect(entity!.type).toBe("host")
      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshHost).toBe("192.168.1.59")
      expect(entity!.transport).not.toBe("kubectl")
    })

    it("correctly falls through when list includes unrelated workbenches", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(
        listResponse([
          {
            id: "sbx_maria",
            name: "Maria Network Access Dev",
            slug: "maria-network-access-dev",
            spec: { realmType: "container", lifecycle: "running" },
          },
        ])
      )
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "host_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            type: "bare-metal",
            spec: { ipAddress: "192.168.1.59" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("lepton-59")

      expect(entity!.type).toBe("host")
      expect(entity!.slug).toBe("lepton-59")
      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshHost).toBe("192.168.1.59")
    })
  })

  describe("default transport values", () => {
    it("workbench without realmType defaults to container/kubectl", async () => {
      mockApi.workbenchesListGet.mockResolvedValue(
        listResponse([
          {
            id: "sbx_no_rt",
            name: "no-runtime",
            slug: "no-runtime",
            spec: { lifecycle: "running" },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("no-runtime")

      expect(entity!.realmType).toBe("container")
      expect(entity!.transport).toBe("kubectl")
    })

    it("VM host always gets SSH transport", async () => {
      mockApi.hostsListGet.mockResolvedValue(
        listResponse([
          {
            id: "vm_win",
            name: "windows-vm",
            slug: "windows-vm",
            type: "vm",
            spec: {
              ipAddress: "192.168.2.90",
              accessUser: "Administrator",
            },
          },
        ])
      )

      const finder = new EntityFinder()
      const entity = await finder.resolve("windows-vm")

      expect(entity!.transport).toBe("ssh")
      expect(entity!.sshUser).toBe("Administrator")
    })
  })
})
