/**
 * IPAM Service Tests
 *
 * Tests atomic allocation, conflict detection, bulk operations, import/export,
 * network device adapter integration, and subnet tree queries.
 */
import type { PGlite } from "@electric-sql/pglite"
import type { IpAddressSpec } from "@smp/factory-shared/schemas/infra"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type {
  ArpEntry,
  DhcpLease,
  NetworkDeviceAdapter,
  NetworkInterface,
} from "../adapters/network-device-adapter"
import { NoopNetworkDeviceAdapter } from "../adapters/network-device-adapter-noop"
import type { Database } from "../db/connection"
import { estate, ipAddress } from "../db/schema/infra-v2"
import * as ipamSvc from "../services/infra/ipam.service"
import { createTestContext, truncateAllTables } from "../test-helpers"

describe("IPAM Service", () => {
  let db: Database
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
    await client.query(
      `TRUNCATE TABLE infra.ip_address RESTART IDENTITY CASCADE`
    )
    await client.query(`TRUNCATE TABLE infra.estate RESTART IDENTITY CASCADE`)
  })

  // --- Helpers ---

  async function createTestSubnet(cidr = "10.0.1.0/24") {
    return ipamSvc.createSubnet(db, {
      cidr,
      gateway: "10.0.1.1",
      netmask: "255.255.255.0",
      subnetType: "vm",
      description: "test subnet",
    })
  }

  async function seedIps(subnetId: string, count: number, startOctet = 10) {
    const ips = []
    for (let i = 0; i < count; i++) {
      const ip = await ipamSvc.registerIp(db, {
        address: `10.0.1.${startOctet + i}`,
        subnetId,
      })
      ips.push(ip)
    }
    return ips
  }

  // =========================================================================
  // Atomic Allocation
  // =========================================================================
  describe("allocateNextAvailable", () => {
    it("allocates the first available IP sequentially", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 3)

      const allocated = await ipamSvc.allocateNextAvailable(db, {
        subnetId: sub.subnetId,
        assignedToType: "vm",
        assignedToId: "vm_test_1",
        hostname: "web-01",
        purpose: "web server",
      })

      expect(allocated.status).toBe("assigned")
      expect(allocated.assignedToType).toBe("vm")
      expect(allocated.assignedToId).toBe("vm_test_1")
      expect(allocated.hostname).toBe("web-01")
      expect(allocated.address).toBe("10.0.1.10")
    })

    it("allocates different IPs on successive calls", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 3)

      const first = await ipamSvc.allocateNextAvailable(db, {
        subnetId: sub.subnetId,
        assignedToType: "vm",
        assignedToId: "vm_1",
      })
      const second = await ipamSvc.allocateNextAvailable(db, {
        subnetId: sub.subnetId,
        assignedToType: "vm",
        assignedToId: "vm_2",
      })

      expect(first.address).not.toBe(second.address)
      expect(first.status).toBe("assigned")
      expect(second.status).toBe("assigned")
    })

    it("throws NoAvailableIpsError when subnet is exhausted", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 1)

      // Allocate the only IP
      await ipamSvc.allocateNextAvailable(db, {
        subnetId: sub.subnetId,
        assignedToType: "vm",
        assignedToId: "vm_1",
      })

      // Try again — should fail
      await expect(
        ipamSvc.allocateNextAvailable(db, {
          subnetId: sub.subnetId,
          assignedToType: "vm",
          assignedToId: "vm_2",
        })
      ).rejects.toThrow(ipamSvc.NoAvailableIpsError)
    })

    it("handles concurrent allocation without duplicates", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 5)

      // Fire 10 concurrent allocations for 5 IPs
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          ipamSvc.allocateNextAvailable(db, {
            subnetId: sub.subnetId,
            assignedToType: "vm",
            assignedToId: `vm_${i}`,
          })
        )
      )

      const fulfilled = results.filter((r) => r.status === "fulfilled")
      const rejected = results.filter((r) => r.status === "rejected")

      expect(fulfilled).toHaveLength(5)
      expect(rejected).toHaveLength(5)

      // Verify no duplicate addresses
      const allocatedAddresses = fulfilled.map(
        (r) => (r as PromiseFulfilledResult<any>).value.address
      )
      const uniqueAddresses = new Set(allocatedAddresses)
      expect(uniqueAddresses.size).toBe(5)
    })

    it("skips already-assigned IPs", async () => {
      const sub = await createTestSubnet()
      const ips = await seedIps(sub.subnetId, 3)

      // Manually assign the first IP
      await ipamSvc.assignIp(db, ips[0].ipAddressId, {
        assignedToType: "host",
        assignedToId: "host_1",
      })

      // allocateNextAvailable should skip the assigned one
      const allocated = await ipamSvc.allocateNextAvailable(db, {
        subnetId: sub.subnetId,
        assignedToType: "vm",
        assignedToId: "vm_1",
      })

      expect(allocated.address).not.toBe(ips[0].address)
    })
  })

  // =========================================================================
  // Conflict Detection
  // =========================================================================
  describe("checkConflicts", () => {
    it("returns free for unknown addresses", async () => {
      const results = await ipamSvc.checkConflicts(db, [
        "10.0.1.99",
        "10.0.1.100",
      ])

      expect(results).toHaveLength(2)
      expect(results[0].status).toBe("free")
      expect(results[1].status).toBe("free")
    })

    it("returns registered for existing addresses", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.50",
        subnetId: sub.subnetId,
      })

      const results = await ipamSvc.checkConflicts(db, [
        "10.0.1.50",
        "10.0.1.51",
      ])

      expect(results[0].status).toBe("registered")
      expect(results[0].existingRecord).toBeDefined()
      expect(results[0].existingRecord!.ipAddressId).toBeTruthy()
      expect(results[1].status).toBe("free")
    })

    it("handles empty array", async () => {
      const results = await ipamSvc.checkConflicts(db, [])
      expect(results).toHaveLength(0)
    })
  })

  describe("verifyOnNetwork", () => {
    it("returns empty with noop adapter", async () => {
      const adapter = new NoopNetworkDeviceAdapter()
      const conflicts = await ipamSvc.verifyOnNetwork(db, adapter)
      expect(conflicts).toHaveLength(0)
    })

    it("detects ghost IPs from ARP table", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub.subnetId,
      })

      // Mock adapter that returns an IP not in our DB
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [
          { ipAddress: "10.0.1.10", macAddress: "aa:bb:cc:dd:ee:01" },
          {
            ipAddress: "10.0.1.99",
            macAddress: "aa:bb:cc:dd:ee:02",
            hostname: "unknown-device",
          },
        ],
        getDhcpLeases: async () => [],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const conflicts = await ipamSvc.verifyOnNetwork(
        db,
        mockAdapter,
        sub.subnetId
      )

      const ghost = conflicts.find((c) => c.type === "ghost")
      expect(ghost).toBeDefined()
      expect(ghost!.address).toBe("10.0.1.99")
      expect(ghost!.foundVia).toBe("arp")
      expect(ghost!.mac).toBe("aa:bb:cc:dd:ee:02")
    })

    it("detects stale assignments", async () => {
      const sub = await createTestSubnet()
      const ip = await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub.subnetId,
      })
      await ipamSvc.assignIp(db, ip.ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_1",
      })

      // Mock adapter returns empty ARP — IP not seen on network
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [],
        getDhcpLeases: async () => [],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const conflicts = await ipamSvc.verifyOnNetwork(
        db,
        mockAdapter,
        sub.subnetId
      )

      const stale = conflicts.find((c) => c.type === "stale")
      expect(stale).toBeDefined()
      expect(stale!.address).toBe("10.0.1.10")
      expect(stale!.foundVia).toBe("db")
    })

    it("detects ghost IPs from DHCP leases", async () => {
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [],
        getDhcpLeases: async () => [
          {
            ipAddress: "10.0.1.200",
            macAddress: "ff:ff:ff:00:00:01",
            hostname: "dhcp-client",
            status: "active" as const,
          },
        ],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const conflicts = await ipamSvc.verifyOnNetwork(db, mockAdapter)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].type).toBe("ghost")
      expect(conflicts[0].foundVia).toBe("dhcp")
      expect(conflicts[0].hostname).toBe("dhcp-client")
    })
  })

  // =========================================================================
  // Bulk Operations
  // =========================================================================
  describe("bulkRegister", () => {
    it("registers multiple IPs", async () => {
      const sub = await createTestSubnet()
      const result = await ipamSvc.bulkRegister(db, [
        { address: "10.0.1.10", subnetId: sub.subnetId },
        { address: "10.0.1.11", subnetId: sub.subnetId },
        { address: "10.0.1.12", subnetId: sub.subnetId },
      ])

      expect(result.inserted).toBe(3)
      expect(result.skipped).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it("skips duplicates with onConflictDoNothing", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub.subnetId,
      })

      const result = await ipamSvc.bulkRegister(db, [
        { address: "10.0.1.10", subnetId: sub.subnetId }, // duplicate
        { address: "10.0.1.11", subnetId: sub.subnetId }, // new
      ])

      expect(result.inserted).toBe(1)
      expect(result.skipped).toBe(1)
    })

    it("handles empty array", async () => {
      const result = await ipamSvc.bulkRegister(db, [])
      expect(result.inserted).toBe(0)
      expect(result.skipped).toBe(0)
    })
  })

  describe("bulkAssign", () => {
    it("assigns multiple available IPs", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 3)

      const result = await ipamSvc.bulkAssign(db, [
        { address: "10.0.1.10", assignedToType: "vm", assignedToId: "vm_1" },
        { address: "10.0.1.11", assignedToType: "vm", assignedToId: "vm_2" },
      ])

      expect(result.assigned).toBe(2)
      expect(result.skipped).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it("skips non-existent addresses", async () => {
      const result = await ipamSvc.bulkAssign(db, [
        { address: "10.0.1.99", assignedToType: "vm", assignedToId: "vm_1" },
      ])

      expect(result.assigned).toBe(0)
      expect(result.skipped).toBe(1)
      expect(result.errors[0]).toContain("not found")
    })

    it("skips already-assigned IPs", async () => {
      const sub = await createTestSubnet()
      const ips = await seedIps(sub.subnetId, 1)
      await ipamSvc.assignIp(db, ips[0].ipAddressId, {
        assignedToType: "host",
        assignedToId: "host_1",
      })

      const result = await ipamSvc.bulkAssign(db, [
        { address: "10.0.1.10", assignedToType: "vm", assignedToId: "vm_1" },
      ])

      expect(result.assigned).toBe(0)
      expect(result.skipped).toBe(1)
      expect(result.errors[0]).toContain("status is assigned")
    })

    it("handles empty array", async () => {
      const result = await ipamSvc.bulkAssign(db, [])
      expect(result.assigned).toBe(0)
    })
  })

  // =========================================================================
  // Import/Export
  // =========================================================================
  describe("importIps", () => {
    it("imports rows and resolves subnet CIDRs", async () => {
      const sub = await createTestSubnet("10.0.1.0/24")

      const result = await ipamSvc.importIps(db, [
        {
          address: "10.0.1.20",
          subnet_cidr: "10.0.1.0/24",
          hostname: "web-01",
          status: "available",
        },
        {
          address: "10.0.1.21",
          subnet_cidr: "10.0.1.0/24",
          hostname: "web-02",
          status: "available",
        },
      ])

      expect(result.total).toBe(2)
      expect(result.registered).toBe(2)
      expect(result.skippedConflicts).toBe(0)
    })

    it("skips conflicting addresses", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.20",
        subnetId: sub.subnetId,
      })

      const result = await ipamSvc.importIps(db, [
        { address: "10.0.1.20", hostname: "existing" }, // conflict
        { address: "10.0.1.21", hostname: "new-one" }, // ok
      ])

      expect(result.registered).toBe(1)
      expect(result.skippedConflicts).toBe(1)
    })

    it("imports and assigns in one pass", async () => {
      await createTestSubnet("10.0.1.0/24")

      const result = await ipamSvc.importIps(db, [
        {
          address: "10.0.1.30",
          subnet_cidr: "10.0.1.0/24",
          hostname: "db-01",
          purpose: "database",
          assigned_to_type: "vm",
          assigned_to_id: "vm_db_1",
        },
      ])

      expect(result.registered).toBe(1)
      expect(result.assigned).toBe(1)

      // Verify the IP is actually assigned
      const ip = await ipamSvc.lookupIp(db, "10.0.1.30")
      expect(ip!.status).toBe("assigned")
      expect(ip!.assignedToType).toBe("vm")
    })

    it("reports unknown subnet CIDRs", async () => {
      const result = await ipamSvc.importIps(db, [
        { address: "10.0.1.50", subnet_cidr: "172.16.0.0/16" },
      ])

      expect(result.errors.some((e) => e.includes("Unknown subnet CIDR"))).toBe(
        true
      )
    })
  })

  describe("exportIps", () => {
    it("exports as JSON", async () => {
      const sub = await createTestSubnet("10.0.1.0/24")
      await seedIps(sub.subnetId, 2)

      const result = await ipamSvc.exportIps(db, { format: "json" })

      expect(result.data).toHaveLength(2)
      expect(result.csv).toBeUndefined()
      expect(result.data[0].address).toBeTruthy()
      expect(result.data[0].subnet_cidr).toBe("10.0.1.0/24")
    })

    it("exports as CSV with proper header", async () => {
      const sub = await createTestSubnet("10.0.1.0/24")
      await seedIps(sub.subnetId, 2)

      const result = await ipamSvc.exportIps(db, { format: "csv" })

      expect(result.csv).toBeDefined()
      const lines = result.csv!.split("\n")
      expect(lines[0]).toBe(
        "address,subnet_cidr,hostname,purpose,status,assigned_to_type,assigned_to_id"
      )
      expect(lines).toHaveLength(3) // header + 2 rows
    })

    it("filters by subnet", async () => {
      const sub1 = await createTestSubnet("10.0.1.0/24")
      const sub2 = await createTestSubnet("10.0.2.0/24")
      await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub1.subnetId,
      })
      await ipamSvc.registerIp(db, {
        address: "10.0.2.10",
        subnetId: sub2.subnetId,
      })

      const result = await ipamSvc.exportIps(db, {
        subnetId: sub1.subnetId,
        format: "json",
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].address).toBe("10.0.1.10")
    })

    it("round-trips: export then re-import produces no new records", async () => {
      const sub = await createTestSubnet("10.0.1.0/24")
      await seedIps(sub.subnetId, 3)

      // Export
      const exported = await ipamSvc.exportIps(db, { format: "json" })

      // Re-import the same data
      const importResult = await ipamSvc.importIps(
        db,
        exported.data.map((r) => ({
          address: r.address,
          subnet_cidr: r.subnet_cidr,
          hostname: r.hostname || undefined,
          purpose: r.purpose || undefined,
          status: r.status,
        }))
      )

      // All should be skipped as conflicts
      expect(importResult.registered).toBe(0)
      expect(importResult.skippedConflicts).toBe(3)
    })
  })

  // =========================================================================
  // Import from Network Device
  // =========================================================================
  describe("importFromDevice", () => {
    it("dry run returns preview without registering", async () => {
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [
          {
            ipAddress: "10.0.1.50",
            macAddress: "aa:bb:cc:00:00:01",
            hostname: "device-a",
          },
          { ipAddress: "10.0.1.51", macAddress: "aa:bb:cc:00:00:02" },
        ],
        getDhcpLeases: async () => [],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const result = await ipamSvc.importFromDevice(db, mockAdapter, {
        dryRun: true,
      })

      expect(result.preview).toHaveLength(2)
      expect(result.preview[0].conflict).toBe(false)
      expect(result.result).toBeUndefined()

      // Verify nothing was registered
      const ip = await ipamSvc.lookupIp(db, "10.0.1.50")
      expect(ip).toBeNull()
    })

    it("registers discovered IPs when not dry run", async () => {
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [
          {
            ipAddress: "10.0.1.50",
            macAddress: "aa:bb:cc:00:00:01",
            hostname: "device-a",
          },
        ],
        getDhcpLeases: async () => [],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const result = await ipamSvc.importFromDevice(db, mockAdapter)

      expect(result.result).toBeDefined()
      expect(result.result!.inserted).toBe(1)

      const ip = await ipamSvc.lookupIp(db, "10.0.1.50")
      expect(ip).not.toBeNull()
      expect(ip!.hostname).toBe("device-a")
    })

    it("marks existing IPs as conflicts", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.50",
        subnetId: sub.subnetId,
      })

      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [
          { ipAddress: "10.0.1.50", macAddress: "aa:bb:cc:00:00:01" },
          { ipAddress: "10.0.1.51", macAddress: "aa:bb:cc:00:00:02" },
        ],
        getDhcpLeases: async () => [],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const result = await ipamSvc.importFromDevice(db, mockAdapter)

      const conflicting = result.preview.find((p) => p.address === "10.0.1.50")
      expect(conflicting!.conflict).toBe(true)
      expect(result.result!.inserted).toBe(1) // only the non-conflicting one
    })

    it("deduplicates ARP and DHCP entries", async () => {
      const mockAdapter: NetworkDeviceAdapter = {
        type: "mock",
        getArpTable: async () => [
          { ipAddress: "10.0.1.60", macAddress: "aa:bb:cc:00:00:01" },
        ],
        getDhcpLeases: async () => [
          {
            ipAddress: "10.0.1.60",
            macAddress: "aa:bb:cc:00:00:01",
            status: "active" as const,
          },
          {
            ipAddress: "10.0.1.61",
            macAddress: "aa:bb:cc:00:00:02",
            status: "active" as const,
          },
        ],
        getInterfaces: async () => [],
        ping: async () => false,
      }

      const result = await ipamSvc.importFromDevice(db, mockAdapter)

      // 10.0.1.60 should appear once (from ARP), 10.0.1.61 from DHCP
      expect(result.preview).toHaveLength(2)
      expect(result.result!.inserted).toBe(2)
    })
  })

  // =========================================================================
  // Subnet Tree
  // =========================================================================
  describe("getSubnetTree", () => {
    it("returns subnets with IP utilization stats", async () => {
      const sub = await createTestSubnet()
      await seedIps(sub.subnetId, 5)

      // Assign 2 of them
      const available = await ipamSvc.listAvailableIps(db, sub.subnetId)
      await ipamSvc.assignIp(db, available[0].ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_1",
      })
      await ipamSvc.assignIp(db, available[1].ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_2",
      })

      const tree = await ipamSvc.getSubnetTree(db)

      expect(tree).toHaveLength(1)
      expect(tree[0].cidr).toBe("10.0.1.0/24")
      expect(tree[0].ipStats.total).toBe(5)
      expect(tree[0].ipStats.available).toBe(3)
      expect(tree[0].ipStats.assigned).toBe(2)
    })

    it("returns multiple subnets", async () => {
      await createTestSubnet("10.0.1.0/24")
      await createTestSubnet("10.0.2.0/24")

      const tree = await ipamSvc.getSubnetTree(db)
      expect(tree).toHaveLength(2)
    })

    it("filters by subnet ID", async () => {
      const sub1 = await createTestSubnet("10.0.1.0/24")
      await createTestSubnet("10.0.2.0/24")

      const tree = await ipamSvc.getSubnetTree(db, sub1.subnetId)
      expect(tree).toHaveLength(1)
      expect(tree[0].cidr).toBe("10.0.1.0/24")
    })
  })

  // =========================================================================
  // Noop Adapter
  // =========================================================================
  describe("NoopNetworkDeviceAdapter", () => {
    it("returns empty arrays for all methods", async () => {
      const adapter = new NoopNetworkDeviceAdapter()

      expect(await adapter.getArpTable()).toEqual([])
      expect(await adapter.getDhcpLeases()).toEqual([])
      expect(await adapter.getInterfaces()).toEqual([])
      expect(await adapter.ping("10.0.1.1")).toBe(false)
    })

    it("has type noop", () => {
      const adapter = new NoopNetworkDeviceAdapter()
      expect(adapter.type).toBe("noop")
    })
  })

  // =========================================================================
  // IPAM Stats
  // =========================================================================
  describe("getIpamStats", () => {
    it("returns correct counts by status", async () => {
      const sub = await createTestSubnet()
      const ips = await seedIps(sub.subnetId, 4)

      // Assign 2
      await ipamSvc.assignIp(db, ips[0].ipAddressId, {
        assignedToType: "vm",
        assignedToId: "vm_1",
      })
      await ipamSvc.assignIp(db, ips[1].ipAddressId, {
        assignedToType: "host",
        assignedToId: "host_1",
      })

      const stats = await ipamSvc.getIpamStats(db, sub.subnetId)

      expect(stats.total).toBe(4)
      expect(stats.available).toBe(2)
      expect(stats.assigned).toBe(2)
      expect(stats.reserved).toBe(0)
    })

    it("returns zeros for empty subnet", async () => {
      const sub = await createTestSubnet()
      const stats = await ipamSvc.getIpamStats(db, sub.subnetId)

      expect(stats.total).toBe(0)
      expect(stats.available).toBe(0)
    })
  })

  // =========================================================================
  // CSV Escaping
  // =========================================================================
  describe("CSV export escaping", () => {
    it("escapes fields with commas", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub.subnetId,
      })
      // Update hostname to contain a comma via direct DB update
      const { eq } = await import("drizzle-orm")
      // hostname is in spec JSONB
      const [existing] = await db
        .select()
        .from(ipAddress)
        .where(eq(ipAddress.address, "10.0.1.10"))
      await db
        .update(ipAddress)
        .set({
          spec: {
            ...(existing.spec as Record<string, unknown>),
            hostname: "web,server",
          } as unknown as IpAddressSpec,
        })
        .where(eq(ipAddress.address, "10.0.1.10"))

      const result = await ipamSvc.exportIps(db, { format: "csv" })
      const dataLine = result.csv!.split("\n")[1]

      // The hostname field should be quoted
      expect(dataLine).toContain('"web,server"')
    })

    it("prefixes formula-trigger characters", async () => {
      const sub = await createTestSubnet()
      await ipamSvc.registerIp(db, {
        address: "10.0.1.10",
        subnetId: sub.subnetId,
      })

      const { eq } = await import("drizzle-orm")
      // purpose is in spec JSONB
      const [existing] = await db
        .select()
        .from(ipAddress)
        .where(eq(ipAddress.address, "10.0.1.10"))
      await db
        .update(ipAddress)
        .set({
          spec: { ...existing.spec, purpose: "=cmd|calc" } as IpAddressSpec,
        })
        .where(eq(ipAddress.address, "10.0.1.10"))

      const result = await ipamSvc.exportIps(db, { format: "csv" })
      const dataLine = result.csv!.split("\n")[1]

      // Should be escaped — not start with raw =
      expect(dataLine).not.toContain(",=cmd|calc")
      expect(dataLine).toContain("'=cmd|calc")
    })
  })
})
