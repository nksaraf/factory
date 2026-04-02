import { describe, expect, it } from "vitest";
import { generateSandboxResources } from "../reconciler/sandbox-resource-generator";

describe("Sandbox Resource Generator", () => {
  // Envbuilder mode: has repos → envbuilder clones and builds
  const baseSandbox = {
    sandboxId: "sbx_test123",
    slug: "my-sandbox",
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
  };

  // Direct image mode: no repos → uses devcontainerImage directly
  const directImageSandbox = {
    ...baseSandbox,
    repos: [] as Array<{ url: string; branch: string; clonePath?: string }>,
  };

  it("generates 5 resources for a container sandbox (IngressRoute off by default)", () => {
    const resources = generateSandboxResources(baseSandbox);
    expect(resources).toHaveLength(5);
    expect(resources.map((r) => r.kind)).toEqual([
      "Namespace",
      "PersistentVolumeClaim",
      "PersistentVolumeClaim",
      "Pod",
      "Service",
    ]);
  });

  // ---------------------------------------------------------------------------
  // Envbuilder mode (repos present)
  // ---------------------------------------------------------------------------

  it("envbuilder mode: workspace image is envbuilder, fallback set as env var", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );

    expect(workspace.image).toBe("ghcr.io/coder/envbuilder:latest");

    const envMap = Object.fromEntries(
      workspace.env.map((e: any) => [e.name, e.value])
    );
    expect(envMap.ENVBUILDER_FALLBACK_IMAGE).toBe("node:20");
    expect(envMap.ENVBUILDER_GIT_URL).toBe("https://github.com/test/repo");
  });

  it("envbuilder mode: no init containers with single repo", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as any;

    // Envbuilder handles cloning — no init containers needed for single repo
    expect(spec.initContainers).toBeUndefined();
    expect(spec.containers).toHaveLength(2);
    expect(spec.containers.map((c: any) => c.name)).toEqual(["workspace", "dind"]);
  });

  it("envbuilder mode: init container clones extra repos when multiple repos", () => {
    const multiRepoSandbox = {
      ...baseSandbox,
      repos: [
        { url: "https://github.com/test/primary", branch: "main" },
        { url: "https://github.com/test/secondary", branch: "develop" },
      ],
    };
    const resources = generateSandboxResources(multiRepoSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const spec = pod.spec as any;

    expect(spec.initContainers).toHaveLength(1);
    expect(spec.initContainers[0].name).toBe("clone-extra-repos");
    const script = spec.initContainers[0].command[2] as string;
    expect(script).toContain("https://github.com/test/secondary");
    expect(script).not.toContain("https://github.com/test/primary");
  });

  it("envbuilder mode: uses default fallback image when devcontainerImage is null", () => {
    const resources = generateSandboxResources({
      ...baseSandbox,
      devcontainerImage: null,
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );

    // Container image is still envbuilder
    expect(workspace.image).toBe("ghcr.io/coder/envbuilder:latest");
    // Fallback is the platform default
    const envMap = Object.fromEntries(
      workspace.env.map((e: any) => [e.name, e.value])
    );
    expect(envMap.ENVBUILDER_FALLBACK_IMAGE).toBe("ghcr.io/nksaraf/dx-sandbox:latest");
  });

  // ---------------------------------------------------------------------------
  // Direct image mode (no repos)
  // ---------------------------------------------------------------------------

  it("direct image mode: uses devcontainerImage directly", () => {
    const resources = generateSandboxResources(directImageSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );

    expect(workspace.image).toBe("node:20");

    // Env includes DOCKER_HOST and devcontainer env
    const envMap = Object.fromEntries(
      workspace.env.map((e: any) => [e.name, e.value])
    );
    expect(envMap.DOCKER_HOST).toBe("tcp://localhost:2375");
    expect(envMap.NODE_ENV).toBe("development");
  });

  it("direct image mode: uses default fallback when devcontainerImage is null", () => {
    const resources = generateSandboxResources({
      ...directImageSandbox,
      devcontainerImage: null,
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );
    expect(workspace.image).toBe("ghcr.io/nksaraf/dx-sandbox:latest");
  });

  it("direct image mode: has dx-entrypoint.sh command", () => {
    const resources = generateSandboxResources(directImageSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );
    const cmd = Array.isArray(workspace.command) ? workspace.command.join(" ") : workspace.command;
    expect(cmd).toContain("dx-entrypoint.sh");
  });

  // ---------------------------------------------------------------------------
  // Shared tests (apply to both modes)
  // ---------------------------------------------------------------------------

  it("workspace container has resource limits and ports 22+8080+8081", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );

    expect(workspace.resources.limits.cpu).toBe("2000m");
    expect(workspace.resources.limits.memory).toBe("4Gi");

    const ports = workspace.ports.map((p: any) => p.containerPort);
    expect(ports).toContain(22);
    expect(ports).toContain(8080);
    expect(ports).toContain(8081);
  });

  it("DinD sidecar mounts docker PVC at /var/lib/docker", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pod = resources.find((r) => r.kind === "Pod")!;
    const dind = (pod.spec as any).containers.find(
      (c: any) => c.name === "dind"
    );

    expect(dind.image).toBe("docker:dind");
    expect(dind.securityContext.privileged).toBe(true);

    const mount = dind.volumeMounts.find(
      (vm: any) => vm.mountPath === "/var/lib/docker"
    );
    expect(mount).toBeTruthy();
    expect(mount.name).toBe("docker-storage");
  });

  it("workspace PVC size matches storageGb, docker PVC size matches dockerCacheGb", () => {
    const resources = generateSandboxResources(baseSandbox);
    const pvcs = resources.filter((r) => r.kind === "PersistentVolumeClaim");
    expect(pvcs).toHaveLength(2);

    const workspacePvc = pvcs.find((p) =>
      p.metadata.name!.includes("workspace")
    )!;
    const dockerPvc = pvcs.find((p) => p.metadata.name!.includes("docker"))!;

    expect((workspacePvc.spec as any).resources.requests.storage).toBe("20Gi");
    expect((dockerPvc.spec as any).resources.requests.storage).toBe("30Gi");
  });

  it("all resources have dx.dev/sandbox label", () => {
    const resources = generateSandboxResources(baseSandbox);
    for (const r of resources) {
      expect(r.metadata.labels?.["dx.dev/sandbox"]).toBe("sbx_test123");
    }
  });

  it("omits resource limits when cpu and memory are null", () => {
    const resources = generateSandboxResources({
      ...baseSandbox,
      cpu: null,
      memory: null,
    });
    const pod = resources.find((r) => r.kind === "Pod")!;
    const workspace = (pod.spec as any).containers.find(
      (c: any) => c.name === "workspace"
    );
    expect(workspace.resources).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // IngressRoute tests
  // ---------------------------------------------------------------------------

  it("IngressRoute generated when SANDBOX_INGRESS_ENABLED=true", () => {
    const orig = process.env.SANDBOX_INGRESS_ENABLED;
    process.env.SANDBOX_INGRESS_ENABLED = "true";
    try {
      const resources = generateSandboxResources(baseSandbox);
      const ingress = resources.find((r) => r.kind === "IngressRoute")!;
      expect(ingress).toBeTruthy();
      // Primary route serves IDE by default (port 8081)
      const primaryRoute = (ingress.spec as any).routes[0];
      expect(primaryRoute.match).toContain("my-sandbox.sandbox.dx.dev");
      expect(primaryRoute.services[0].port).toBe(8081);
      // Terminal and IDE named routes also present
      const terminalRoute = (ingress.spec as any).routes[1];
      expect(terminalRoute.match).toContain("my-sandbox--terminal.sandbox.");
      expect(terminalRoute.services[0].port).toBe(8080);
      const ideRoute = (ingress.spec as any).routes[2];
      expect(ideRoute.match).toContain("my-sandbox--ide.sandbox.");
      expect(ideRoute.services[0].port).toBe(8081);
    } finally {
      if (orig === undefined) delete process.env.SANDBOX_INGRESS_ENABLED;
      else process.env.SANDBOX_INGRESS_ENABLED = orig;
    }
  });

  it("SANDBOX_PRIMARY_ENDPOINT=terminal puts terminal on primary route", () => {
    const origIngress = process.env.SANDBOX_INGRESS_ENABLED;
    const origEndpoint = process.env.SANDBOX_PRIMARY_ENDPOINT;
    process.env.SANDBOX_INGRESS_ENABLED = "true";
    process.env.SANDBOX_PRIMARY_ENDPOINT = "terminal";
    try {
      const resources = generateSandboxResources(baseSandbox);
      const ingress = resources.find((r) => r.kind === "IngressRoute")!;
      const primaryRoute = (ingress.spec as any).routes[0];
      expect(primaryRoute.services[0].port).toBe(8080);
    } finally {
      if (origIngress === undefined) delete process.env.SANDBOX_INGRESS_ENABLED;
      else process.env.SANDBOX_INGRESS_ENABLED = origIngress;
      if (origEndpoint === undefined) delete process.env.SANDBOX_PRIMARY_ENDPOINT;
      else process.env.SANDBOX_PRIMARY_ENDPOINT = origEndpoint;
    }
  });
});
