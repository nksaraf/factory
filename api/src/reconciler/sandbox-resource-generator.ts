import type { KubeResource } from "../lib/kube-client";

interface SandboxResourceInput {
  sandboxId: string;
  slug: string;
  devcontainerImage: string | null;
  devcontainerConfig: Record<string, unknown>;
  repos: Array<{ url: string; branch: string; clonePath?: string }>;
  cpu: string | null;
  memory: string | null;
  storageGb: number;
  dockerCacheGb: number;
}

export function generateSandboxResources(
  sandbox: SandboxResourceInput
): KubeResource[] {
  const ns = `sandbox-${sandbox.slug}`;
  const labels: Record<string, string> = {
    "dx.dev/sandbox": sandbox.sandboxId,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "sandbox",
  };

  return [
    makeNamespace(ns, labels),
    makeWorkspacePVC(sandbox, ns, labels),
    makeDockerPVC(sandbox, ns, labels),
    makePod(sandbox, ns, labels),
    makeService(sandbox, ns, labels),
    makeIngressRoute(sandbox, ns, labels),
  ];
}

function makeNamespace(
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: ns,
      labels,
    },
  };
}

function makeWorkspacePVC(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `sandbox-${sandbox.slug}-workspace`,
      namespace: ns,
      labels,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: `${sandbox.storageGb}Gi`,
        },
      },
    },
  };
}

function makeDockerPVC(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const dockerCacheGb = sandbox.dockerCacheGb ?? 20;
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `sandbox-${sandbox.slug}-docker`,
      namespace: ns,
      labels,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: `${dockerCacheGb}Gi`,
        },
      },
    },
  };
}

function buildCloneScript(
  repos: Array<{ url: string; branch: string; clonePath?: string }>
): string {
  const steps = repos.map((repo) => {
    const path = repo.clonePath ?? repo.url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
    return (
      `if [ -d /workspace/${path}/.git ]; then\n` +
      `  cd /workspace/${path} && git fetch origin ${repo.branch} && git reset --hard origin/${repo.branch}\n` +
      `else\n` +
      `  git clone -b ${repo.branch} ${repo.url} /workspace/${path}\n` +
      `fi`
    );
  });
  return steps.join("\n");
}

function makePod(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const workspacePvcName = `sandbox-${sandbox.slug}-workspace`;
  const dockerPvcName = `sandbox-${sandbox.slug}-docker`;
  const image =
    sandbox.devcontainerImage ??
    "mcr.microsoft.com/devcontainers/base:ubuntu";

  const containerEnv = (sandbox.devcontainerConfig.containerEnv ?? {}) as Record<string, string>;
  const remoteEnv = (sandbox.devcontainerConfig.remoteEnv ?? {}) as Record<string, string>;
  const mergedEnv = { ...containerEnv, ...remoteEnv, DOCKER_HOST: "tcp://localhost:2375" };
  const envVars = Object.entries(mergedEnv).map(([name, value]) => ({ name, value }));

  const resourceLimits: Record<string, string> = {};
  if (sandbox.cpu) resourceLimits.cpu = sandbox.cpu;
  if (sandbox.memory) resourceLimits.memory = sandbox.memory;

  const cloneScript = buildCloneScript(sandbox.repos);

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: `sandbox-${sandbox.slug}`,
      namespace: ns,
      labels,
    },
    spec: {
      restartPolicy: "Never",
      initContainers: [
        {
          name: "clone-repos",
          image: "alpine/git",
          command: ["sh", "-c", cloneScript],
          volumeMounts: [
            {
              name: "workspace",
              mountPath: "/workspace",
            },
          ],
        },
      ],
      containers: [
        {
          name: "workspace",
          image,
          command: ["sleep", "infinity"],
          env: envVars,
          ports: [
            { containerPort: 22, name: "ssh" },
            { containerPort: 8080, name: "web-terminal" },
          ],
          ...(Object.keys(resourceLimits).length > 0
            ? {
                resources: {
                  limits: resourceLimits,
                  requests: resourceLimits,
                },
              }
            : {}),
          volumeMounts: [
            {
              name: "workspace",
              mountPath: "/workspace",
            },
          ],
        },
        {
          name: "dind",
          image: "docker:dind",
          securityContext: {
            privileged: true,
          },
          env: [{ name: "DOCKER_TLS_CERTDIR", value: "" }],
          volumeMounts: [
            {
              name: "docker-storage",
              mountPath: "/var/lib/docker",
            },
          ],
        },
      ],
      volumes: [
        {
          name: "workspace",
          persistentVolumeClaim: { claimName: workspacePvcName },
        },
        {
          name: "docker-storage",
          persistentVolumeClaim: { claimName: dockerPvcName },
        },
      ],
    },
  };
}

function makeService(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `sandbox-${sandbox.slug}`,
      namespace: ns,
      labels,
    },
    spec: {
      type: "NodePort",
      selector: {
        "dx.dev/sandbox": sandbox.sandboxId,
      },
      ports: [
        { name: "ssh", port: 22, targetPort: 22 },
        { name: "web-terminal", port: 8080, targetPort: 8080 },
      ],
    },
  };
}

function makeIngressRoute(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const host = `${sandbox.slug}.sandbox.dx.dev`;
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: `sandbox-${sandbox.slug}-ingress`,
      namespace: ns,
      labels,
    },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: `Host(\`${host}\`)`,
          kind: "Rule",
          services: [
            {
              name: `sandbox-${sandbox.slug}`,
              port: 8080,
            },
          ],
        },
      ],
    },
  };
}
