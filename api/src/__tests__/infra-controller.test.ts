import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

interface ApiResponse<T = Record<string, unknown>> { data: T }
interface ApiListResponse<T = Record<string, unknown>> { data: T[] }

const BASE = "http://localhost/api/v1/factory/infra";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// v2: ontologyRoutes uses POST /:id/update (not PATCH)
function update(url: string, body: Record<string, unknown>) {
  return new Request(`${url}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// v2: ontologyRoutes uses POST /:id/delete (not DELETE)
function del(url: string) {
  return new Request(`${url}/delete`, { method: "POST" });
}

describe("Infra Controller (v2)", () => {
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
  // Substrates (was providers + subnets)
  // ==========================================================================
  describe("substrates", () => {
    it("POST creates and GET lists substrates", async () => {
      const create = await app.handle(
        post(`${BASE}/substrates`, {
          name: "test-substrate",
          slug: "test-substrate",
          type: "datacenter",
          spec: {},
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();
      expect(created.slug).toBe("test-substrate");

      const list = await app.handle(new Request(`${BASE}/substrates`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });

    it("GET /substrates/:slugOrId returns detail by slug", async () => {
      await app.handle(
        post(`${BASE}/substrates`, {
          name: "my-substrate",
          slug: "my-substrate",
          type: "vpc",
          spec: {},
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/substrates/my-substrate`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse;
      expect(data.name).toBe("my-substrate");
      expect(data.type).toBe("vpc");
    });

    it("GET /substrates/:slugOrId returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/substrates/sub_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /substrates/:slugOrId/update updates substrate", async () => {
      const createRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "update-me",
          slug: "update-me",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        update(`${BASE}/substrates/${created.id}`, {
          spec: { location: "us-east" },
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: Record<string, unknown> }>;
      expect(data.spec.location).toBe("us-east");
    });

    it("POST /substrates/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "delete-me",
          slug: "delete-me",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(del(`${BASE}/substrates/${created.id}`));
      expect(res.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/substrates`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(0);
    });

    it("GET /substrates/:id/hosts returns related hosts", async () => {
      const subRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "sub-with-hosts",
          slug: "sub-with-hosts",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: sub } = (await subRes.json()) as ApiResponse;

      await app.handle(
        post(`${BASE}/hosts`, {
          name: "host-1",
          slug: "host-1",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "host-1.local" },
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/substrates/${sub.id}/hosts`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("host-1");
    });
  });

  // ==========================================================================
  // Hosts
  // ==========================================================================
  describe("hosts", () => {
    it("POST creates and GET lists hosts", async () => {
      const subRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "host-sub",
          slug: "host-sub",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: sub } = (await subRes.json()) as ApiResponse;

      const create = await app.handle(
        post(`${BASE}/hosts`, {
          name: "test-host",
          slug: "test-host",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "test-host.local", arch: "amd64", cpu: 16, memoryMb: 65536 },
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/hosts`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });

    it("GET /hosts/:slugOrId returns detail", async () => {
      const subRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "h-sub",
          slug: "h-sub",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: sub } = (await subRes.json()) as ApiResponse;

      await app.handle(
        post(`${BASE}/hosts`, {
          name: "detail-host",
          slug: "detail-host",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "detail-host.local", arch: "arm64" },
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/hosts/detail-host`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: Record<string, unknown> }>;
      expect(data.spec.arch).toBe("arm64");
    });

    it("POST /hosts/:slugOrId/delete soft-deletes", async () => {
      const subRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "del-sub",
          slug: "del-sub",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: sub } = (await subRes.json()) as ApiResponse;

      const createRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "del-host",
          slug: "del-host",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "del-host.local" },
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(del(`${BASE}/hosts/${created.id}`));
      expect(res.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/hosts`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(0);
    });

    it("GET /hosts/:id/runtimes returns related runtimes", async () => {
      const subRes = await app.handle(
        post(`${BASE}/substrates`, {
          name: "rt-sub",
          slug: "rt-sub",
          type: "datacenter",
          spec: {},
        })
      );
      const { data: sub } = (await subRes.json()) as ApiResponse;

      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "rt-host",
          slug: "rt-host",
          type: "bare-metal",
          substrateId: sub.id,
          spec: { hostname: "rt-host.local" },
        })
      );
      const { data: h } = (await hostRes.json()) as ApiResponse;

      await app.handle(
        post(`${BASE}/runtimes`, {
          name: "k3s-runtime",
          slug: "k3s-runtime",
          type: "k8s-cluster",
          hostId: h.id,
          spec: { kubeconfigRef: "fake-kc", status: "ready" },
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/hosts/${h.id}/runtimes`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("k3s-runtime");
    });
  });

  // ==========================================================================
  // Runtimes (was clusters)
  // ==========================================================================
  describe("runtimes", () => {
    it("POST creates and GET lists runtimes", async () => {
      const create = await app.handle(
        post(`${BASE}/runtimes`, {
          name: "test-runtime",
          slug: "test-runtime",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "fake-kc", status: "ready" },
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/runtimes`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data.some((r: any) => r.slug === "test-runtime")).toBe(true);
    });

    it("GET /runtimes/:slugOrId returns detail by slug", async () => {
      await app.handle(
        post(`${BASE}/runtimes`, {
          name: "my-runtime",
          slug: "my-runtime",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc-data", status: "provisioning" },
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/runtimes/my-runtime`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ name: string; spec: Record<string, unknown> }>;
      expect(data.name).toBe("my-runtime");
      expect(data.spec.status).toBe("provisioning");
    });

    it("GET /runtimes/:slugOrId returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/runtimes/rtm_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /runtimes/:slugOrId/update updates runtime", async () => {
      const createRes = await app.handle(
        post(`${BASE}/runtimes`, {
          name: "update-rt",
          slug: "update-rt",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc", status: "provisioning" },
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        update(`${BASE}/runtimes/${created.id}`, {
          spec: { status: "ready" },
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: Record<string, unknown> }>;
      expect(data.spec.status).toBe("ready");
    });

    it("POST /runtimes/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/runtimes`, {
          name: "del-rt",
          slug: "del-rt",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc", status: "ready" },
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(del(`${BASE}/runtimes/${created.id}`));
      expect(res.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/runtimes`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data.some((r: any) => r.slug === "del-rt")).toBe(false);
    });
  });

  // ==========================================================================
  // Routes
  // ==========================================================================
  describe("routes", () => {
    it("POST creates and GET lists routes", async () => {
      const create = await app.handle(
        post(`${BASE}/routes`, {
          name: "test-route",
          slug: "test-route",
          type: "tunnel",
          domain: "app.tunnel.dx.dev",
          spec: { targetService: "tunnel-broker" },
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/routes`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });

    it("POST /routes/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/routes`, {
          name: "del-route",
          slug: "del-route",
          type: "preview",
          domain: "pr-1.preview.dx.dev",
          spec: {},
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(del(`${BASE}/routes/${created.id}`));
      expect(res.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/routes`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // DNS Domains
  // ==========================================================================
  describe("dns-domains", () => {
    it("POST creates and GET lists DNS domains", async () => {
      const create = await app.handle(
        post(`${BASE}/dns-domains`, {
          name: "dx.dev",
          slug: "dx-dev",
          type: "primary",
          fqdn: "dx.dev",
          spec: { zone: "dx.dev", provider: "cloudflare" },
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/dns-domains`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });

    it("POST /dns-domains/:id/verify marks domain verified", async () => {
      const createRes = await app.handle(
        post(`${BASE}/dns-domains`, {
          name: "verify-test",
          slug: "verify-test",
          type: "custom",
          fqdn: "verify-test.dev",
          spec: { zone: "test.dev" },
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        post(`${BASE}/dns-domains/${created.id}/verify`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: { verified: boolean; verifiedAt: string } }>;
      expect(data.spec.verified).toBe(true);
      expect(data.spec.verifiedAt).toBeTruthy();
    });
  });

  // ==========================================================================
  // Secrets
  // ==========================================================================
  describe("secrets", () => {
    it("POST creates and GET lists secrets", async () => {
      const create = await app.handle(
        post(`${BASE}/secrets`, {
          name: "db-password",
          slug: "db-password",
          spec: { name: "db-password", ownerType: "system", ownerId: "sys-1" },
        })
      );
      expect(create.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/secrets`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });

    it("POST /secrets/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/secrets`, {
          name: "del-secret",
          slug: "del-secret",
          spec: { name: "del-secret", ownerType: "system", ownerId: "sys-1" },
        })
      );
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(del(`${BASE}/secrets/${created.id}`));
      expect(res.status).toBe(200);

      const list = await app.handle(new Request(`${BASE}/secrets`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Network Links
  // ==========================================================================
  describe("network-links", () => {
    it("POST creates and GET lists network links", async () => {
      // Create two runtimes to link
      const rt1Res = await app.handle(
        post(`${BASE}/runtimes`, {
          name: "link-rt-1",
          slug: "link-rt-1",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc1", status: "ready" },
        })
      );
      const { data: rt1 } = (await rt1Res.json()) as ApiResponse;

      const rt2Res = await app.handle(
        post(`${BASE}/runtimes`, {
          name: "link-rt-2",
          slug: "link-rt-2",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc2", status: "ready" },
        })
      );
      const { data: rt2 } = (await rt2Res.json()) as ApiResponse;

      const create = await app.handle(
        post(`${BASE}/network-links`, {
          name: "rt1-to-rt2",
          slug: "rt1-to-rt2",
          type: "mesh",
          sourceId: rt1.id,
          sourceKind: "runtime",
          targetId: rt2.id,
          targetKind: "runtime",
          spec: {},
        })
      );
      expect(create.status).toBe(200);
      const { data: created } = (await create.json()) as ApiResponse;
      expect(created.id).toBeTruthy();

      const list = await app.handle(new Request(`${BASE}/network-links`));
      const { data } = (await list.json()) as ApiListResponse;
      expect(data).toHaveLength(1);
    });
  });
});
