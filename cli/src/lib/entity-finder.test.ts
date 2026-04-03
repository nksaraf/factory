import { describe, expect, it, vi, beforeEach } from "vitest";
import { EntityFinder, type ResolvedEntity } from "./entity-finder.js";

// ─── Mock the factory client ────────────────────────────────────
// We intercept getFactoryClient so EntityFinder talks to our fake API.

type MockEndpoint = {
  sandboxes: { get: ReturnType<typeof vi.fn>; [k: string]: any };
  vms: { get: ReturnType<typeof vi.fn>; [k: string]: any };
  hosts: { get: ReturnType<typeof vi.fn>; [k: string]: any };
};

let mockEndpoints: MockEndpoint;

vi.mock("../client.js", () => ({
  getFactoryClient: () => {
    // Each endpoint supports .get({ query }) for list and (id).get() for by-ID
    const makeEndpoint = (ep: { get: ReturnType<typeof vi.fn> }) => {
      const fn = (opts: { id: string }) => ({
        get: vi.fn().mockRejectedValue(new Error("not found")),
      });
      fn.get = ep.get;
      return fn;
    };

    return Promise.resolve({
      api: {
        v1: {
          factory: {
            infra: {
              sandboxes: makeEndpoint(mockEndpoints.sandboxes),
              vms: makeEndpoint(mockEndpoints.vms),
              hosts: makeEndpoint(mockEndpoints.hosts),
              access: {
                resolve: () => ({
                  get: vi.fn().mockRejectedValue(new Error("not found")),
                }),
              },
            },
          },
        },
      },
    });
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────

function emptyResponse() {
  return { data: { data: [] } };
}

function listResponse(items: any[]) {
  return { data: { data: items } };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("EntityFinder", () => {
  beforeEach(() => {
    mockEndpoints = {
      sandboxes: { get: vi.fn().mockResolvedValue(emptyResponse()) },
      vms: { get: vi.fn().mockResolvedValue(emptyResponse()) },
      hosts: { get: vi.fn().mockResolvedValue(emptyResponse()) },
    };
  });

  describe("resolve() — transport type assignment", () => {
    it("resolves a VM as SSH transport", async () => {
      mockEndpoints.vms.get.mockResolvedValue(
        listResponse([
          {
            vmId: "vm_123",
            name: "lepton-59",
            slug: "lepton-59",
            status: "running",
            ipAddress: "192.168.1.59",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-59");

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe("vm");
      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshHost).toBe("192.168.1.59");
      expect(entity!.podName).toBeUndefined();
    });

    it("resolves a host as SSH transport", async () => {
      mockEndpoints.hosts.get.mockResolvedValue(
        listResponse([
          {
            hostId: "host_456",
            name: "lepton-squirtle",
            slug: "lepton-squirtle",
            status: "active",
            ipAddress: "192.168.1.1",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-squirtle");

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe("host");
      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshHost).toBe("192.168.1.1");
    });

    it("resolves a container sandbox as kubectl transport", async () => {
      mockEndpoints.sandboxes.get.mockResolvedValue(
        listResponse([
          {
            sandboxId: "sbx_789",
            name: "Maria Network Access Dev",
            slug: "maria-network-access-dev",
            status: "running",
            runtimeType: "container",
            ownerType: "user",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("maria-network-access-dev");

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe("workspace");
      expect(entity!.transport).toBe("kubectl");
      expect(entity!.podName).toBeDefined();
    });

    it("resolves a VM-backed sandbox as SSH transport", async () => {
      mockEndpoints.sandboxes.get.mockResolvedValue(
        listResponse([
          {
            sandboxId: "sbx_vm1",
            name: "VM Sandbox",
            slug: "vm-sandbox",
            status: "running",
            runtimeType: "vm",
            ownerType: "user",
            ipAddress: "10.0.0.5",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("vm-sandbox");

      expect(entity).not.toBeNull();
      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshHost).toBe("10.0.0.5");
      expect(entity!.podName).toBeUndefined();
    });
  });

  describe("resolve() — priority order", () => {
    it("sandbox match takes priority over VM with same slug", async () => {
      mockEndpoints.sandboxes.get.mockResolvedValue(
        listResponse([
          {
            sandboxId: "sbx_1",
            name: "dev-box",
            slug: "dev-box",
            runtimeType: "vm",
            ownerType: "user",
            status: "running",
            ipAddress: "10.0.0.1",
          },
        ])
      );
      mockEndpoints.vms.get.mockResolvedValue(
        listResponse([
          {
            vmId: "vm_1",
            name: "dev-box",
            slug: "dev-box",
            status: "running",
            ipAddress: "10.0.0.2",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("dev-box");

      // Sandbox wins because it's checked first
      expect(entity!.id).toBe("sbx_1");
    });

    it("falls through to VMs when no sandbox matches", async () => {
      // sandboxes returns empty
      mockEndpoints.vms.get.mockResolvedValue(
        listResponse([
          {
            vmId: "vm_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            status: "running",
            ipAddress: "192.168.1.59",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-59");

      expect(entity!.type).toBe("vm");
      expect(entity!.transport).toBe("ssh");
    });

    it("falls through to hosts when no sandbox or VM matches", async () => {
      // sandboxes and vms return empty
      mockEndpoints.hosts.get.mockResolvedValue(
        listResponse([
          {
            hostId: "host_59",
            name: "lepton-59",
            slug: "lepton-59",
            status: "active",
            ipAddress: "192.168.1.59",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-59");

      expect(entity!.type).toBe("host");
      expect(entity!.transport).toBe("ssh");
    });

    it("returns null when nothing matches", async () => {
      const finder = new EntityFinder();
      const entity = await finder.resolve("nonexistent");

      expect(entity).toBeNull();
    });
  });

  describe("resolve() — slug filtering is passed to API", () => {
    it("passes slug query param to sandbox endpoint", async () => {
      const finder = new EntityFinder();
      await finder.resolve("lepton-59");

      expect(mockEndpoints.sandboxes.get).toHaveBeenCalledWith({
        query: { slug: "lepton-59" },
      });
    });

    it("passes slug query param to VM endpoint", async () => {
      const finder = new EntityFinder();
      await finder.resolve("lepton-59");

      expect(mockEndpoints.vms.get).toHaveBeenCalledWith({
        query: { slug: "lepton-59" },
      });
    });

    it("passes slug query param to host endpoint", async () => {
      const finder = new EntityFinder();
      await finder.resolve("lepton-59");

      expect(mockEndpoints.hosts.get).toHaveBeenCalledWith({
        query: { slug: "lepton-59" },
      });
    });
  });

  describe("resolve() — the lepton-59 bug scenario", () => {
    it("does NOT resolve lepton-59 as a sandbox when slug filter works correctly", async () => {
      // Scenario: sandbox endpoint correctly filters by slug and returns empty
      // (no sandbox named lepton-59 exists), but there IS a VM/host named lepton-59
      mockEndpoints.sandboxes.get.mockResolvedValue(emptyResponse());
      mockEndpoints.vms.get.mockResolvedValue(emptyResponse());
      mockEndpoints.hosts.get.mockResolvedValue(
        listResponse([
          {
            hostId: "host_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            status: "active",
            ipAddress: "192.168.1.59",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-59");

      expect(entity!.type).toBe("host");
      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshHost).toBe("192.168.1.59");
      // Should NOT be kubectl
      expect(entity!.transport).not.toBe("kubectl");
    });

    it("correctly falls through when sandbox endpoint returns unrelated results (slug filter ignored)", async () => {
      // Scenario: sandbox endpoint ignores slug filter and returns ALL sandboxes.
      // This was the bug — lepton-59 resolved to "Maria Network Access Dev" via kubectl.
      // The fix: EntityFinder now verifies the slug matches client-side before accepting.
      mockEndpoints.sandboxes.get.mockResolvedValue(
        listResponse([
          {
            sandboxId: "sbx_maria",
            name: "Maria Network Access Dev",
            slug: "maria-network-access-dev",
            runtimeType: "container",
            ownerType: "user",
            status: "running",
          },
        ])
      );
      mockEndpoints.hosts.get.mockResolvedValue(
        listResponse([
          {
            hostId: "host_lepton59",
            name: "lepton-59",
            slug: "lepton-59",
            status: "active",
            ipAddress: "192.168.1.59",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("lepton-59");

      // Should correctly resolve as host with SSH — not the unrelated sandbox
      expect(entity!.type).toBe("host");
      expect(entity!.slug).toBe("lepton-59");
      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshHost).toBe("192.168.1.59");
    });
  });

  describe("default transport values", () => {
    it("sandbox without runtimeType defaults to container/kubectl", async () => {
      mockEndpoints.sandboxes.get.mockResolvedValue(
        listResponse([
          {
            sandboxId: "sbx_no_rt",
            name: "no-runtime",
            slug: "no-runtime",
            status: "running",
            ownerType: "user",
            // runtimeType omitted — should default to 'container'
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("no-runtime");

      expect(entity!.runtimeType).toBe("container");
      expect(entity!.transport).toBe("kubectl");
    });

    it("VM always gets SSH transport regardless of fields", async () => {
      mockEndpoints.vms.get.mockResolvedValue(
        listResponse([
          {
            vmId: "vm_win",
            name: "windows-vm",
            slug: "windows-vm",
            status: "running",
            ipAddress: "192.168.2.90",
            accessUser: "Administrator",
          },
        ])
      );

      const finder = new EntityFinder();
      const entity = await finder.resolve("windows-vm");

      expect(entity!.transport).toBe("ssh");
      expect(entity!.sshUser).toBe("Administrator");
    });
  });
});
