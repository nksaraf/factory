import type {
  ComponentSpec,
  SystemDeployment,
  Workload,
} from "@smp/factory-shared/types"
import { describe, expect, it } from "vitest"

import { generateResources } from "../reconciler/resource-generator"

// K8s resource shape interfaces for typed spec access
interface K8sContainer {
  name: string
  image: string
  ports?: Array<{ name: string; containerPort: number }>
  resources: { limits: { cpu: string; memory: string } }
  livenessProbe?: { httpGet: { path: string; port: number } }
  readinessProbe?: { httpGet: { path: string; port: number } }
}

interface K8sDeploymentSpec {
  replicas: number
  template: { spec: { containers: K8sContainer[] } }
}

// The generator uses v1 flat types from @smp/factory-shared/types.
// These helpers build data matching that shape (flat fields, not nested spec).

function makeWorkload(overrides?: Partial<Workload>): Workload {
  return {
    workloadId: "wkl_test1",
    systemDeploymentId: "dt_test1",
    moduleVersionId: "mv_test1",
    componentId: "cmp_test1",
    artifactId: "art_test1",
    replicas: 2,
    envOverrides: {},
    resourceOverrides: {},
    desiredImage: "registry.dx.dev/api:v1.0.0",
    status: "provisioning",
    driftDetected: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeComponent(overrides?: Partial<ComponentSpec>): ComponentSpec {
  return {
    componentId: "cmp_test1",
    moduleId: "mod_test1",
    name: "api-server",
    slug: "api-server",
    kind: "server",
    entityKind: "Component",
    ports: [{ name: "http", port: 8080, protocol: "http" }],
    healthcheck: { path: "/health", portName: "http", protocol: "http" },
    isPublic: true,
    stateful: false,
    runOrder: null,
    defaultReplicas: 2,
    defaultCpu: "500m",
    defaultMemory: "512Mi",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeTarget(overrides?: Partial<SystemDeployment>): SystemDeployment {
  return {
    systemDeploymentId: "dt_test1",
    name: "staging-01",
    kind: "staging",
    runtime: "kubernetes",
    clusterId: "cls_test1",
    namespace: "staging-01",
    createdBy: "test",
    trigger: "manual",
    tierPolicies: {},
    status: "active",
    labels: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("generateResources", () => {
  it("generates Namespace + Deployment + Service + IngressRoute for public deployment", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget(),
      "my-system"
    )

    expect(resources).toHaveLength(4)
    expect(resources.map((r) => r.kind)).toEqual([
      "Namespace",
      "Deployment",
      "Service",
      "IngressRoute",
    ])
  })

  it("generates only Namespace + Deployment for private worker (no port)", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ ports: [], isPublic: false, healthcheck: null }),
      makeTarget(),
      "my-system"
    )

    expect(resources).toHaveLength(2)
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "Deployment"])
  })

  it("generates Namespace + CronJob for cronjob component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({
        kind: "scheduled",
        ports: [],
        healthcheck: null,
        isPublic: false,
      }),
      makeTarget(),
      "my-system"
    )

    expect(resources).toHaveLength(2)
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "CronJob"])
  })

  it("generates Namespace + Job for job component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({
        kind: "task",
        ports: [],
        healthcheck: null,
        isPublic: false,
      }),
      makeTarget(),
      "my-system"
    )

    expect(resources).toHaveLength(2)
    expect(resources.map((r) => r.kind)).toEqual(["Namespace", "Job"])
  })

  it("generates Namespace + StatefulSet for stateful component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ stateful: true }),
      makeTarget(),
      "my-system"
    )

    expect(resources).toHaveLength(4)
    expect(resources[1].kind).toBe("StatefulSet")
  })

  it("generates StatefulSet for database component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({ kind: "database" }),
      makeTarget(),
      "my-system"
    )
    expect(resources[1].kind).toBe("StatefulSet")
  })

  it("applies dx.dev labels including module and version", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget(),
      "billing"
    )

    const deployment = resources[1]
    expect(deployment.metadata.labels?.["dx.dev/module"]).toBe("billing")
    expect(deployment.metadata.labels?.["dx.dev/module-version"]).toBe(
      "mv_test1"
    )
    expect(deployment.metadata.labels?.["dx.dev/managed-by"]).toBe(
      "factory-reconciler"
    )
  })

  it("applies resource overrides from workload", () => {
    const resources = generateResources(
      makeWorkload({ resourceOverrides: { cpu: "1000m", memory: "1Gi" } }),
      makeComponent(),
      makeTarget(),
      "my-system"
    )

    const deployment = resources[1]
    const container = (deployment.spec as unknown as K8sDeploymentSpec).template
      .spec.containers[0]
    expect(container.resources.limits.cpu).toBe("1000m")
    expect(container.resources.limits.memory).toBe("1Gi")
  })

  it("sets replicas from workload", () => {
    const resources = generateResources(
      makeWorkload({ replicas: 5 }),
      makeComponent(),
      makeTarget(),
      "my-system"
    )

    const deployment = resources[1]
    expect((deployment.spec as unknown as K8sDeploymentSpec).replicas).toBe(5)
  })

  it("sets health check probe from component", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent({
        healthcheck: { path: "/ready", portName: "http", protocol: "http" },
      }),
      makeTarget(),
      "my-system"
    )

    const deployment = resources[1]
    const container = (deployment.spec as unknown as K8sDeploymentSpec).template
      .spec.containers[0]
    expect(container.livenessProbe!.httpGet.path).toBe("/ready")
    expect(container.readinessProbe!.httpGet.path).toBe("/ready")
  })

  it("uses target namespace for all resources", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget({ namespace: "custom-ns" }),
      "my-system"
    )

    const ns = resources[0]
    expect(ns.metadata.name).toBe("custom-ns")

    for (const r of resources.slice(1)) {
      expect(r.metadata.namespace).toBe("custom-ns")
    }
  })

  it("falls back to target name when namespace is null", () => {
    const resources = generateResources(
      makeWorkload(),
      makeComponent(),
      makeTarget({ namespace: null }),
      "my-system"
    )

    expect(resources[0].metadata.name).toBe("staging-01")
  })
})
