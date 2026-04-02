import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import { Reconciler } from "../reconciler/reconciler";
import { generateSandboxResources } from "../reconciler/sandbox-resource-generator";
import type { KubeClient, KubeResource } from "../lib/kube-client";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";
import { provider, cluster } from "../db/schema/infra";
import { productModule, componentSpec } from "../db/schema/product";
import { moduleVersion, artifact } from "../db/schema/build";
import { deploymentTarget, workload } from "../db/schema/fleet";
import { eq } from "drizzle-orm";

class MockKubeClient implements KubeClient {
  applied: KubeResource[] = [];
  deploymentImages: Record<string, string> = {};

  async apply(_kc: string, resource: KubeResource) {
    this.applied.push(resource);
  }
  async getDeploymentImage(
    _kc: string,
    _ns: string,
    name: string
  ): Promise<string | null> {
    return this.deploymentImages[name] ?? null;
  }
  async evacuateNode() {}
  async pauseNode() {}
  async resumeNode() {}
  async get() {
    return null;
  }
  async list() {
    return [];
  }
  async remove() {}
  async execInPod() {
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("Reconciler", () => {
  let db: Database;
  let client: PGlite;
  let mockKube: MockKubeClient;

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
    mockKube = new MockKubeClient();
  });

  async function seedWorkload(opts?: {
    componentKind?: string;
    componentStateful?: boolean;
    desiredImage?: string;
    workloadStatus?: string;
    runtime?: string;
  }) {
    const kind = opts?.componentKind ?? "server";
    const stateful = opts?.componentStateful ?? false;
    const desiredImage =
      opts?.desiredImage ?? "registry.dx.dev/api:v1.0.0";
    const workloadStatus = opts?.workloadStatus ?? "provisioning";
    const runtime = opts?.runtime ?? "kubernetes";

    const [prov] = await db
      .insert(provider)
      .values({ name: "prov", slug: "prov", providerType: "proxmox" })
      .returning();

    // Only create cluster if runtime is kubernetes
    let clsId: string | null = null;
    if (runtime === "kubernetes") {
      const [cls] = await db
        .insert(cluster)
        .values({
          name: "test-cluster",
          slug: "test-cluster",
          providerId: prov.providerId,
          kubeconfigRef: "fake-kubeconfig-yaml",
          status: "ready",
        })
        .returning();
      clsId = cls.clusterId;
    }

    const [mod] = await db
      .insert(productModule)
      .values({ name: "billing", slug: "billing", team: "platform" })
      .returning();
    const [comp] = await db
      .insert(componentSpec)
      .values({
        moduleId: mod.moduleId,
        name: "api-server",
        slug: "api-server",
        kind,
        stateful,
        ports: [{ name: "http", port: 8080, protocol: "http" }],
        healthcheck: { path: "/health", portName: "http", protocol: "http" },
        isPublic: true,
        defaultReplicas: 2,
        defaultCpu: "500m",
        defaultMemory: "512Mi",
      })
      .returning();
    const [mv] = await db
      .insert(moduleVersion)
      .values({ moduleId: mod.moduleId, version: "1.0.0" })
      .returning();
    const [art] = await db
      .insert(artifact)
      .values({
        imageRef: desiredImage,
        imageDigest: "sha256:abc123",
        builtAt: new Date(),
      })
      .returning();
    const [dt] = await db
      .insert(deploymentTarget)
      .values({
        name: "staging-01",
        slug: "staging-01",
        kind: "staging",
        runtime,
        clusterId: clsId,
        namespace: clsId ? "staging-01" : null,
        createdBy: "test",
        trigger: "manual",
        status: "active",
      })
      .returning();
    const [wl] = await db
      .insert(workload)
      .values({
        deploymentTargetId: dt.deploymentTargetId,
        moduleVersionId: mv.moduleVersionId,
        componentId: comp.componentId,
        artifactId: art.artifactId,
        replicas: 2,
        desiredImage,
        status: workloadStatus,
      })
      .returning();

    return { prov, mod, comp, mv, art, dt, wl };
  }

  it("reconciles a workload and applies Kube resources", async () => {
    const { wl } = await seedWorkload();
    const reconciler = new Reconciler(db, mockKube);

    await reconciler.reconcileWorkload(wl.workloadId);

    // Should have applied Namespace + Deployment + Service + IngressRoute
    expect(mockKube.applied.length).toBeGreaterThanOrEqual(3);
    expect(mockKube.applied.map((r) => r.kind)).toContain("Deployment");
    expect(mockKube.applied.map((r) => r.kind)).toContain("Namespace");

    // Check workload status updated
    const updated = await db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, wl.workloadId));
    expect(updated[0].status).toBe("running");
    expect(updated[0].lastReconciledAt).toBeTruthy();
  });

  it("sets job workloads to completed", async () => {
    const { wl } = await seedWorkload({ componentKind: "task" });
    const reconciler = new Reconciler(db, mockKube);

    await reconciler.reconcileWorkload(wl.workloadId);

    const updated = await db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, wl.workloadId));
    expect(updated[0].status).toBe("completed");
  });

  it("detects drift when actual image differs", async () => {
    const { wl, comp } = await seedWorkload({
      desiredImage: "registry.dx.dev/api:v1.0.0",
    });

    // Mock returns a different image
    mockKube.deploymentImages[comp.name] = "registry.dx.dev/api:v0.9.0";

    const reconciler = new Reconciler(db, mockKube);
    await reconciler.reconcileWorkload(wl.workloadId);

    const updated = await db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, wl.workloadId));
    expect(updated[0].driftDetected).toBe(true);
    expect(updated[0].actualImage).toBe("registry.dx.dev/api:v0.9.0");
  });

  it("reconcileAll processes active workloads and skips stopped", async () => {
    await seedWorkload({ workloadStatus: "provisioning" });

    const reconciler = new Reconciler(db, mockKube);
    const result = await reconciler.reconcileAll();

    expect(result.reconciled).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("detectDrift returns drifted workloads", async () => {
    const { wl, comp } = await seedWorkload();
    mockKube.deploymentImages[comp.name] = "old-image:v0.1";

    const reconciler = new Reconciler(db, mockKube);
    await reconciler.reconcileWorkload(wl.workloadId);

    const drifted = await reconciler.detectDrift();
    expect(drifted).toHaveLength(1);
    expect(drifted[0].workloadId).toBe(wl.workloadId);
  });

  it("creates StatefulSet for stateful server component", async () => {
    const { wl } = await seedWorkload({
      componentKind: "server",
      componentStateful: true,
    });
    const reconciler = new Reconciler(db, mockKube);

    await reconciler.reconcileWorkload(wl.workloadId);

    expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet");
    expect(mockKube.applied.map((r) => r.kind)).not.toContain("Deployment");
  });

  it("creates StatefulSet for database component", async () => {
    const { wl } = await seedWorkload({ componentKind: "database" });
    const reconciler = new Reconciler(db, mockKube);

    await reconciler.reconcileWorkload(wl.workloadId);

    expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet");
  });

  it("dispatches compose runtime without touching K8s", async () => {
    const { wl } = await seedWorkload({ runtime: "compose" });
    const reconciler = new Reconciler(db, mockKube);

    await reconciler.reconcileWorkload(wl.workloadId);

    // Compose stub doesn't apply any K8s resources
    expect(mockKube.applied).toHaveLength(0);

    // Workload status is updated to running
    const updated = await db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, wl.workloadId));
    expect(updated[0].status).toBe("running");
  });
});

describe("generateSandboxResources", () => {
  const baseSandbox = {
    sandboxId: "sbx_test123",
    slug: "my-sandbox",
    devcontainerImage: null,
    devcontainerConfig: {},
    repos: [],
    cpu: "2000m",
    memory: "4Gi",
    storageGb: 10,
    dockerCacheGb: 20,
  };

  it("generates resources with 3 container ports (ssh, web-terminal, web-ide)", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod");
    expect(pod).toBeTruthy();

    const containers = (pod!.spec as any).containers;
    const workspace = containers.find((c: any) => c.name === "workspace");
    expect(workspace.ports).toHaveLength(3);
    expect(workspace.ports.map((p: any) => p.name)).toEqual(["ssh", "web-terminal", "web-ide"]);
    expect(workspace.ports.map((p: any) => p.containerPort)).toEqual([22, 8080, 8081]);
  });

  it("generates Service with 3 port mappings", () => {
    const resources = generateSandboxResources(baseSandbox);
    const svc = resources.find((r) => r.kind === "Service");
    expect(svc).toBeTruthy();

    const ports = (svc!.spec as any).ports;
    expect(ports).toHaveLength(3);
    expect(ports.map((p: any) => p.name)).toEqual(["ssh", "web-terminal", "web-ide"]);
    expect(ports.map((p: any) => p.targetPort)).toEqual([22, 8080, 8081]);
  });

  it("generates IngressRoute with 2 route rules (terminal + IDE)", () => {
    const resources = generateSandboxResources(baseSandbox);
    const ingress = resources.find((r) => r.kind === "IngressRoute");
    expect(ingress).toBeTruthy();

    const routes = (ingress!.spec as any).routes;
    expect(routes).toHaveLength(2);
    expect(routes[0].match).toContain("my-sandbox.sandbox.dx.dev");
    expect(routes[0].services[0].port).toBe(8080);
    expect(routes[1].match).toContain("my-sandbox--ide.sandbox.dx.dev");
    expect(routes[1].services[0].port).toBe(8081);
  });

  it("uses dx-entrypoint.sh instead of sleep infinity in direct-image mode", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod");
    const workspace = (pod!.spec as any).containers.find((c: any) => c.name === "workspace");
    expect(workspace.command).toBeTruthy();
    const cmd = Array.isArray(workspace.command) ? workspace.command.join(" ") : workspace.command;
    expect(cmd).toContain("dx-entrypoint.sh");
    expect(cmd).toContain("sleep infinity"); // fallback for custom images
  });

  it("uses dx-entrypoint.sh in envbuilder init script", () => {
    const sandboxWithRepo = {
      ...baseSandbox,
      repos: [{ url: "https://github.com/user/repo", branch: "main" }],
    };
    const resources = generateSandboxResources(sandboxWithRepo);
    const pod = resources.find((r) => r.kind === "Pod");
    const workspace = (pod!.spec as any).containers.find((c: any) => c.name === "workspace");
    const initScriptEnv = workspace.env.find((e: any) => e.name === "ENVBUILDER_INIT_SCRIPT");
    expect(initScriptEnv).toBeTruthy();
    expect(initScriptEnv.value).toContain("dx-entrypoint.sh");
    expect(initScriptEnv.value).toContain("sleep infinity"); // fallback
  });

  it("uses dx-sandbox as default fallback image", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod");
    const workspace = (pod!.spec as any).containers.find((c: any) => c.name === "workspace");
    expect(workspace.image).toContain("dx-sandbox");
  });
});
