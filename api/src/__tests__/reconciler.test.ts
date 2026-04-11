import type { PGlite } from "@electric-sql/pglite"
import type { ComponentDeploymentSpec } from "@smp/factory-shared/schemas/ops"
import type { ComponentSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Database } from "../db/connection"
import { systemVersion } from "../db/schema/build-v2"
import { estate, realm } from "../db/schema/infra-v2"
import { componentDeployment, site, systemDeployment } from "../db/schema/ops"
import { component, system } from "../db/schema/software-v2"
import type { KubeClient, KubeResource } from "../lib/kube-client"
import { Reconciler } from "../reconciler/reconciler"
import { generateWorkbenchResources } from "../reconciler/sandbox-resource-generator"
import { createTestContext, truncateAllTables } from "../test-helpers"

// K8s resource shape interfaces for typed spec access
interface K8sEnvVar {
  name: string
  value: string
}
interface K8sPort {
  name: string
  containerPort: number
}
interface K8sContainer {
  name: string
  image: string
  command?: string[]
  env: K8sEnvVar[]
  ports: K8sPort[]
  resources?: { limits: { cpu: string; memory: string } }
}
interface K8sPodSpec {
  containers: K8sContainer[]
  initContainers?: Array<{ name: string; command: string[] }>
}
interface K8sPvcSpec {
  resources: { requests: { storage: string } }
}
interface K8sIngressRoute {
  match: string
  services: Array<{ port: number }>
}
interface K8sIngressRouteSpec {
  routes: K8sIngressRoute[]
}
interface K8sServiceSpec {
  ports: Array<{ name: string; targetPort: number }>
}

class MockKubeClient implements KubeClient {
  applied: KubeResource[] = []
  deploymentImages: Record<string, string> = {}

  async apply(_kc: string, resource: KubeResource) {
    this.applied.push(resource)
  }
  async getDeploymentImage(
    _kc: string,
    _ns: string,
    name: string
  ): Promise<string | null> {
    return this.deploymentImages[name] ?? null
  }
  async evacuateNode() {}
  async pauseNode() {}
  async resumeNode() {}
  async get() {
    return null
  }
  async list() {
    return []
  }
  async remove() {}
  async execInPod() {
    return { exitCode: 0, stdout: "", stderr: "" }
  }
}

describe("Reconciler", () => {
  let db: Database
  let client: PGlite
  let mockKube: MockKubeClient

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
    mockKube = new MockKubeClient()
  })

  async function seedComponentDeployment(opts?: {
    componentKind?: string
    componentStateful?: boolean
    desiredImage?: string
    deploymentStatus?: string
    runtimeMode?: string
  }) {
    const kind = opts?.componentKind ?? "server"
    const stateful = opts?.componentStateful ?? false
    const desiredImage = opts?.desiredImage ?? "registry.dx.dev/api:v1.0.0"
    const deploymentStatus = opts?.deploymentStatus ?? "provisioning"
    const runtimeMode = opts?.runtimeMode ?? "kubernetes"

    const [sub] = await db
      .insert(estate)
      .values({
        name: "prov",
        slug: "prov",
        type: "hypervisor",
        spec: { lifecycle: "active", syncStatus: "idle", metadata: {} },
      })
      .returning()

    // Only create realm if runtimeMode is kubernetes
    let rtId: string | null = null
    if (runtimeMode === "kubernetes") {
      const [rt] = await db
        .insert(realm)
        .values({
          name: "test-realm",
          slug: "test-realm",
          type: "k8s-cluster",
          spec: {
            kubeconfigRef: "fake-kubeconfig-yaml",
            status: "ready",
          },
        })
        .returning()
      rtId = rt.id
    }

    const [sys] = await db
      .insert(system)
      .values({
        name: "billing",
        slug: "billing",
        spec: { namespace: "default", lifecycle: "production", tags: [] },
      })
      .returning()
    // Map legacy kind names to valid v2 component type values
    const componentType = kind === "server" ? "service" : kind
    const [comp] = await db
      .insert(component)
      .values({
        systemId: sys.id,
        name: "api-server",
        slug: "api-server",
        type: componentType,
        spec: {
          stateful,
          ports: [{ name: "http", port: 8080, protocol: "http" as const }],
          healthcheck: {
            path: "/health",
            port: 8080,
            intervalSeconds: 30,
            timeoutSeconds: 5,
            failureThreshold: 3,
          },
          defaultReplicas: 2,
          defaultCpu: "500m",
          defaultMemory: "512Mi",
        } as ComponentSpec,
      })
      .returning()
    const [sv] = await db
      .insert(systemVersion)
      .values({ systemId: sys.id, version: "1.0.0", spec: {} })
      .returning()
    const [siteRow] = await db
      .insert(site)
      .values({
        name: "test-site",
        slug: "test-site",
        spec: { type: "shared", status: "active" },
      })
      .returning()
    const [sd] = await db
      .insert(systemDeployment)
      .values({
        name: "staging-01",
        slug: "staging-01",
        type: "staging",
        systemId: sys.id,
        siteId: siteRow.id,
        realmId: rtId,
        spec: {
          runtime: runtimeMode as
            | "kubernetes"
            | "compose"
            | "systemd"
            | "windows_service"
            | "iis"
            | "process",
          namespace: rtId ? "staging-01" : undefined,
          createdBy: "test",
          trigger: "manual" as const,
          status: "active" as const,
          deploymentStrategy: "rolling" as const,
          labels: {},
        },
      })
      .returning()
    const [cd] = await db
      .insert(componentDeployment)
      .values({
        systemDeploymentId: sd.id,
        componentId: comp.id,
        spec: {
          replicas: 2,
          desiredImage,
          status: deploymentStatus as ComponentDeploymentSpec["status"],
          driftDetected: false,
          envOverrides: {},
          resourceOverrides: {},
        },
      })
      .returning()

    return { sub, sys, comp, sv, sd, cd }
  }

  it("reconciles a component deployment and applies Kube resources", async () => {
    const { cd } = await seedComponentDeployment()
    const reconciler = new Reconciler(db, mockKube)

    await reconciler.reconcileWorkload(cd.id)

    // Should have applied Namespace + Deployment + Service + IngressRoute
    expect(mockKube.applied.length).toBeGreaterThanOrEqual(3)
    expect(mockKube.applied.map((r) => r.kind)).toContain("Deployment")
    expect(mockKube.applied.map((r) => r.kind)).toContain("Namespace")

    // Check component deployment status updated
    const updated = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, cd.id))
    expect((updated[0].spec as ComponentDeploymentSpec).status).toBe("running")
    expect(updated[0].updatedAt).toBeTruthy()
  })

  it("sets task component deployments to completed", async () => {
    const { cd } = await seedComponentDeployment({ componentKind: "task" })
    const reconciler = new Reconciler(db, mockKube)

    await reconciler.reconcileWorkload(cd.id)

    const updated = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, cd.id))
    expect((updated[0].spec as ComponentDeploymentSpec).status).toBe(
      "completed"
    )
  })

  it("detects drift when actual image differs", async () => {
    const { cd, comp } = await seedComponentDeployment({
      desiredImage: "registry.dx.dev/api:v1.0.0",
    })

    // Mock returns a different image
    mockKube.deploymentImages[comp.name] = "registry.dx.dev/api:v0.9.0"

    const reconciler = new Reconciler(db, mockKube)
    await reconciler.reconcileWorkload(cd.id)

    const updated = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, cd.id))
    expect((updated[0].spec as ComponentDeploymentSpec).driftDetected).toBe(
      true
    )
    expect((updated[0].spec as ComponentDeploymentSpec).actualImage).toBe(
      "registry.dx.dev/api:v0.9.0"
    )
  })

  it("reconcileAll processes active component deployments and skips stopped", async () => {
    await seedComponentDeployment({ deploymentStatus: "provisioning" })

    const reconciler = new Reconciler(db, mockKube)
    const result = await reconciler.reconcileAll()

    expect(result.reconciled).toBe(1)
    expect(result.errors).toBe(0)
  })

  it("detectDrift returns drifted component deployments", async () => {
    const { cd, comp } = await seedComponentDeployment()
    mockKube.deploymentImages[comp.name] = "old-image:v0.1"

    const reconciler = new Reconciler(db, mockKube)
    await reconciler.reconcileWorkload(cd.id)

    const drifted = await reconciler.detectDrift()
    expect(drifted).toHaveLength(1)
    expect(drifted[0].workloadId).toBe(cd.id)
  })

  it("creates StatefulSet for stateful server component", async () => {
    const { cd } = await seedComponentDeployment({
      componentKind: "server",
      componentStateful: true,
    })
    const reconciler = new Reconciler(db, mockKube)

    await reconciler.reconcileWorkload(cd.id)

    expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet")
    expect(mockKube.applied.map((r) => r.kind)).not.toContain("Deployment")
  })

  it("creates StatefulSet for database component", async () => {
    const { cd } = await seedComponentDeployment({ componentKind: "database" })
    const reconciler = new Reconciler(db, mockKube)

    await reconciler.reconcileWorkload(cd.id)

    expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet")
  })

  it("dispatches compose runtime without touching K8s", async () => {
    const { cd } = await seedComponentDeployment({ runtimeMode: "compose" })
    const reconciler = new Reconciler(db, mockKube)

    await reconciler.reconcileWorkload(cd.id)

    // Compose stub doesn't apply any K8s resources
    expect(mockKube.applied).toHaveLength(0)

    // Component deployment status is updated to running
    const updated = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, cd.id))
    expect((updated[0].spec as ComponentDeploymentSpec).status).toBe("running")
  })
})

describe("generateWorkbenchResources", () => {
  const baseWorkbench = {
    id: "wkbn_test123",
    slug: "my-workbench",
    spec: {
      devcontainerImage: null,
      devcontainerConfig: {},
      repos: [],
      cpu: "2000m",
      memory: "4Gi",
      storageGb: 10,
      dockerCacheGb: 20,
    },
  }

  it("generates resources with 3 container ports (ssh, web-terminal, web-ide)", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")
    expect(pod).toBeTruthy()

    const containers = (pod!.spec as unknown as K8sPodSpec).containers
    const workbench = containers.find((c) => c.name === "workbench")!
    expect(workbench.ports).toHaveLength(3)
    expect(workbench.ports.map((p) => p.name)).toEqual([
      "ssh",
      "web-terminal",
      "web-ide",
    ])
    expect(workbench.ports.map((p) => p.containerPort)).toEqual([
      22, 8080, 8081,
    ])
  })

  it("generates Service with 3 port mappings", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const svc = resources.find((r) => r.kind === "Service")
    expect(svc).toBeTruthy()

    const ports = (svc!.spec as unknown as K8sServiceSpec).ports
    expect(ports).toHaveLength(3)
    expect(ports.map((p) => p.name)).toEqual(["ssh", "web-terminal", "web-ide"])
    expect(ports.map((p) => p.targetPort)).toEqual([22, 8080, 8081])
  })

  it("generates IngressRoute with 3 route rules (primary + terminal + IDE)", () => {
    process.env.WORKBENCH_INGRESS_ENABLED = "true"
    const resources = generateWorkbenchResources(baseWorkbench)
    delete process.env.WORKBENCH_INGRESS_ENABLED
    const ingress = resources.find((r) => r.kind === "IngressRoute")
    expect(ingress).toBeTruthy()

    const routes = (ingress!.spec as unknown as K8sIngressRouteSpec).routes
    expect(routes).toHaveLength(3)
    // Primary (defaults to IDE port 8081)
    expect(routes[0].match).toContain("my-workbench.workbench.dx.dev")
    expect(routes[0].services[0].port).toBe(8081)
    // Terminal sub-route
    expect(routes[1].match).toContain("my-workbench--terminal.workbench.dx.dev")
    expect(routes[1].services[0].port).toBe(8080)
    // IDE sub-route
    expect(routes[2].match).toContain("my-workbench--ide.workbench.dx.dev")
    expect(routes[2].services[0].port).toBe(8081)
  })

  it("uses dx-entrypoint.sh instead of sleep infinity in direct-image mode", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")
    const workbench = (pod!.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    expect(workbench.command).toBeTruthy()
    const cmd = Array.isArray(workbench.command)
      ? workbench.command.join(" ")
      : workbench.command
    expect(cmd).toContain("dx-entrypoint.sh")
    expect(cmd).toContain("sleep infinity") // fallback for custom images
  })

  it("uses dx-entrypoint.sh in envbuilder init script", () => {
    const workbenchWithRepo = {
      ...baseWorkbench,
      spec: {
        ...baseWorkbench.spec,
        repos: [{ url: "https://github.com/user/repo", branch: "main" }],
      },
    }
    const resources = generateWorkbenchResources(workbenchWithRepo)
    const pod = resources.find((r) => r.kind === "Pod")
    const workbench = (pod!.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    const initScriptEnv = workbench.env.find(
      (e) => e.name === "ENVBUILDER_INIT_SCRIPT"
    )
    expect(initScriptEnv).toBeTruthy()
    expect(initScriptEnv!.value).toContain("dx-entrypoint.sh")
    expect(initScriptEnv!.value).toContain("sleep infinity") // fallback
  })

  it("uses dx-sandbox as default fallback image", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")
    const workbench = (pod!.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    expect(workbench.image).toBe(
      process.env.WORKBENCH_DEFAULT_IMAGE || "ghcr.io/nksaraf/dx-sandbox:latest"
    )
  })
})
