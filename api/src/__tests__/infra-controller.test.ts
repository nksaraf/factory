import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

const BASE = "http://localhost/api/v1/factory/infra";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Infra Controller", () => {
  let app: TestApp;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    app = ctx.app;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  // ==========================================================================
  // Providers
  // ==========================================================================
  describe("providers", () => {
    it("POST creates and GET lists providers", async () => {
      const create = await app.handle(
        post(`${BASE}/providers`, { name: "test-prov", providerType: "proxmox" })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as any;
      expect(created.providerId).toBeTruthy();
      expect(created.slug).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/providers`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("GET /providers/:id returns provider detail", async () => {
      const create = await app.handle(
        post(`${BASE}/providers`, { name: "prov", providerType: "aws" })
      );
      const { data: created } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/providers/${created.providerId}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.name).toBe("prov");
      expect(data.providerType).toBe("aws");
    });

    it("GET /providers/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/providers/prv_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("filters providers by status", async () => {
      await app.handle(
        post(`${BASE}/providers`, { name: "active-prov", providerType: "proxmox" })
      );

      const active = await app.handle(
        new Request(`${BASE}/providers?status=active`)
      );
      const { data: activeData } = (await active.json()) as any;
      expect(activeData).toHaveLength(1);

      const inactive = await app.handle(
        new Request(`${BASE}/providers?status=inactive`)
      );
      const { data: inactiveData } = (await inactive.json()) as any;
      expect(inactiveData).toHaveLength(0);
    });

    it("POST /providers/:id/sync returns sync result", async () => {
      const create = await app.handle(
        post(`${BASE}/providers`, { name: "sync-prov", providerType: "proxmox" })
      );
      const { data: created } = (await create.json()) as any;

      const sync = await app.handle(
        new Request(`${BASE}/providers/${created.providerId}/sync`, {
          method: "POST",
        })
      );
      expect(sync.status).toBe(200);
      const { data } = (await sync.json()) as any;
      expect(data).toHaveProperty("hostsDiscovered");
    });
  });

  // ==========================================================================
  // Regions
  // ==========================================================================
  describe("regions", () => {
    it("POST creates and GET lists regions", async () => {
      const create = await app.handle(
        post(`${BASE}/regions`, {
          name: "US East",
          displayName: "US East",
          slug: "us-east",
        })
      );
      expect(create.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/regions`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].slug).toBe("us-east");
    });

    it("GET /regions/:id returns region detail", async () => {
      const create = await app.handle(
        post(`${BASE}/regions`, {
          name: "EU Central",
          displayName: "EU Central",
          slug: "eu-central",
          country: "DE",
          city: "Frankfurt",
        })
      );
      const { data: created } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/regions/${created.regionId}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.country).toBe("DE");
    });

    it("GET /regions/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/regions/rgn_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /regions/:id/delete removes region", async () => {
      const create = await app.handle(
        post(`${BASE}/regions`, {
          name: "To Delete",
          displayName: "To Delete",
          slug: "to-delete",
        })
      );
      const { data: created } = (await create.json()) as any;

      const del = await app.handle(
        new Request(`${BASE}/regions/${created.regionId}/delete`, {
          method: "POST",
        })
      );
      expect(del.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/regions`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(0);
    });

    it("filters regions by providerId", async () => {
      const provRes = await app.handle(
        post(`${BASE}/providers`, { name: "prov", providerType: "aws" })
      );
      const prov = ((await provRes.json()) as any).data;

      await app.handle(
        post(`${BASE}/regions`, {
          name: "Region A",
          displayName: "Region A",
          slug: "region-a",
          providerId: prov.providerId,
        })
      );
      await app.handle(
        post(`${BASE}/regions`, {
          name: "Region B",
          displayName: "Region B",
          slug: "region-b",
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/regions?providerId=${prov.providerId}`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Region A");
    });
  });

  // ==========================================================================
  // Clusters
  // ==========================================================================
  describe("clusters", () => {
    async function createProvider(name = "prov") {
      const res = await app.handle(
        post(`${BASE}/providers`, { name, providerType: "proxmox" })
      );
      return ((await res.json()) as any).data;
    }

    it("POST creates cluster with provisioning status", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/clusters`, {
          name: "k-cluster",
          providerId: prov.providerId,
        })
      );
      expect(create.status).toBe(200);
      const { data } = (await create.json()) as any;
      expect(data.status).toBe("provisioning");
    });

    it("GET /clusters/:id returns cluster detail", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/clusters`, {
          name: "my-cls",
          providerId: prov.providerId,
        })
      );
      const { data: created } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/clusters/${created.clusterId}`)
      );
      expect(res.status).toBe(200);
    });

    it("GET /clusters/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/clusters/cls_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /clusters/:id/delete sets status to destroying", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/clusters`, {
          name: "doomed-cls",
          providerId: prov.providerId,
        })
      );
      const { data: created } = (await create.json()) as any;

      const del = await app.handle(
        new Request(`${BASE}/clusters/${created.clusterId}/delete`, {
          method: "POST",
        })
      );
      expect(del.status).toBe(200);
      const { data } = (await del.json()) as any;
      expect(data.status).toBe("destroying");
    });

    it("filters clusters by providerId and status", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/clusters`, {
          name: "cls-1",
          providerId: prov.providerId,
        })
      );

      const byProvider = await app.handle(
        new Request(`${BASE}/clusters?providerId=${prov.providerId}`)
      );
      const { data } = (await byProvider.json()) as any;
      expect(data).toHaveLength(1);

      const byStatus = await app.handle(
        new Request(`${BASE}/clusters?status=ready`)
      );
      const { data: readyData } = (await byStatus.json()) as any;
      expect(readyData).toHaveLength(0);
    });
  });

  // ==========================================================================
  // VMs
  // ==========================================================================
  describe("vms", () => {
    async function createProvider() {
      const res = await app.handle(
        post(`${BASE}/providers`, { name: "prov", providerType: "proxmox" })
      );
      return ((await res.json()) as any).data;
    }

    it("POST creates VM with provisioning status", async () => {
      const prov = await createProvider();
      const res = await app.handle(
        post(`${BASE}/vms`, {
          name: "test-vm",
          providerId: prov.providerId,
          cpu: 4,
          memoryMb: 8192,
          diskGb: 100,
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.vmId).toBeTruthy();
      expect(data.status).toBe("provisioning");
      expect(data.cpu).toBe(4);
    });

    it("GET /vms/:id returns VM detail", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/vms`, {
          name: "detail-vm",
          providerId: prov.providerId,
          cpu: 2,
          memoryMb: 4096,
          diskGb: 50,
        })
      );
      const { data: created } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/vms/${created.vmId}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.name).toBe("detail-vm");
    });

    it("GET /vms/:id returns 404 for missing", async () => {
      const res = await app.handle(new Request(`${BASE}/vms/vm_nonexistent`));
      expect(res.status).toBe(404);
    });

    it("VM lifecycle: start → stop → restart → destroy", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/vms`, {
          name: "lifecycle-vm",
          providerId: prov.providerId,
          cpu: 1,
          memoryMb: 1024,
          diskGb: 20,
        })
      );
      const { data: vm } = (await create.json()) as any;
      expect(vm.status).toBe("provisioning");

      // Start
      const start = await app.handle(
        new Request(`${BASE}/vms/${vm.vmId}/start`, { method: "POST" })
      );
      const { data: started } = (await start.json()) as any;
      expect(started.status).toBe("running");

      // Stop
      const stop = await app.handle(
        new Request(`${BASE}/vms/${vm.vmId}/stop`, { method: "POST" })
      );
      const { data: stopped } = (await stop.json()) as any;
      expect(stopped.status).toBe("stopped");

      // Restart
      const restart = await app.handle(
        new Request(`${BASE}/vms/${vm.vmId}/restart`, { method: "POST" })
      );
      const { data: restarted } = (await restart.json()) as any;
      expect(restarted.status).toBe("running");

      // Destroy
      const destroy = await app.handle(
        new Request(`${BASE}/vms/${vm.vmId}/delete`, { method: "POST" })
      );
      const { data: destroyed } = (await destroy.json()) as any;
      expect(destroyed.status).toBe("destroying");
    });

    it("POST /vms/:id/snapshot returns snapshot result", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/vms`, {
          name: "snap-vm",
          providerId: prov.providerId,
          cpu: 1,
          memoryMb: 1024,
          diskGb: 20,
        })
      );
      const { data: vm } = (await create.json()) as any;

      const snap = await app.handle(
        new Request(`${BASE}/vms/${vm.vmId}/snapshot`, { method: "POST" })
      );
      expect(snap.status).toBe(200);
      const { data } = (await snap.json()) as any;
      expect(data).toHaveProperty("snapshotId");
    });

    it("filters VMs by providerId", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/vms`, {
          name: "vm-1",
          providerId: prov.providerId,
          cpu: 1,
          memoryMb: 1024,
          diskGb: 20,
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/vms?providerId=${prov.providerId}`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("filters VMs by slug", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/vms`, {
          name: "lepton-59",
          providerId: prov.providerId,
          cpu: 52,
          memoryMb: 262144,
          diskGb: 9216,
        })
      );
      await app.handle(
        post(`${BASE}/vms`, {
          name: "factory-prod",
          providerId: prov.providerId,
          cpu: 2,
          memoryMb: 4096,
          diskGb: 50,
        })
      );

      // Filter by slug should return only the matching VM
      const filtered = await app.handle(
        new Request(`${BASE}/vms?slug=lepton-59`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].slug).toBe("lepton-59");
    });

    it("filters VMs by slug returns empty for non-existent slug", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/vms`, {
          name: "some-vm",
          providerId: prov.providerId,
          cpu: 1,
          memoryMb: 1024,
          diskGb: 20,
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/vms?slug=nonexistent-slug`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(0);
    });

    it("creates VM with host and datacenter FKs", async () => {
      const prov = await createProvider();

      // Create region → datacenter → host
      const regionRes = await app.handle(
        post(`${BASE}/regions`, {
          name: "test-region",
          displayName: "Test Region",
          slug: "test-region",
        })
      );
      const region = ((await regionRes.json()) as any).data;

      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "host-for-vm",
          providerId: prov.providerId,
          cpuCores: 32,
          memoryMb: 131072,
          diskGb: 2000,
        })
      );
      const host = ((await hostRes.json()) as any).data;

      const vmRes = await app.handle(
        post(`${BASE}/vms`, {
          name: "vm-on-host",
          providerId: prov.providerId,
          cpu: 2,
          memoryMb: 4096,
          diskGb: 50,
          hostId: host.hostId,
        })
      );
      expect(vmRes.status).toBe(200);
      const { data: vm } = (await vmRes.json()) as any;
      expect(vm.hostId).toBe(host.hostId);
    });
  });

  // ==========================================================================
  // Hosts
  // ==========================================================================
  describe("hosts", () => {
    async function createProvider() {
      const res = await app.handle(
        post(`${BASE}/providers`, { name: "prov", providerType: "proxmox" })
      );
      return ((await res.json()) as any).data;
    }

    it("POST creates and GET lists hosts", async () => {
      const prov = await createProvider();
      const create = await app.handle(
        post(`${BASE}/hosts`, {
          name: "host-01",
          providerId: prov.providerId,
          cpuCores: 32,
          memoryMb: 131072,
          diskGb: 2000,
        })
      );
      expect(create.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/hosts`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].cpuCores).toBe(32);
    });

    it("GET /hosts/:id returns host detail with VM count", async () => {
      const prov = await createProvider();
      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "host-02",
          providerId: prov.providerId,
          cpuCores: 16,
          memoryMb: 65536,
          diskGb: 1000,
          rackLocation: "Rack A, U12",
        })
      );
      const host = ((await hostRes.json()) as any).data;

      // Create a VM on this host
      await app.handle(
        post(`${BASE}/vms`, {
          name: "vm-on-host",
          providerId: prov.providerId,
          cpu: 2,
          memoryMb: 4096,
          diskGb: 50,
          hostId: host.hostId,
        })
      );

      const detail = await app.handle(
        new Request(`${BASE}/hosts/${host.hostId}`)
      );
      expect(detail.status).toBe(200);
      const { data } = (await detail.json()) as any;
      expect(data.vmCount).toBe(1);
      expect(data.rackLocation).toBe("Rack A, U12");
    });

    it("GET /hosts/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/hosts/host_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /hosts/:id/delete removes host", async () => {
      const prov = await createProvider();
      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "remove-host",
          providerId: prov.providerId,
          cpuCores: 8,
          memoryMb: 32768,
          diskGb: 500,
        })
      );
      const host = ((await hostRes.json()) as any).data;

      const del = await app.handle(
        new Request(`${BASE}/hosts/${host.hostId}/delete`, { method: "POST" })
      );
      expect(del.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/hosts`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(0);
    });

    it("filters hosts by providerId", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/hosts`, {
          name: "filtered-host",
          providerId: prov.providerId,
          cpuCores: 8,
          memoryMb: 32768,
          diskGb: 500,
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/hosts?providerId=${prov.providerId}`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("filters hosts by slug", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/hosts`, {
          name: "lepton-squirtle",
          providerId: prov.providerId,
          cpuCores: 40,
          memoryMb: 257568,
          diskGb: 94,
        })
      );
      await app.handle(
        post(`${BASE}/hosts`, {
          name: "lepton-pikachu",
          providerId: prov.providerId,
          cpuCores: 52,
          memoryMb: 257592,
          diskGb: 94,
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/hosts?slug=lepton-squirtle`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].slug).toBe("lepton-squirtle");
    });

    it("filters hosts by slug returns empty for non-existent slug", async () => {
      const prov = await createProvider();
      await app.handle(
        post(`${BASE}/hosts`, {
          name: "some-host",
          providerId: prov.providerId,
          cpuCores: 8,
          memoryMb: 32768,
          diskGb: 500,
        })
      );

      const filtered = await app.handle(
        new Request(`${BASE}/hosts?slug=nonexistent-host`)
      );
      const { data } = (await filtered.json()) as any;
      expect(data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Kube Nodes
  // ==========================================================================
  describe("kube-nodes", () => {
    async function createCluster() {
      const provRes = await app.handle(
        post(`${BASE}/providers`, { name: "prov", providerType: "proxmox" })
      );
      const prov = ((await provRes.json()) as any).data;

      const clsRes = await app.handle(
        post(`${BASE}/clusters`, {
          name: "test-cls",
          providerId: prov.providerId,
        })
      );
      return ((await clsRes.json()) as any).data;
    }

    it("POST creates and GET lists kube nodes", async () => {
      const cls = await createCluster();
      const create = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "node-1",
          clusterId: cls.clusterId,
          role: "server",
          ipAddress: "10.0.0.1",
        })
      );
      expect(create.status).toBe(200);
      const { data: node } = (await create.json()) as any;
      expect(node.status).toBe("ready");
      expect(node.role).toBe("server");

      const list = await app.handle(
        new Request(`${BASE}/kube-nodes?clusterId=${cls.clusterId}`)
      );
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("GET /kube-nodes/:id returns node detail", async () => {
      const cls = await createCluster();
      const create = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "detail-node",
          clusterId: cls.clusterId,
          role: "agent",
          ipAddress: "10.0.0.5",
        })
      );
      const { data: node } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/kube-nodes/${node.kubeNodeId}`)
      );
      expect(res.status).toBe(200);
    });

    it("GET /kube-nodes/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/kube-nodes/kn_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("pause → resume kube node", async () => {
      const cls = await createCluster();
      const addRes = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "node-1",
          clusterId: cls.clusterId,
          role: "agent",
          ipAddress: "10.0.0.5",
        })
      );
      const { data: node } = (await addRes.json()) as any;

      // Pause
      const pauseRes = await app.handle(
        new Request(`${BASE}/kube-nodes/${node.kubeNodeId}/pause`, {
          method: "POST",
        })
      );
      expect(pauseRes.status).toBe(200);
      const { data: paused } = (await pauseRes.json()) as any;
      expect(paused.status).toBe("paused");

      // Resume
      const resumeRes = await app.handle(
        new Request(`${BASE}/kube-nodes/${node.kubeNodeId}/resume`, {
          method: "POST",
        })
      );
      const { data: resumed } = (await resumeRes.json()) as any;
      expect(resumed.status).toBe("ready");
    });

    it("evacuate sets status to evacuating", async () => {
      const cls = await createCluster();
      const addRes = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "evac-node",
          clusterId: cls.clusterId,
          role: "agent",
          ipAddress: "10.0.0.6",
        })
      );
      const { data: node } = (await addRes.json()) as any;

      const evacRes = await app.handle(
        new Request(`${BASE}/kube-nodes/${node.kubeNodeId}/evacuate`, {
          method: "POST",
        })
      );
      expect(evacRes.status).toBe(200);
      const { data } = (await evacRes.json()) as any;
      expect(data.status).toBe("evacuating");
    });

    it("POST /kube-nodes/:id/delete removes node", async () => {
      const cls = await createCluster();
      const addRes = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "rm-node",
          clusterId: cls.clusterId,
          role: "agent",
          ipAddress: "10.0.0.7",
        })
      );
      const { data: node } = (await addRes.json()) as any;

      const del = await app.handle(
        new Request(`${BASE}/kube-nodes/${node.kubeNodeId}/delete`, {
          method: "POST",
        })
      );
      expect(del.status).toBe(200);

      const list = await app.handle(
        new Request(`${BASE}/kube-nodes?clusterId=${cls.clusterId}`)
      );
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Subnets
  // ==========================================================================
  describe("subnets", () => {
    it("POST creates and GET lists subnets", async () => {
      const create = await app.handle(
        post(`${BASE}/subnets`, {
          cidr: "10.0.1.0/24",
          gateway: "10.0.1.1",
          subnetType: "vm",
          description: "VM subnet",
        })
      );
      expect(create.status).toBe(200);
      const { data: sub } = (await create.json()) as any;
      expect(sub.cidr).toBe("10.0.1.0/24");

      const list = await app.handle(new Request(`${BASE}/subnets`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("GET /subnets/:id returns subnet detail", async () => {
      const create = await app.handle(
        post(`${BASE}/subnets`, {
          cidr: "10.0.2.0/24",
          subnetType: "management",
          vlanId: 100,
        })
      );
      const { data: sub } = (await create.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/subnets/${sub.subnetId}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.vlanId).toBe(100);
    });

    it("GET /subnets/:id returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/subnets/sub_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /subnets/:id/delete removes subnet", async () => {
      const create = await app.handle(
        post(`${BASE}/subnets`, { cidr: "10.0.3.0/24" })
      );
      const { data: sub } = (await create.json()) as any;

      const del = await app.handle(
        new Request(`${BASE}/subnets/${sub.subnetId}/delete`, { method: "POST" })
      );
      expect(del.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/subnets`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // IPAM (IPs)
  // ==========================================================================
  describe("ipam", () => {
    it("full IP lifecycle: register → assign → release", async () => {
      // Register
      const reg = await app.handle(
        post(`${BASE}/ips/register`, { address: "10.0.1.50" })
      );
      expect(reg.status).toBe(200);
      const { data: ip } = (await reg.json()) as any;
      expect(ip.status).toBe("available");

      // List available
      const avail = await app.handle(new Request(`${BASE}/ips/available`));
      const { data: availIps } = (await avail.json()) as any;
      expect(availIps).toHaveLength(1);

      // Assign
      const assign = await app.handle(
        post(`${BASE}/ips/${ip.ipAddressId}/assign`, {
          assignedToType: "vm",
          assignedToId: "vm_test123",
        })
      );
      expect(assign.status).toBe(200);
      const { data: assigned } = (await assign.json()) as any;
      expect(assigned.status).toBe("assigned");
      expect(assigned.assignedToType).toBe("vm");
      expect(assigned.assignedToId).toBe("vm_test123");

      // Available should be empty now
      const avail2 = await app.handle(new Request(`${BASE}/ips/available`));
      const { data: availIps2 } = (await avail2.json()) as any;
      expect(availIps2).toHaveLength(0);

      // Release
      const release = await app.handle(
        new Request(`${BASE}/ips/${ip.ipAddressId}/release`, {
          method: "POST",
        })
      );
      expect(release.status).toBe(200);
      const { data: released } = (await release.json()) as any;
      expect(released.status).toBe("available");
      expect(released.assignedToType).toBeNull();
    });

    it("lookup finds IP by address", async () => {
      await app.handle(
        post(`${BASE}/ips/register`, { address: "10.0.2.100" })
      );

      const lookup = await app.handle(
        post(`${BASE}/ips/lookup`, { address: "10.0.2.100" })
      );
      expect(lookup.status).toBe(200);
      const { data } = (await lookup.json()) as any;
      expect(data.address).toBe("10.0.2.100");
    });

    it("lookup returns 404 for unknown address", async () => {
      const lookup = await app.handle(
        post(`${BASE}/ips/lookup`, { address: "99.99.99.99" })
      );
      expect(lookup.status).toBe(404);
    });

    it("GET /ips lists all IPs", async () => {
      await app.handle(post(`${BASE}/ips/register`, { address: "10.0.3.1" }));
      await app.handle(post(`${BASE}/ips/register`, { address: "10.0.3.2" }));

      const list = await app.handle(new Request(`${BASE}/ips`));
      const { data } = (await list.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /ips/stats returns IPAM statistics", async () => {
      await app.handle(post(`${BASE}/ips/register`, { address: "10.0.4.1" }));
      await app.handle(post(`${BASE}/ips/register`, { address: "10.0.4.2" }));
      const reg = await app.handle(
        post(`${BASE}/ips/register`, { address: "10.0.4.3" })
      );
      const { data: ip } = (await reg.json()) as any;
      await app.handle(
        post(`${BASE}/ips/${ip.ipAddressId}/assign`, {
          assignedToType: "host",
          assignedToId: "host_abc",
        })
      );

      const stats = await app.handle(new Request(`${BASE}/ips/stats`));
      expect(stats.status).toBe(200);
      const { data } = (await stats.json()) as any;
      expect(data.total).toBe(3);
      expect(data.available).toBe(2);
      expect(data.assigned).toBe(1);
    });

    it("registers IP with subnet", async () => {
      const subRes = await app.handle(
        post(`${BASE}/subnets`, {
          cidr: "10.0.5.0/24",
          subnetType: "vm",
        })
      );
      const sub = ((await subRes.json()) as any).data;

      const reg = await app.handle(
        post(`${BASE}/ips/register`, {
          address: "10.0.5.10",
          subnetId: sub.subnetId,
        })
      );
      const { data: ip } = (await reg.json()) as any;
      expect(ip.subnetId).toBe(sub.subnetId);

      // Filter available by subnet
      const avail = await app.handle(
        new Request(`${BASE}/ips/available?subnetId=${sub.subnetId}`)
      );
      const { data } = (await avail.json()) as any;
      expect(data).toHaveLength(1);
    });

    it("assigns IP with hostname and purpose", async () => {
      const reg = await app.handle(
        post(`${BASE}/ips/register`, { address: "10.0.6.1" })
      );
      const { data: ip } = (await reg.json()) as any;

      const assign = await app.handle(
        post(`${BASE}/ips/${ip.ipAddressId}/assign`, {
          assignedToType: "host",
          assignedToId: "host_xyz",
          hostname: "server01",
          purpose: "management",
        })
      );
      const { data } = (await assign.json()) as any;
      expect(data.hostname).toBe("server01");
      expect(data.purpose).toBe("management");
    });
  });

  // ==========================================================================
  // Assets
  // ==========================================================================
  describe("assets", () => {
    it("GET /assets returns unified list of all infra resources", async () => {
      // Create a provider and a cluster
      const provRes = await app.handle(
        post(`${BASE}/providers`, { name: "asset-prov", providerType: "aws" })
      );
      const prov = ((await provRes.json()) as any).data;

      await app.handle(
        post(`${BASE}/clusters`, {
          name: "asset-cls",
          providerId: prov.providerId,
        })
      );

      const assets = await app.handle(new Request(`${BASE}/assets`));
      expect(assets.status).toBe(200);
      const { data } = (await assets.json()) as any;
      expect(data.length).toBeGreaterThanOrEqual(2);
    });

    it("GET /assets/:id returns asset by ID", async () => {
      const provRes = await app.handle(
        post(`${BASE}/providers`, { name: "asset-prov", providerType: "gcp" })
      );
      const prov = ((await provRes.json()) as any).data;

      const asset = await app.handle(
        new Request(`${BASE}/assets/${prov.providerId}`)
      );
      expect(asset.status).toBe(200);
      const { data } = (await asset.json()) as any;
      expect(data.name).toBe("asset-prov");
    });

    it("GET /assets/:id returns 404 for unknown", async () => {
      const res = await app.handle(
        new Request(`${BASE}/assets/prv_nonexistent`)
      );
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Full hierarchy: Provider → Region → Datacenter → Host → VM → Kube Node
  // ==========================================================================
  describe("full hierarchy", () => {
    it("creates complete infrastructure hierarchy", async () => {
      // Provider
      const provRes = await app.handle(
        post(`${BASE}/providers`, { name: "dc-provider", providerType: "proxmox" })
      );
      const prov = ((await provRes.json()) as any).data;

      // Region
      const regionRes = await app.handle(
        post(`${BASE}/regions`, {
          name: "India West",
          displayName: "India West",
          slug: "india-west",
          country: "IN",
          city: "Mumbai",
          providerId: prov.providerId,
        })
      );
      const region = ((await regionRes.json()) as any).data;
      expect(region.regionId).toBeTruthy();

      // Cluster
      const clsRes = await app.handle(
        post(`${BASE}/clusters`, {
          name: "prod-cluster",
          providerId: prov.providerId,
        })
      );
      const cls = ((await clsRes.json()) as any).data;

      // Host
      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "hypervisor-01",
          providerId: prov.providerId,
          cpuCores: 64,
          memoryMb: 262144,
          diskGb: 4000,
          ipAddress: "192.168.1.10",
        })
      );
      const host = ((await hostRes.json()) as any).data;

      // VM on host
      const vmRes = await app.handle(
        post(`${BASE}/vms`, {
          name: "k8s-node-vm",
          providerId: prov.providerId,
          cpu: 8,
          memoryMb: 16384,
          diskGb: 200,
          hostId: host.hostId,
        })
      );
      const vm = ((await vmRes.json()) as any).data;

      // Kube node backed by VM
      const nodeRes = await app.handle(
        post(`${BASE}/kube-nodes`, {
          name: "node-01",
          clusterId: cls.clusterId,
          vmId: vm.vmId,
          role: "agent",
          ipAddress: "10.0.0.100",
        })
      );
      const node = ((await nodeRes.json()) as any).data;
      expect(node.vmId).toBe(vm.vmId);

      // Subnet + IP for IPAM
      const subRes = await app.handle(
        post(`${BASE}/subnets`, {
          cidr: "10.0.0.0/24",
          gateway: "10.0.0.1",
          subnetType: "vm",
        })
      );
      const sub = ((await subRes.json()) as any).data;

      const ipRes = await app.handle(
        post(`${BASE}/ips/register`, {
          address: "10.0.0.100",
          subnetId: sub.subnetId,
        })
      );
      const ip = ((await ipRes.json()) as any).data;

      await app.handle(
        post(`${BASE}/ips/${ip.ipAddressId}/assign`, {
          assignedToType: "kube_node",
          assignedToId: node.kubeNodeId,
          hostname: "node-01",
        })
      );

      // Verify everything is connected via asset list
      const assets = await app.handle(new Request(`${BASE}/assets`));
      const { data: allAssets } = (await assets.json()) as any;
      expect(allAssets.length).toBeGreaterThanOrEqual(4);

      // Stats show the assigned IP
      const stats = await app.handle(new Request(`${BASE}/ips/stats`));
      const { data: ipStats } = (await stats.json()) as any;
      expect(ipStats.total).toBe(1);
      expect(ipStats.assigned).toBe(1);
      expect(ipStats.available).toBe(0);
    });
  });
});
