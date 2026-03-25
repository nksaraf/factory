import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";

import * as providerSvc from "../services/infra/provider.service";
import * as regionSvc from "../services/infra/region.service";
import * as clusterSvc from "../services/infra/cluster.service";
import * as vmSvc from "../services/infra/vm.service";
import * as hostSvc from "../services/infra/host.service";
import * as kubeNodeSvc from "../services/infra/kube-node.service";
import * as ipamSvc from "../services/infra/ipam.service";

import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Infra Services", () => {
  let db: Database;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  // --- Provider ---
  describe("provider", () => {
    it("creates and lists providers", async () => {
      const created = await providerSvc.createProvider(db, {
        name: "test-proxmox",
        providerType: "proxmox",
      });
      expect(created.providerId).toBeTruthy();
      expect(created.name).toBe("test-proxmox");

      const all = await providerSvc.listProviders(db);
      expect(all).toHaveLength(1);
    });

    it("gets provider by id", async () => {
      const created = await providerSvc.createProvider(db, {
        name: "prov1",
        providerType: "aws",
      });
      const fetched = await providerSvc.getProvider(db, created!.providerId);
      expect(fetched?.name).toBe("prov1");
    });

    it("filters by status", async () => {
      await providerSvc.createProvider(db, {
        name: "active-prov",
        providerType: "proxmox",
      });
      const all = await providerSvc.listProviders(db, { status: "active" });
      expect(all).toHaveLength(1);
      const none = await providerSvc.listProviders(db, { status: "inactive" });
      expect(none).toHaveLength(0);
    });

    it("updates provider", async () => {
      const created = await providerSvc.createProvider(db, {
        name: "old-name",
        providerType: "hetzner",
      });
      const updated = await providerSvc.updateProvider(db, created!.providerId, {
        name: "new-name",
      });
      expect(updated?.name).toBe("new-name");
    });
  });

  // --- Region ---
  describe("region", () => {
    it("creates and lists regions", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const created = await regionSvc.createRegion(db, {
        name: "US East",
        displayName: "US East",
        slug: "us-east",
        country: "US",
        providerId: prov!.providerId,
      });
      expect(created.regionId).toBeTruthy();

      const all = await regionSvc.listRegions(db);
      expect(all).toHaveLength(1);

      const filtered = await regionSvc.listRegions(db, {
        providerId: prov!.providerId,
      });
      expect(filtered).toHaveLength(1);
    });

    it("derives slug when omitted", async () => {
      const created = await regionSvc.createRegion(db, {
        name: "eu-west",
        displayName: "EU West",
      });
      expect(created?.slug).toBe("eu-west");
    });

    it("deletes region", async () => {
      const created = await regionSvc.createRegion(db, {
        name: "To Delete",
        displayName: "To Delete",
        slug: "to-delete",
      });
      const deleted = await regionSvc.deleteRegion(db, created.regionId);
      expect(deleted?.regionId).toBe(created.regionId);
      const all = await regionSvc.listRegions(db);
      expect(all).toHaveLength(0);
    });
  });

  // --- Cluster ---
  describe("cluster", () => {
    it("creates with provisioning status", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const created = await clusterSvc.createCluster(db, {
        name: "test-cluster",
        providerId: prov!.providerId,
      });
      expect(created.status).toBe("provisioning");
    });

    it("updates status and destroys", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const created = await clusterSvc.createCluster(db, {
        name: "cls",
        providerId: prov!.providerId,
      });
      const ready = await clusterSvc.updateClusterStatus(
        db,
        created.clusterId,
        "ready"
      );
      expect(ready?.status).toBe("ready");

      const destroyed = await clusterSvc.destroyCluster(db, created.clusterId);
      expect(destroyed?.status).toBe("destroying");
    });
  });

  // --- VM ---
  describe("vm", () => {
    it("creates VM", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const created = await vmSvc.createVm(db, {
        name: "test-vm",
        providerId: prov!.providerId,
        cpu: 4,
        memoryMb: 8192,
        diskGb: 100,
      });
      expect(created.vmId).toBeTruthy();
      expect(created.status).toBe("provisioning");
    });

    it("creates Windows VM with accessMethod and accessUser", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const winVm = await vmSvc.createVm(db, {
        name: "win-vm-01",
        providerId: prov!.providerId,
        cpu: 4,
        memoryMb: 8192,
        diskGb: 100,
        osType: "windows",
        accessMethod: "winrm",
        accessUser: "Administrator",
      });
      expect(winVm.osType).toBe("windows");
      expect(winVm.accessMethod).toBe("winrm");
      expect(winVm.accessUser).toBe("Administrator");
    });

    it("lists VMs filtered by osType", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      await vmSvc.createVm(db, {
        name: "linux-vm",
        providerId: prov!.providerId,
        cpu: 2,
        memoryMb: 4096,
        diskGb: 50,
      });
      await vmSvc.createVm(db, {
        name: "win-vm",
        providerId: prov!.providerId,
        cpu: 2,
        memoryMb: 4096,
        diskGb: 50,
        osType: "windows",
      });
      const winVms = await vmSvc.listVms(db, { osType: "windows" });
      expect(winVms).toHaveLength(1);
      expect(winVms[0].name).toBe("win-vm");
    });

    it("lists VMs with filters", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      await vmSvc.createVm(db, {
        name: "vm1",
        providerId: prov!.providerId,
        cpu: 2,
        memoryMb: 4096,
        diskGb: 50,
      });
      const all = await vmSvc.listVms(db);
      expect(all).toHaveLength(1);

      const filtered = await vmSvc.listVms(db, {
        providerId: prov!.providerId,
      });
      expect(filtered).toHaveLength(1);
    });
  });

  // --- Host ---
  describe("host", () => {
    it("adds and lists hosts", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      await hostSvc.addHost(db, {
        name: "host-01",
        providerId: prov!.providerId,
        cpuCores: 32,
        memoryMb: 131072,
        diskGb: 2000,
      });
      const all = await hostSvc.listHosts(db);
      expect(all).toHaveLength(1);
    });

    it("creates host with osType and accessMethod", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const winHost = await hostSvc.addHost(db, {
        name: "win-srv-01",
        providerId: prov!.providerId,
        cpuCores: 16,
        memoryMb: 65536,
        diskGb: 1000,
        osType: "windows",
        accessMethod: "ssh",
      });
      expect(winHost.osType).toBe("windows");
      expect(winHost.accessMethod).toBe("ssh");
    });

    it("defaults host to linux + ssh", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const linuxHost = await hostSvc.addHost(db, {
        name: "linux-srv-01",
        providerId: prov!.providerId,
        cpuCores: 16,
        memoryMb: 65536,
        diskGb: 1000,
      });
      expect(linuxHost.osType).toBe("linux");
      expect(linuxHost.accessMethod).toBe("ssh");
    });

    it("filters hosts by osType", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      await hostSvc.addHost(db, {
        name: "linux-01",
        providerId: prov!.providerId,
        cpuCores: 8,
        memoryMb: 32768,
        diskGb: 500,
        osType: "linux",
      });
      await hostSvc.addHost(db, {
        name: "win-01",
        providerId: prov!.providerId,
        cpuCores: 8,
        memoryMb: 32768,
        diskGb: 500,
        osType: "windows",
      });
      const winHosts = await hostSvc.listHosts(db, { osType: "windows" });
      expect(winHosts).toHaveLength(1);
      expect(winHosts[0].name).toBe("win-01");
    });

    it("gets host with VM count", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const host = await hostSvc.addHost(db, {
        name: "host-02",
        providerId: prov!.providerId,
        cpuCores: 16,
        memoryMb: 65536,
        diskGb: 1000,
      });
      await vmSvc.createVm(db, {
        name: "vm-on-host",
        providerId: prov!.providerId,
        hostId: host.hostId,
        cpu: 2,
        memoryMb: 4096,
        diskGb: 50,
      });
      const detail = await hostSvc.getHost(db, host.hostId);
      expect(detail?.vmCount).toBe(1);
    });
  });

  // --- Kube Node ---
  describe("kubeNode", () => {
    it("adds and lists nodes", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const cls = await clusterSvc.createCluster(db, {
        name: "k-cluster",
        providerId: prov!.providerId,
      });
      await kubeNodeSvc.addNode(db, {
        name: "node-1",
        clusterId: cls.clusterId,
        role: "server",
        ipAddress: "10.0.0.1",
      });
      const nodes = await kubeNodeSvc.listNodes(db, {
        clusterId: cls.clusterId,
      });
      expect(nodes).toHaveLength(1);
    });

    it("allocates distinct slugs when names collide (global scope)", async () => {
      const a = await providerSvc.createProvider(db, {
        name: "proxmox",
        providerType: "proxmox",
      });
      const b = await providerSvc.createProvider(db, {
        name: "proxmox",
        providerType: "hetzner",
      });
      expect(a.slug).toBe("proxmox");
      expect(b.slug).toBe("proxmox-2");
    });

    it("pause, resume, evacuate status changes", async () => {
      const prov = await providerSvc.createProvider(db, {
        name: "prov",
        providerType: "proxmox",
      });
      const cls = await clusterSvc.createCluster(db, {
        name: "k-cls",
        providerId: prov!.providerId,
      });
      const node = await kubeNodeSvc.addNode(db, {
        name: "node-2",
        clusterId: cls.clusterId,
        role: "agent",
        ipAddress: "10.0.0.2",
      });

      const paused = await kubeNodeSvc.pauseNode(db, node.kubeNodeId);
      expect(paused?.status).toBe("paused");

      const resumed = await kubeNodeSvc.resumeNode(db, node.kubeNodeId);
      expect(resumed?.status).toBe("ready");

      const evacuated = await kubeNodeSvc.evacuateNode(db, node.kubeNodeId);
      expect(evacuated?.status).toBe("evacuating");
    });
  });

  // --- IPAM ---
  describe("ipam", () => {
    it("creates subnet and lists", async () => {
      const sub = await ipamSvc.createSubnet(db, {
        cidr: "10.0.1.0/24",
        gateway: "10.0.1.1",
        subnetType: "vm",
      });
      expect(sub.subnetId).toBeTruthy();
      const all = await ipamSvc.listSubnets(db);
      expect(all).toHaveLength(1);
    });

    it("registers IP as available", async () => {
      const ip = await ipamSvc.registerIp(db, { address: "10.0.1.10" });
      expect(ip.status).toBe("available");
    });

    it("lists available IPs only", async () => {
      const ip1 = await ipamSvc.registerIp(db, { address: "10.0.1.11" });
      await ipamSvc.registerIp(db, { address: "10.0.1.12" });

      await ipamSvc.assignIp(db, ip1.ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_test123",
      });

      const available = await ipamSvc.listAvailableIps(db);
      expect(available).toHaveLength(1);
      expect(available[0].address).toBe("10.0.1.12");
    });

    it("assigns and releases IPs", async () => {
      const ip = await ipamSvc.registerIp(db, { address: "10.0.1.20" });

      const assigned = await ipamSvc.assignIp(db, ip.ipAddressId, {
        assignedToType: "host",
        assignedToId: "host_abc",
        hostname: "server01",
      });
      expect(assigned?.status).toBe("assigned");
      expect(assigned?.assignedToType).toBe("host");

      const released = await ipamSvc.releaseIp(db, ip.ipAddressId);
      expect(released?.status).toBe("available");
      expect(released?.assignedToType).toBeNull();
    });

    it("looks up IP by address", async () => {
      await ipamSvc.registerIp(db, { address: "10.0.1.30" });
      const found = await ipamSvc.lookupIp(db, "10.0.1.30");
      expect(found?.address).toBe("10.0.1.30");

      const notFound = await ipamSvc.lookupIp(db, "99.99.99.99");
      expect(notFound).toBeNull();
    });

    it("returns IPAM stats", async () => {
      await ipamSvc.registerIp(db, { address: "10.0.2.1" });
      await ipamSvc.registerIp(db, { address: "10.0.2.2" });
      const ip3 = await ipamSvc.registerIp(db, { address: "10.0.2.3" });
      await ipamSvc.assignIp(db, ip3.ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_xyz",
      });

      const stats = await ipamSvc.getIpamStats(db);
      expect(stats.total).toBe(3);
      expect(stats.available).toBe(2);
      expect(stats.assigned).toBe(1);
    });
  });
});
