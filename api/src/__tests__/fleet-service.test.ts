import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import { NoopSandboxAdapter } from "../adapters/sandbox-adapter-noop";

import * as fleet from "../modules/fleet/service";
import * as providerSvc from "../services/infra/provider.service";
import * as regionSvc from "../services/infra/region.service";
import * as clusterSvc from "../services/infra/cluster.service";

import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Fleet Service", () => {
  let db: Database;
  let client: PGlite;
  const adapter = new NoopSandboxAdapter();

  // Helper to create infra prereqs for site creation
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

  // --- Releases ---
  describe("releases", () => {
    it("creates and lists releases", async () => {
      const rel = await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });
      expect(rel.version).toBe("1.0.0");
      expect(rel.releaseId).toBeTruthy();

      const { data, total } = await fleet.listReleases(db);
      expect(data).toHaveLength(1);
      expect(total).toBe(1);
    });

    it("gets release by version", async () => {
      await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });

      const release = await fleet.getRelease(db, "1.0.0");
      expect(release).not.toBeNull();
      expect(release!.version).toBe("1.0.0");
      expect(release!.modulePins).toEqual([]);
    });

    it("returns null for nonexistent release", async () => {
      const release = await fleet.getRelease(db, "999.0.0");
      expect(release).toBeNull();
    });

    it("promotes release through state machine", async () => {
      await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });

      const r1 = await fleet.promoteRelease(db, "1.0.0", "staging");
      expect(r1.status).toBe("staging");

      const r2 = await fleet.promoteRelease(db, "1.0.0", "production");
      expect(r2.status).toBe("production");
    });

    it("rejects invalid promotion transitions", async () => {
      await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });

      await expect(
        fleet.promoteRelease(db, "1.0.0", "production")
      ).rejects.toThrow("Invalid promotion");
    });

    it("supersedes previous production release on promote", async () => {
      await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });
      await fleet.promoteRelease(db, "1.0.0", "staging");
      await fleet.promoteRelease(db, "1.0.0", "production");

      await fleet.createRelease(db, {
        version: "2.0.0",
        createdBy: "test",
      });
      await fleet.promoteRelease(db, "2.0.0", "staging");
      await fleet.promoteRelease(db, "2.0.0", "production");

      const old = await fleet.getRelease(db, "1.0.0");
      expect(old!.status).toBe("superseded");
    });

    it("filters releases by status", async () => {
      await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });
      await fleet.createRelease(db, {
        version: "2.0.0",
        createdBy: "test",
      });
      await fleet.promoteRelease(db, "1.0.0", "staging");

      const { data } = await fleet.listReleases(db, { status: "staging" });
      expect(data).toHaveLength(1);
      expect(data[0].version).toBe("1.0.0");
    });
  });

  // --- Sites ---
  describe("sites", () => {
    it("creates and lists sites", async () => {
      const { cluster } = await createInfraPrereqs();
      const site = await fleet.createSite(db, {
        name: "prod-us",
        product: "smp",
        clusterId: cluster.clusterId,
        createdBy: "test",
      });
      expect(site.name).toBe("prod-us");
      expect(site.status).toBe("provisioning");

      const { data } = await fleet.listSites(db);
      expect(data).toHaveLength(1);
    });

    it("gets site by name with deployment target count", async () => {
      const { cluster } = await createInfraPrereqs();
      await fleet.createSite(db, {
        name: "prod-us",
        product: "smp",
        clusterId: cluster.clusterId,
        createdBy: "test",
      });

      const site = await fleet.getSite(db, "prod-us");
      expect(site).not.toBeNull();
      expect(site!.deploymentTargetCount).toBe(0);
    });

    it("decommissions a site", async () => {
      const { cluster } = await createInfraPrereqs();
      await fleet.createSite(db, {
        name: "prod-us",
        product: "smp",
        clusterId: cluster.clusterId,
        createdBy: "test",
      });

      const result = await fleet.deleteSite(db, "prod-us");
      expect(result.status).toBe("decommissioned");
    });

    it("filters sites by product", async () => {
      const { cluster } = await createInfraPrereqs();
      await fleet.createSite(db, {
        name: "site-a",
        product: "smp",
        clusterId: cluster.clusterId,
        createdBy: "test",
      });
      await fleet.createSite(db, {
        name: "site-b",
        product: "other",
        clusterId: cluster.clusterId,
        createdBy: "test",
      });

      const { data } = await fleet.listSites(db, { product: "smp" });
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("site-a");
    });
  });

  // --- Deployment Targets ---
  describe("deployment targets", () => {
    it("creates and lists deployment targets", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: "dt-1",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });
      expect(dt.name).toBe("dt-1");
      expect(dt.kind).toBe("production");

      const { data } = await fleet.listDeploymentTargets(db);
      expect(data).toHaveLength(1);
    });

    it("creates deployment target with TTL", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: "sandbox-1",
        kind: "sandbox",
        createdBy: "test",
        trigger: "manual",
        ttl: "24h",
      });
      expect(dt.expiresAt).not.toBeNull();

      const expected = Date.now() + 24 * 3600 * 1000;
      const actual = new Date(dt.expiresAt!).getTime();
      // Allow 5 second tolerance
      expect(Math.abs(actual - expected)).toBeLessThan(5000);
    });

    it("gets deployment target with workloads", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: "dt-1",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });

      const result = await fleet.getDeploymentTarget(db, dt.deploymentTargetId);
      expect(result).not.toBeNull();
      expect(result!.workloads).toEqual([]);
    });

    it("destroys deployment target", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: "dt-1",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });

      const result = await fleet.destroyDeploymentTarget(
        db,
        dt.deploymentTargetId
      );
      expect(result.status).toBe("destroying");
    });

    it("filters by kind", async () => {
      await fleet.createDeploymentTarget(db, {
        name: "dt-prod",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });
      await fleet.createDeploymentTarget(db, {
        name: "dt-sandbox",
        kind: "sandbox",
        createdBy: "test",
        trigger: "manual",
      });

      const { data } = await fleet.listDeploymentTargets(db, {
        kind: "sandbox",
      });
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("dt-sandbox");
    });
  });

  // --- Sandboxes ---
  describe("sandboxes", () => {
    it("creates sandbox with auto-generated name", async () => {
      const sb = await fleet.createSandbox(db, adapter, {
        createdBy: "test",
      });
      expect(sb.kind).toBe("sandbox");
      expect(sb.name).toMatch(/^sandbox-/);
    });

    it("creates sandbox with custom name", async () => {
      const sb = await fleet.createSandbox(db, adapter, {
        name: "my-sandbox",
        createdBy: "test",
      });
      expect(sb.name).toBe("my-sandbox");
    });

    it("lists sandboxes excluding destroyed by default", async () => {
      const sb = await fleet.createSandbox(db, adapter, {
        createdBy: "test",
      });
      await fleet.destroySandbox(db, adapter, sb.deploymentTargetId);

      const { data: active } = await fleet.listSandboxes(db);
      expect(active).toHaveLength(0);

      const { data: all } = await fleet.listSandboxes(db, { all: true });
      expect(all).toHaveLength(1);
    });

    it("applies default TTL based on trigger", async () => {
      const sb = await fleet.createSandbox(db, adapter, {
        createdBy: "test",
        trigger: "pr",
      });
      // PR default is 48h
      expect(sb.expiresAt).not.toBeNull();
      const expected = Date.now() + 48 * 3600 * 1000;
      const actual = new Date(sb.expiresAt!).getTime();
      expect(Math.abs(actual - expected)).toBeLessThan(5000);
    });
  });

  // --- Rollouts ---
  describe("rollouts", () => {
    it("creates and lists rollouts", async () => {
      const rel = await fleet.createRelease(db, {
        version: "1.0.0",
        createdBy: "test",
      });
      await fleet.promoteRelease(db, "1.0.0", "staging");

      const dt = await fleet.createDeploymentTarget(db, {
        name: "dt-1",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });

      const ro = await fleet.createRollout(db, {
        releaseId: rel.releaseId,
        deploymentTargetId: dt.deploymentTargetId,
      });
      expect(ro.rolloutId).toBeTruthy();

      const { data } = await fleet.listRollouts(db);
      expect(data).toHaveLength(1);
    });
  });

  // --- Interventions ---
  describe("interventions", () => {
    it("creates and lists interventions", async () => {
      const dt = await fleet.createDeploymentTarget(db, {
        name: "dt-1",
        kind: "production",
        createdBy: "test",
        trigger: "release",
      });

      const iv = await fleet.createIntervention(db, {
        deploymentTargetId: dt.deploymentTargetId,
        action: "restart",
        reason: "Testing restart",
        principalId: "test-user",
      });
      expect(iv).toBeTruthy();

      const { data } = await fleet.listInterventions(
        db,
        dt.deploymentTargetId
      );
      expect(data).toHaveLength(1);
      expect(data[0].action).toBe("restart");
    });
  });
});
