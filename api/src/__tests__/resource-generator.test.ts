import { describe, expect, it } from "vitest";
import { generateResources } from "../reconciler/resource-generator";
import type {
  ComponentSpec,
  Workload,
  DeploymentTarget,
} from "@smp/factory-shared/types";

function makeWorkload(overrides?: Partial<Workload>): Workload {
  return {
    workloadId: "wl_test1",
    deploymentTargetId: "dt_test1",
    moduleVersionId: "mv_test1",
    componentId: "cmp_test1",
    artifactId: "art_test1",
    replicas: 2,
    envOverrides: {},
    resourceOverrides: {},
    status: "provisioning",
    desiredImage: "registry.dx.dev/api:v1.0.0",
    desiredArtifactUri: null,
    actualImage: null,
    driftDetected: false,
    lastReconciledAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeComponent(overrides?: Partial<ComponentSpec>): ComponentSpec {
  return {
    componentId: "cmp_test1",
    moduleId: "mod_test1",
    name: "api-server",
    slug: "api-server",
    kind: "server",
    ports: [{ name: "http", port: 8080, protocol: "http" }],
    healthcheck: { path: "/health", portName: "http", protocol: "http" },
    isPublic: true,
    stateful: false,
    runOrder: null,
    defaultReplicas: 2,
    defaultCpu: "500m",
    defaultMemory: "512Mi",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTarget(overrides?: Partial<DeploymentTarget>): DeploymentTarget {
  return {
    deploymentTargetId: "dt_test1",
    name: "staging-01",
    kind: "staging",
    runtime: "kubernetes",
    siteId: null,
    clusterId: "cls_test1",
    hostId: null,
    vmId: null,
    namespace: "staging-01",
    createdBy: "user1",
    trigger: "manual",
    ttl: null,
    expiresAt: null,
    tierPolicies: {},
    status: "active",
    labels: {},
    createdAt: "2024-01-01T00:00:00Z",
    destroyedAt: null,
    ...overrides,
  };
}

describe("generateResources", () => {
  it("generates Namespace + Deployment + Service + IngressRoute for public deployment", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget(),
      "my-module"
    );

    expect(resources).toHaveLength(4);
    expect(resources.map((r) => r.kind)).toEqual([
      "Namespace",
      "Deployment",
      "Service",
      "IngressRoute",
    ]);
  });

  it("generates only Namespace + Deployment for private worker (no port)", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ ports: [], isPublic: false, healthcheck: null }),
      makeTarget(),
      "my-module"
    );

    expect(resources).toHaveLength(2);
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "Deployment"]);
  });

  it("generates Namespace + CronJob for cronjob component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ kind: "scheduled", ports: [], healthcheck: null, isPublic: false }),
      makeTarget(),
      "my-module"
    );

    expect(resources).toHaveLength(2);
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "CronJob"]);
  });

  it("generates Namespace + Job for job component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ kind: "task", ports: [], healthcheck: null, isPublic: false }),
      makeTarget(),
      "my-module"
    );

    expect(resources).toHaveLength(2);
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "Job"]);
  });

  it("generates Namespace + StatefulSet for statefulset component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ kind: "server", stateful: true }),
      makeTarget(),
      "my-module"
    );

    expect(resources).toHaveLength(4);
    expect(resources[1].kind).toBe("StatefulSet");
  });

  it("generates StatefulSet for database component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ kind: "database" }),
      makeTarget(),
      "my-module"
    );
    expect(resources[1].kind).toBe("StatefulSet");
  });

  it("applies dx.dev labels including module-version", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget(),
      "billing"
    );

    const deployment = resources[1];
    expect(deployment.metadata.labels?.["dx.dev/module"]).toBe("billing");
    expect(deployment.metadata.labels?.["dx.dev/module-version"]).toBe(
      "mv_test1"
    );
    expect(deployment.metadata.labels?.["dx.dev/managed-by"]).toBe(
      "factory-reconciler"
    );
  });

  it("applies resource overrides from workload", () => {
    const resources = generateResources(
      makeWorkload({ resourceOverrides: { cpu: "1000m", memory: "1Gi" } }),
      makeComponent(),
      makeTarget(),
      "my-module"
    );

    const deployment = resources[1];
    const container = (deployment.spec as any).template.spec.containers[0];
    expect(container.resources.limits.cpu).toBe("1000m");
    expect(container.resources.limits.memory).toBe("1Gi");
  });

  it("sets replicas from workload", () => {
    const resources = generateResources(
      makeWorkload({ replicas: 5 }),
      makeComponent(),
      makeTarget(),
      "my-module"
    );

    const deployment = resources[1];
    expect((deployment.spec as any).replicas).toBe(5);
  });

  it("sets health check probe from component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ healthcheck: { path: "/ready", portName: "http", protocol: "http" } }),
      makeTarget(),
      "my-module"
    );

    const deployment = resources[1];
    const container = (deployment.spec as any).template.spec.containers[0];
    expect(container.livenessProbe.httpGet.path).toBe("/ready");
    expect(container.readinessProbe.httpGet.path).toBe("/ready");
  });

  it("uses target namespace for all resources", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget({ namespace: "custom-ns" }),
      "my-module"
    );

    const ns = resources[0];
    expect(ns.metadata.name).toBe("custom-ns");

    for (const r of resources.slice(1)) {
      expect(r.metadata.namespace).toBe("custom-ns");
    }
  });

  it("falls back to target name when namespace is null", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget({ namespace: null }),
      "my-module"
    );

    expect(resources[0].metadata.name).toBe("staging-01");
  });
});
