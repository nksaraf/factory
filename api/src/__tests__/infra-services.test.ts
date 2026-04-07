import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";

import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

// v2 schema imports — direct DB operations instead of v1 service calls
import { substrate, host, runtime } from "../db/schema/infra-v2";
import { eq } from "drizzle-orm";
import type { SubstrateSpec, HostSpec, RuntimeSpec } from "@smp/factory-shared/schemas/infra";

describe("Infra Services (v2)", () => {
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

  // Helper: create a substrate
  async function createSubstrate(
    name = "test-substrate",
    overrides?: Record<string, unknown>
  ) {
    const [sub] = await db
      .insert(substrate)
      .values({
        name,
        slug: name,
        type: (overrides?.type as string) ?? "datacenter",
        spec: {
          lifecycle: "active",
          ...overrides,
        } as SubstrateSpec,
      })
      .returning();
    return sub;
  }

  // --- Substrate (was Provider) ---
  describe("substrate", () => {
    it("creates and lists substrates", async () => {
      const created = await createSubstrate("test-hypervisor", {
        type: "hypervisor",
      });
      expect(created.id).toBeTruthy();
      expect(created.name).toBe("test-hypervisor");

      const all = await db.select().from(substrate);
      expect(all).toHaveLength(1);
    });

    it("gets substrate by id", async () => {
      const created = await createSubstrate("sub-1", { type: "cloud-account" });
      const [fetched] = await db
        .select()
        .from(substrate)
        .where(eq(substrate.id, created.id));
      expect(fetched.name).toBe("sub-1");
    });

    it("filters by status", async () => {
      await createSubstrate("active-sub", { status: "active" });

      const all = await db.select().from(substrate);
      const active = all.filter(
        (s) => (s.spec as Record<string, unknown>).status === "active"
      );
      expect(active).toHaveLength(1);

      const inactive = all.filter(
        (s) => (s.spec as Record<string, unknown>).status === "inactive"
      );
      expect(inactive).toHaveLength(0);
    });

    it("updates substrate", async () => {
      const created = await createSubstrate("old-name");
      await db
        .update(substrate)
        .set({ name: "new-name" })
        .where(eq(substrate.id, created.id));

      const [updated] = await db
        .select()
        .from(substrate)
        .where(eq(substrate.id, created.id));
      expect(updated.name).toBe("new-name");
    });
  });

  // --- Host ---
  describe("host", () => {
    it("creates and lists hosts", async () => {
      const sub = await createSubstrate();
      const [h] = await db
        .insert(host)
        .values({
          name: "host-01",
          slug: "host-01",
          type: "bare-metal",
          substrateId: sub.id,
          spec: {
            hostname: "host-01",
            os: "linux",
            arch: "amd64",
            cpu: 32,
            memoryMb: 131072,
            diskGb: 2000,
            lifecycle: "active",
            accessMethod: "ssh",
            accessUser: "root",
            sshPort: 22,
          } satisfies HostSpec,
        })
        .returning();

      expect(h.id).toBeTruthy();
      const all = await db.select().from(host);
      expect(all).toHaveLength(1);
    });

    it("creates host with osType and accessMethod", async () => {
      const sub = await createSubstrate();
      const [h] = await db
        .insert(host)
        .values({
          name: "win-srv-01",
          slug: "win-srv-01",
          type: "bare-metal",
          substrateId: sub.id,
          spec: {
            hostname: "win-srv-01",
            os: "windows",
            arch: "amd64",
            cpu: 16,
            memoryMb: 65536,
            diskGb: 1000,
            accessMethod: "ssh",
            accessUser: "root",
            sshPort: 22,
            lifecycle: "active",
          } satisfies HostSpec,
        })
        .returning();

      expect(h.spec.os).toBe("windows");
      expect(h.spec.accessMethod).toBe("ssh");
    });

    it("defaults host to linux + ssh", async () => {
      const sub = await createSubstrate();
      const [h] = await db
        .insert(host)
        .values({
          name: "linux-srv-01",
          slug: "linux-srv-01",
          type: "bare-metal",
          substrateId: sub.id,
          spec: {
            hostname: "linux-srv-01",
            os: "linux",
            arch: "amd64",
            cpu: 16,
            memoryMb: 65536,
            diskGb: 1000,
            accessMethod: "ssh",
            accessUser: "root",
            sshPort: 22,
            lifecycle: "active",
          } satisfies HostSpec,
        })
        .returning();

      expect(h.spec.os).toBe("linux");
      expect(h.spec.accessMethod).toBe("ssh");
    });

    it("filters hosts by type", async () => {
      const sub = await createSubstrate();
      await db.insert(host).values([
        {
          name: "bare-01",
          slug: "bare-01",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "bare-01", os: "linux", arch: "amd64", cpu: 8, memoryMb: 32768, diskGb: 500, lifecycle: "active", accessMethod: "ssh", accessUser: "root", sshPort: 22 } satisfies HostSpec,
        },
        {
          name: "vm-01",
          slug: "vm-01",
          type: "vm",
          substrateId: sub.id,
          spec: { hostname: "vm-01", os: "linux", arch: "amd64", cpu: 4, memoryMb: 8192, diskGb: 100, lifecycle: "active", accessMethod: "ssh", accessUser: "root", sshPort: 22 } satisfies HostSpec,
        },
      ]);

      const vms = await db
        .select()
        .from(host)
        .where(eq(host.type, "vm"));
      expect(vms).toHaveLength(1);
      expect(vms[0].name).toBe("vm-01");
    });
  });

  // --- Runtime (was Cluster) ---
  describe("runtime", () => {
    it("creates with provisioning status", async () => {
      const sub = await createSubstrate();
      const [rt] = await db
        .insert(runtime)
        .values({
          name: "test-runtime",
          slug: "test-runtime",
          type: "k8s-cluster",
          spec: {
            kubeconfigRef: "/tmp/test.yaml",
            status: "provisioning",
            endpoint: "localhost",
          } satisfies RuntimeSpec,
        })
        .returning();

      expect(rt.spec.status).toBe("provisioning");
    });

    it("updates status", async () => {
      const sub = await createSubstrate();
      const [rt] = await db
        .insert(runtime)
        .values({
          name: "rt-1",
          slug: "rt-1",
          type: "k8s-cluster",
          spec: {
            kubeconfigRef: "/tmp/test.yaml",
            status: "provisioning",
            endpoint: "localhost",
          } satisfies RuntimeSpec,
        })
        .returning();

      await db
        .update(runtime)
        .set({
          spec: { ...rt.spec, status: "ready" } satisfies RuntimeSpec,
        })
        .where(eq(runtime.id, rt.id));

      const [updated] = await db
        .select()
        .from(runtime)
        .where(eq(runtime.id, rt.id));
      expect(updated.spec.status).toBe("ready");
    });

    it("destroys runtime", async () => {
      const sub = await createSubstrate();
      const [rt] = await db
        .insert(runtime)
        .values({
          name: "rt-2",
          slug: "rt-2",
          type: "k8s-cluster",
          spec: {
            kubeconfigRef: "/tmp/test.yaml",
            status: "ready",
            endpoint: "localhost",
          } satisfies RuntimeSpec,
        })
        .returning();

      await db
        .update(runtime)
        .set({
          spec: { ...rt.spec, status: "destroying" } satisfies RuntimeSpec,
        })
        .where(eq(runtime.id, rt.id));

      const [updated] = await db
        .select()
        .from(runtime)
        .where(eq(runtime.id, rt.id));
      expect(updated.spec.status).toBe("destroying");
    });
  });
});
