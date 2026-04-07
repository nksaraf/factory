import { describe, expect, it } from "vitest";
import { generateWorkspaceResources } from "../reconciler/sandbox-resource-generator";

// K8s resource shape interfaces for typed spec access
interface K8sEnvVar { name: string; value: string }
interface K8sPort { name: string; containerPort: number }
interface K8sVolumeMount { name: string; mountPath: string }
interface K8sContainer {
  name: string;
  image: string;
  command?: string[];
  env: K8sEnvVar[];
  ports: K8sPort[];
  resources?: { limits: { cpu: string; memory: string } };
  securityContext?: { privileged: boolean };
  volumeMounts: K8sVolumeMount[];
}
interface K8sPodSpec {
  containers: K8sContainer[];
  initContainers?: Array<{ name: string; command: string[] }>;
}
interface K8sPvcSpec {
  resources: { requests: { storage: string } };
}
interface K8sIngressRoute {
  match: string;
  services: Array<{ port: number }>;
}
interface K8sIngressRouteSpec {
  routes: K8sIngressRoute[];
}

describe("Workspace Resource Generator", () => {
  const baseWorkspace = {
    id: "wksp_test123",
    slug: "my-workspace",
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
  };

  it("generates 5 resources (no IngressRoute by default)", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    expect(resources).toHaveLength(5);
    expect(resources.map((r) => r.kind)).toEqual([
      "Namespace",
      "PersistentVolumeClaim",
      "PersistentVolumeClaim",
      "Pod",
      "Service",
    ]);
  });

  it("generates 6 resources with IngressRoute when WORKSPACE_INGRESS_ENABLED", () => {
    const orig = process.env.WORKSPACE_INGRESS_ENABLED;
    process.env.WORKSPACE_INGRESS_ENABLED = "true";
    try {
      const resources = generateWorkspaceResources(baseWorkspace);
      expect(resources).toHaveLength(6);
      expect(resources.map((r) => r.kind)).toContain("IngressRoute");
    } finally {
      if (orig === undefined) delete process.env.WORKSPACE_INGRESS_ENABLED;
      else process.env.WORKSPACE_INGRESS_ENABLED = orig;
    }
  });

  it("uses envbuilder when repos are present", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as unknown as K8sPodSpec;
    const workspace = spec.containers.find((c) => c.name === "workspace")!;

    // Envbuilder mode: image is the envbuilder image, not the devcontainerImage
    expect(workspace.image).toBe("ghcr.io/coder/envbuilder:latest");

    // Envbuilder sets ENVBUILDER_GIT_URL for the primary repo
    const envMap = Object.fromEntries(
      workspace.env.map((e) => [e.name, e.value])
    );
    expect(envMap.ENVBUILDER_GIT_URL).toBe("https://github.com/test/repo");
    expect(envMap.ENVBUILDER_FALLBACK_IMAGE).toBe("node:20");
  });

  it("envbuilder mode has no init containers for single repo", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as unknown as K8sPodSpec;
    // Single repo is handled by envbuilder, no init containers needed
    expect(spec.initContainers).toBeUndefined();
  });

  it("envbuilder mode adds clone-extra-repos init container for additional repos", () => {
    const multiRepo = {
      ...baseWorkspace,
      spec: {
        ...baseWorkspace.spec,
        repos: [
          { url: "https://github.com/test/primary", branch: "main" },
          { url: "https://github.com/test/secondary", branch: "dev", clonePath: "extra" },
        ],
      },
    };
    const resources = generateWorkspaceResources(multiRepo);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as unknown as K8sPodSpec;
    expect(spec.initContainers).toHaveLength(1);
    expect(spec.initContainers![0].name).toBe("clone-extra-repos");

    const script = spec.initContainers![0].command[2] as string;
    expect(script).toContain("https://github.com/test/secondary");
    expect(script).toContain("/workspaces/extra");
    // Primary repo is NOT in the init container — envbuilder handles it
    expect(script).not.toContain("primary");
  });

  it("Pod has 2 containers (workspace + dind)", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as unknown as K8sPodSpec;

    expect(spec.containers).toHaveLength(2);
    const names = spec.containers.map((c) => c.name);
    expect(names).toContain("workspace");
    expect(names).toContain("dind");
  });

  it("workspace container has correct limits, env (DOCKER_HOST), and ports 22+8080+8081", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workspace"
    )!;

    expect(workspace.resources!.limits.cpu).toBe("2000m");
    expect(workspace.resources!.limits.memory).toBe("4Gi");

    const envMap = Object.fromEntries(
      workspace.env.map((e) => [e.name, e.value])
    );
    expect(envMap.DOCKER_HOST).toBe("tcp://localhost:2375");
    expect(envMap.NODE_ENV).toBe("development");

    const ports = workspace.ports.map((p) => p.containerPort);
    expect(ports).toContain(22);
    expect(ports).toContain(8080);
    expect(ports).toContain(8081);
  });

  it("DinD sidecar mounts docker PVC at /var/lib/docker", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const dind = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "dind"
    )!;

    expect(dind.image).toBe("docker:dind");
    expect(dind.securityContext!.privileged).toBe(true);

    const mount = dind.volumeMounts.find(
      (vm) => vm.mountPath === "/var/lib/docker"
    );
    expect(mount).toBeTruthy();
    expect(mount!.name).toBe("docker-storage");
  });

  it("workspace PVC size matches storageGb, docker PVC size matches dockerCacheGb", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    const pvcs = resources.filter((r) => r.kind === "PersistentVolumeClaim");
    expect(pvcs).toHaveLength(2);

    const workspacePvc = pvcs.find((p) =>
      p.metadata.name!.includes("workspace")
    )!;
    const dockerPvc = pvcs.find((p) => p.metadata.name!.includes("docker"))!;

    expect((workspacePvc.spec as unknown as K8sPvcSpec).resources.requests.storage).toBe("20Gi");
    expect((dockerPvc.spec as unknown as K8sPvcSpec).resources.requests.storage).toBe("30Gi");
  });

  it("all resources have dx.dev/workspace label", () => {
    const resources = generateWorkspaceResources(baseWorkspace);
    for (const r of resources) {
      expect(r.metadata.labels?.["dx.dev/workspace"]).toBe("wksp_test123");
    }
  });

  it("IngressRoute hostname is {slug}.workspace.dx.dev", () => {
    const orig = process.env.WORKSPACE_INGRESS_ENABLED;
    process.env.WORKSPACE_INGRESS_ENABLED = "true";
    try {
      const resources = generateWorkspaceResources(baseWorkspace);
      const ingress = resources.find((r) => r.kind === "IngressRoute")!;
      const route = (ingress.spec as unknown as K8sIngressRouteSpec).routes[0];
      expect(route.match).toContain("my-workspace.workspace.dx.dev");
    } finally {
      if (orig === undefined) delete process.env.WORKSPACE_INGRESS_ENABLED;
      else process.env.WORKSPACE_INGRESS_ENABLED = orig;
    }
  });

  it("uses default fallback image when devcontainerImage is null and no repos", () => {
    const resources = generateWorkspaceResources({
      ...baseWorkspace,
      spec: { ...baseWorkspace.spec, devcontainerImage: null, repos: [] },
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workspace"
    )!;
    // Default fallback: WORKSPACE_DEFAULT_IMAGE env or ghcr.io/nksaraf/dx-sandbox:latest
    expect(workspace.image).toBe(
      process.env.WORKSPACE_DEFAULT_IMAGE || "ghcr.io/nksaraf/dx-sandbox:latest"
    );
  });

  it("direct image mode (no repos) uses devcontainerImage", () => {
    const resources = generateWorkspaceResources({
      ...baseWorkspace,
      spec: { ...baseWorkspace.spec, repos: [] },
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workspace"
    )!;
    expect(workspace.image).toBe("node:20");
  });

  it("omits resource limits when cpu and memory are null", () => {
    const resources = generateWorkspaceResources({
      ...baseWorkspace,
      spec: { ...baseWorkspace.spec, cpu: null, memory: null },
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as unknown as K8sPodSpec).containers.find(
      (c) => c.name === "workspace"
    )!;
    expect(workspace.resources).toBeUndefined();
  });
});
