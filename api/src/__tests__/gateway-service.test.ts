import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";

import * as gw from "../modules/infra/gateway.service";
import * as fleet from "../modules/fleet/service";
import * as providerSvc from "../services/infra/provider.service";
import * as regionSvc from "../services/infra/region.service";
import * as clusterSvc from "../services/infra/cluster.service";

import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Gateway Service", () => {
  let db: Database;
  let client: PGlite;

  async function createInfraPrereqs() {
    const provider = await providerSvc.createProvider(db, {
      name: "test-provider",
      providerType: "proxmox",
    });
    const region = await regionSvc.createRegion(db, {
      name: "test-region",
      displayName: "Test Region",
      providerId: provider.providerId,
    });
    const cluster = await clusterSvc.createCluster(db, {
      name: "test-cluster",
      providerId: provider.providerId,
      regionId: region.regionId,
      kubeApiUrl: "https://k8s.test",
    });
    return { provider, region, cluster };
  }

  async function createSitePrereqs() {
    const { provider, region, cluster } = await createInfraPrereqs();
    const site = await fleet.createSite(db, {
      name: "test-site",
      product: "test-product",
      clusterId: cluster.clusterId,
      createdBy: "test",
    });
    return { provider, region, cluster, site };
  }

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

  // ---------------------------------------------------------------------------
  // Route CRUD
  // ---------------------------------------------------------------------------
  describe("route CRUD", () => {
    it("creates and lists routes", async () => {
      const r = await gw.createRoute(db, {
        kind: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      });
      expect(r.routeId).toBeTruthy();
      expect(r.domain).toBe("api.test.dx.dev");

      const { data, total } = await gw.listRoutes(db);
      expect(data).toHaveLength(1);
      expect(total).toBe(1);
    });

    it("gets route by id", async () => {
      const created = await gw.createRoute(db, {
        kind: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      });

      const fetched = await gw.getRoute(db, created.routeId);
      expect(fetched).not.toBeNull();
      expect(fetched!.routeId).toBe(created.routeId);
      expect(fetched!.kind).toBe("ingress");
      expect(fetched!.domain).toBe("api.test.dx.dev");
      expect(fetched!.targetService).toBe("api-svc");
      expect(fetched!.createdBy).toBe("test");
      expect(fetched!.status).toBe("pending");
    });

    it("returns null for nonexistent route", async () => {
      const result = await gw.getRoute(db, "rte_nonexistent_000000");
      expect(result).toBeNull();
    });

    it("updates route status", async () => {
      const created = await gw.createRoute(db, {
        kind: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      });

      const updated = await gw.updateRoute(db, created.routeId, {
        status: "active",
      });
      expect(updated!.status).toBe("active");
    });

    it("deletes route", async () => {
      const created = await gw.createRoute(db, {
        kind: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      });

      await gw.deleteRoute(db, created.routeId);

      const { data } = await gw.listRoutes(db);
      expect(data).toHaveLength(0);
    });

    it("filters routes by kind", async () => {
      await gw.createRoute(db, {
        kind: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      });
      await gw.createRoute(db, {
        kind: "sandbox",
        domain: "sandbox.test.dx.dev",
        targetService: "sandbox-svc",
        createdBy: "test",
      });

      const { data, total } = await gw.listRoutes(db, { kind: "sandbox" });
      expect(data).toHaveLength(1);
      expect(total).toBe(1);
      expect(data[0].kind).toBe("sandbox");
    });

    it("cleans up expired routes", async () => {
      await gw.createRoute(db, {
        kind: "ingress",
        domain: "expired.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
        expiresAt: new Date(Date.now() - 10_000),
      });

      const cleaned = await gw.cleanupExpiredRoutes(db);
      expect(cleaned).toBe(1);

      const { data } = await gw.listRoutes(db);
      expect(data).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Domain Management
  // ---------------------------------------------------------------------------
  describe("domain management", () => {
    it("registers domain with verification token", async () => {
      const d = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        kind: "custom",
        createdBy: "test",
      });

      expect(d.domainId).toBeTruthy();
      expect(d.fqdn).toBe("app.acme.com");
      expect(d.verificationToken).toMatch(/^dx-verify-/);
      expect(d.status).toBe("pending");
      expect(d.dnsVerified).toBe(false);
    });

    it("gets domain by id and by fqdn", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        kind: "custom",
        createdBy: "test",
      });

      const byId = await gw.getDomain(db, created.domainId);
      const byFqdn = await gw.getDomainByFqdn(db, "app.acme.com");

      expect(byId).not.toBeNull();
      expect(byFqdn).not.toBeNull();
      expect(byId!.domainId).toBe(byFqdn!.domainId);
      expect(byId!.fqdn).toBe("app.acme.com");
    });

    it("updates domain verification", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        kind: "custom",
        createdBy: "test",
      });

      const updated = await gw.updateDomain(db, created.domainId, {
        dnsVerified: true,
        status: "verified",
      });

      expect(updated!.dnsVerified).toBe(true);
      expect(updated!.status).toBe("verified");
    });

    it("removes domain", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        kind: "custom",
        createdBy: "test",
      });

      await gw.removeDomain(db, created.domainId);

      const { data } = await gw.listDomains(db);
      expect(data).toHaveLength(0);
    });

    it("enforces unique fqdn", async () => {
      await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        kind: "custom",
        createdBy: "test",
      });

      await expect(
        gw.registerDomain(db, {
          fqdn: "app.acme.com",
          kind: "custom",
          createdBy: "test",
        })
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Sandbox Route Helpers
  // ---------------------------------------------------------------------------
  describe("sandbox route helpers", () => {
    it("creates sandbox routes with publish ports", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: `sandbox-${Date.now()}`,
        kind: "sandbox",
        trigger: "manual",
        createdBy: "test",
      });

      const routes = await gw.createSandboxRoutes(db, {
        sandboxSlug: "my-sandbox",
        deploymentTargetId: dt.deploymentTargetId,
        publishPorts: [3000, 8080],
        createdBy: "test",
      });

      expect(routes).toHaveLength(3);

      const primary = routes.find(
        (r: any) => r.domain === "my-sandbox.preview.dx.dev"
      );
      expect(primary).toBeTruthy();
      expect(primary!.kind).toBe("sandbox");

      const port3000 = routes.find(
        (r: any) => r.domain === "my-sandbox-3000.preview.dx.dev"
      );
      expect(port3000).toBeTruthy();
      expect(port3000!.targetPort).toBe(3000);

      const port8080 = routes.find(
        (r: any) => r.domain === "my-sandbox-8080.preview.dx.dev"
      );
      expect(port8080).toBeTruthy();
      expect(port8080!.targetPort).toBe(8080);
    });

    it("creates sandbox routes for site", async () => {
      const { site } = await createSitePrereqs();
      const dt = await fleet.createDeploymentTarget(db, {
        name: `sandbox-site-${Date.now()}`,
        kind: "sandbox",
        trigger: "manual",
        createdBy: "test",
      });

      const routes = await gw.createSandboxRoutes(db, {
        sandboxSlug: "my-sandbox",
        deploymentTargetId: dt.deploymentTargetId,
        siteId: site.siteId,
        createdBy: "test",
      });

      expect(routes).toHaveLength(1);
      expect(routes[0].domain).toBe(
        `my-sandbox.${site.siteId}.dx.dev`
      );
    });

    it("removes target routes", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: `sandbox-${Date.now()}`,
        kind: "sandbox",
        trigger: "manual",
        createdBy: "test",
      });

      await gw.createSandboxRoutes(db, {
        sandboxSlug: "my-sandbox",
        deploymentTargetId: dt.deploymentTargetId,
        publishPorts: [3000],
        createdBy: "test",
      });

      const removed = await gw.removeTargetRoutes(db, dt.deploymentTargetId);
      expect(removed).toBe(2);

      const { data } = await gw.listRoutes(db);
      expect(data).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Preview Routes
  // ---------------------------------------------------------------------------
  describe("preview routes", () => {
    it("creates preview route for PR", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: `preview-${Date.now()}`,
        kind: "sandbox",
        trigger: "manual",
        createdBy: "test",
      });

      const r = await gw.createPreviewRoutes(db, {
        deploymentTargetId: dt.deploymentTargetId,
        prNumber: 42,
        createdBy: "test",
      });

      expect(r.domain).toBe("pr-42.preview.dx.dev");
      expect(r.kind).toBe("preview");
    });
  });

  // ---------------------------------------------------------------------------
  // Tunnel Lifecycle
  // ---------------------------------------------------------------------------
  describe("tunnel lifecycle", () => {
    it("registers tunnel with route", async () => {
      const { tunnel: t, route: r } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      });

      expect(t.subdomain).toBe("test-tunnel");
      expect(t.status).toBe("connecting");
      expect(r.domain).toBe("test-tunnel.tunnel.dx.dev");
      expect(r.kind).toBe("tunnel");
    });

    it("closes tunnel and cascades route", async () => {
      const { tunnel: t, route: r } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      });

      await gw.closeTunnel(db, t.tunnelId);

      const fetchedTunnel = await gw.getTunnel(db, t.tunnelId);
      expect(fetchedTunnel).toBeNull();

      const fetchedRoute = await gw.getRoute(db, r.routeId);
      expect(fetchedRoute).toBeNull();
    });

    it("heartbeat updates timestamp", async () => {
      const { tunnel: t } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      });

      await gw.heartbeatTunnel(db, t.tunnelId);

      const updated = await gw.getTunnel(db, t.tunnelId);
      expect(updated!.lastHeartbeatAt).not.toBeNull();
    });

    it("lists tunnels with filters", async () => {
      await gw.registerTunnel(db, {
        subdomain: "tunnel-a",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      });
      await gw.registerTunnel(db, {
        subdomain: "tunnel-b",
        principalId: "user2",
        localAddr: "localhost:4000",
        createdBy: "test",
      });

      const { data, total } = await gw.listTunnels(db, {
        principalId: "user1",
      });
      expect(data).toHaveLength(1);
      expect(total).toBe(1);
      expect(data[0].principalId).toBe("user1");
    });
  });
});
