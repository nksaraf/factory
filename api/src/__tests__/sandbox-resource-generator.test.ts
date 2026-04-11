import { describe, expect, it } from "vitest"

import { generateWorkbenchResources } from "../reconciler/sandbox-resource-generator"

// K8s resource shape interfaces for typed spec access
interface K8sEnvVar {
  name: string
  value: string
}
interface K8sPort {
  name: string
  containerPort: number
}
interface K8sVolumeMount {
  name: string
  mountPath: string
}
interface K8sContainer {
  name: string
  image: string
  command?: string[]
  env: K8sEnvVar[]
  ports: K8sPort[]
  resources?: { limits: { cpu: string; memory: string } }
  securityContext?: { privileged: boolean }
  volumeMounts: K8sVolumeMount[]
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

describe("Workbench Resource Generator", () => {
  const baseWorkbench = {
    id: "wkbn_test123",
    slug: "my-workbench",
    spec: {
      devcontainerImage: "node:20",
      devcontainerConfig: {
        containerEnv: { NODE_ENV: "development" },
      } as Record<string, unknown>,
      repos: [
        {
          url: "https://github.com/test/repo",
          branch: "main",
          clonePath: "repo",
        },
      ],
      cpu: "2000m",
      memory: "4Gi",
      storageGb: 20,
      dockerCacheGb: 30,
    },
  }

  it("generates 5 resources (no IngressRoute by default)", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    expect(resources).toHaveLength(5)
    expect(resources.map((r) => r.kind)).toEqual([
      "Namespace",
      "PersistentVolumeClaim",
      "PersistentVolumeClaim",
      "Pod",
      "Service",
    ])
  })

  it("generates 6 resources with IngressRoute when WORKBENCH_INGRESS_ENABLED", () => {
    const orig = process.env.WORKBENCH_INGRESS_ENABLED
    process.env.WORKBENCH_INGRESS_ENABLED = "true"
    try {
      const resources = generateWorkbenchResources(baseWorkbench)
      expect(resources).toHaveLength(6)
      expect(resources.map((r) => r.kind)).toContain("IngressRoute")
    } finally {
      if (orig === undefined) delete process.env.WORKBENCH_INGRESS_ENABLED
      else process.env.WORKBENCH_INGRESS_ENABLED = orig
    }
  })

  it("uses envbuilder when repos are present", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")!
    const spec = pod.spec as unknown as K8sPodSpec
    const workbench = spec.containers.find((c) => c.name === "workbench")!

    // Envbuilder mode: image is the envbuilder image, not the devcontainerImage
    expect(workbench.image).toBe("ghcr.io/coder/envbuilder:latest")

    // Envbuilder sets ENVBUILDER_GIT_URL for the primary repo
    const envMap = Object.fromEntries(
      workbench.env.map((e) => [e.name, e.value])
    )
    expect(envMap.ENVBUILDER_GIT_URL).toBe("https://github.com/test/repo")
    expect(envMap.ENVBUILDER_FALLBACK_IMAGE).toBe("node:20")
  })

  it("envbuilder mode has no init containers for single repo", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")!
    const spec = pod.spec as unknown as K8sPodSpec
    // Single repo is handled by envbuilder, no init containers needed
    expect(spec.initContainers).toBeUndefined()
  })

  it("envbuilder mode adds clone-extra-repos init container for additional repos", () => {
    const multiRepo = {
      ...baseWorkbench,
      spec: {
        ...baseWorkbench.spec,
        repos: [
          { url: "https://github.com/test/primary", branch: "main" },
          {
            url: "https://github.com/test/secondary",
            branch: "dev",
            clonePath: "extra",
          },
        ],
      },
    }
    const resources = generateWorkbenchResources(multiRepo)
    const pod = resources.find((r) => r.kind === "Pod")!
    const spec = pod.spec as unknown as K8sPodSpec
    expect(spec.initContainers).toHaveLength(1)
    expect(spec.initContainers![0].name).toBe("clone-extra-repos")

    const script = spec.initContainers![0].command[2] as string
    expect(script).toContain("https://github.com/test/secondary")
    expect(script).toContain("/workspaces/extra")
    // Primary repo is NOT in the init container — envbuilder handles it
    expect(script).not.toContain("primary")
  })

  it("Pod has 2 containers (workbench + dind)", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")!
    const spec = pod.spec as unknown as K8sPodSpec

    expect(spec.containers).toHaveLength(2)
    const names = spec.containers.map((c) => c.name)
    expect(names).toContain("workbench")
    expect(names).toContain("dind")
  })

  it("workbench container has correct limits, env (DOCKER_HOST), and ports 22+8080+8081", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")!
    const workbench = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!

    expect(workbench.resources!.limits.cpu).toBe("2000m")
    expect(workbench.resources!.limits.memory).toBe("4Gi")

    const envMap = Object.fromEntries(
      workbench.env.map((e) => [e.name, e.value])
    )
    expect(envMap.DOCKER_HOST).toBe("tcp://localhost:2375")
    expect(envMap.NODE_ENV).toBe("development")

    const ports = workbench.ports.map((p) => p.containerPort)
    expect(ports).toContain(22)
    expect(ports).toContain(8080)
    expect(ports).toContain(8081)
  })

  it("DinD sidecar mounts docker PVC at /var/lib/docker", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pod = resources.find((r) => r.kind === "Pod")!
    const dind = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "dind"
    )!

    expect(dind.image).toBe("docker:dind")
    expect(dind.securityContext!.privileged).toBe(true)

    const mount = dind.volumeMounts.find(
      (vm) => vm.mountPath === "/var/lib/docker"
    )
    expect(mount).toBeTruthy()
    expect(mount!.name).toBe("docker-storage")
  })

  it("workbench PVC size matches storageGb, docker PVC size matches dockerCacheGb", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    const pvcs = resources.filter((r) => r.kind === "PersistentVolumeClaim")
    expect(pvcs).toHaveLength(2)

    const workbenchPvc = pvcs.find((p) =>
      p.metadata.name!.includes("workbench")
    )!
    const dockerPvc = pvcs.find((p) => p.metadata.name!.includes("docker"))!

    expect(
      (workbenchPvc.spec as unknown as K8sPvcSpec).resources.requests.storage
    ).toBe("20Gi")
    expect(
      (dockerPvc.spec as unknown as K8sPvcSpec).resources.requests.storage
    ).toBe("30Gi")
  })

  it("all resources have dx.dev/workbench label", () => {
    const resources = generateWorkbenchResources(baseWorkbench)
    for (const r of resources) {
      expect(r.metadata.labels?.["dx.dev/workbench"]).toBe("wkbn_test123")
    }
  })

  it("IngressRoute hostname is {slug}.workbench.dx.dev", () => {
    const orig = process.env.WORKBENCH_INGRESS_ENABLED
    process.env.WORKBENCH_INGRESS_ENABLED = "true"
    try {
      const resources = generateWorkbenchResources(baseWorkbench)
      const ingress = resources.find((r) => r.kind === "IngressRoute")!
      const route = (ingress.spec as unknown as K8sIngressRouteSpec).routes[0]
      expect(route.match).toContain("my-workbench.workbench.dx.dev")
    } finally {
      if (orig === undefined) delete process.env.WORKBENCH_INGRESS_ENABLED
      else process.env.WORKBENCH_INGRESS_ENABLED = orig
    }
  })

  it("uses default fallback image when devcontainerImage is null and no repos", () => {
    const resources = generateWorkbenchResources({
      ...baseWorkbench,
      spec: { ...baseWorkbench.spec, devcontainerImage: null, repos: [] },
    })
    const pod = resources.find((r) => r.kind === "Pod")!
    const workbench = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    expect(workbench.image).toBe(
      process.env.WORKBENCH_DEFAULT_IMAGE || "ghcr.io/nksaraf/dx-sandbox:latest"
    )
  })

  it("direct image mode (no repos) uses devcontainerImage", () => {
    const resources = generateWorkbenchResources({
      ...baseWorkbench,
      spec: { ...baseWorkbench.spec, repos: [] },
    })
    const pod = resources.find((r) => r.kind === "Pod")!
    const workbench = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    expect(workbench.image).toBe("node:20")
  })

  it("omits resource limits when cpu and memory are null", () => {
    const resources = generateWorkbenchResources({
      ...baseWorkbench,
      spec: { ...baseWorkbench.spec, cpu: null, memory: null },
    })
    const pod = resources.find((r) => r.kind === "Pod")!
    const workbench = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workbench"
    )!
    expect(workbench.resources).toBeUndefined()
  })
})
