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
  storageClassName?: string;
  /** OCI registry for envbuilder image cache (e.g. "registry.local:5000/envbuilder-cache"). */
  envbuilderCacheRepo?: string;
  /** Envbuilder image to use. Defaults to ghcr.io/coder/envbuilder:latest. */
  envbuilderImage?: string;
  /** Devcontainer dir relative to repo root (e.g. ".devcontainer"). Auto-detected if omitted. */
  devcontainerDir?: string;
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
      ...(sandbox.storageClassName ? { storageClassName: sandbox.storageClassName } : {}),
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
      ...(sandbox.storageClassName ? { storageClassName: sandbox.storageClassName } : {}),
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
      `if [ -d /workspaces/${path}/.git ]; then\n` +
      `  cd /workspaces/${path} && git fetch origin ${repo.branch} && git reset --hard origin/${repo.branch}\n` +
      `else\n` +
      `  git clone -b ${repo.branch} ${repo.url} /workspaces/${path}\n` +
      `fi`
    );
  });
  return steps.join("\n");
}

const DEFAULT_ENVBUILDER_IMAGE = "ghcr.io/coder/envbuilder:latest";
const DEFAULT_FALLBACK_IMAGE = "mcr.microsoft.com/devcontainers/base:ubuntu";

function makePod(
  sandbox: SandboxResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const workspacePvcName = `sandbox-${sandbox.slug}-workspace`;
  const dockerPvcName = `sandbox-${sandbox.slug}-docker`;

  const containerEnv = (sandbox.devcontainerConfig.containerEnv ?? {}) as Record<string, string>;
  const remoteEnv = (sandbox.devcontainerConfig.remoteEnv ?? {}) as Record<string, string>;
  const mergedEnv = { ...containerEnv, ...remoteEnv, DOCKER_HOST: "tcp://localhost:2375" };

  const resourceLimits: Record<string, string> = {};
  if (sandbox.cpu) resourceLimits.cpu = sandbox.cpu;
  if (sandbox.memory) resourceLimits.memory = sandbox.memory;

  const hasRepos = sandbox.repos.length > 0;
  const useEnvbuilder = hasRepos;
  const primaryRepo = hasRepos ? sandbox.repos[0]! : null;
  const additionalRepos = hasRepos ? sandbox.repos.slice(1) : [];

  // --- Init containers: only needed for additional repos beyond the primary ---
  const initContainers: Record<string, unknown>[] = [];
  if (additionalRepos.length > 0) {
    const cloneScript = buildCloneScript(additionalRepos);
    initContainers.push({
      name: "clone-extra-repos",
      image: "alpine/git",
      command: ["sh", "-c", cloneScript],
      volumeMounts: [{ name: "workspace", mountPath: "/workspaces" }],
    });
  }
  if (!useEnvbuilder && hasRepos) {
    // Fallback: clone all repos via init container when envbuilder is off
    const cloneScript = buildCloneScript(sandbox.repos);
    initContainers.push({
      name: "clone-repos",
      image: "alpine/git",
      command: ["sh", "-c", cloneScript],
      volumeMounts: [{ name: "workspace", mountPath: "/workspaces" }],
    });
  }

  // --- Workspace container ---
  let workspaceContainer: Record<string, unknown>;

  if (useEnvbuilder) {
    // Envbuilder mode: envbuilder clones the primary repo, detects devcontainer.json,
    // builds the image (or hits cache), and execs into the result.
    const envbuilderImage = sandbox.envbuilderImage ?? DEFAULT_ENVBUILDER_IMAGE;
    const fallbackImage = sandbox.devcontainerImage ?? DEFAULT_FALLBACK_IMAGE;

    const envbuilderEnv: Array<{ name: string; value: string }> = [
      { name: "ENVBUILDER_GIT_URL", value: primaryRepo!.url },
      { name: "ENVBUILDER_GIT_CLONE_DEPTH", value: "1" },
      { name: "ENVBUILDER_FALLBACK_IMAGE", value: fallbackImage },
      // After building, keep the container alive so we can exec into it
      { name: "ENVBUILDER_INIT_SCRIPT", value: "sleep infinity" },
      // Persist workspace on the PVC
      { name: "ENVBUILDER_WORKSPACE_FOLDER", value: "/workspaces" },
    ];

    if (primaryRepo!.branch) {
      envbuilderEnv.push({ name: "ENVBUILDER_GIT_CLONE_SINGLE_BRANCH", value: "true" });
      envbuilderEnv.push({ name: "ENVBUILDER_GIT_HTTP_PROXY_URL", value: "" }); // placeholder
    }

    if (sandbox.devcontainerDir) {
      envbuilderEnv.push({ name: "ENVBUILDER_DEVCONTAINER_DIR", value: sandbox.devcontainerDir });
    }

    if (sandbox.envbuilderCacheRepo) {
      envbuilderEnv.push({ name: "ENVBUILDER_CACHE_REPO", value: sandbox.envbuilderCacheRepo });
      // Push the built image to cache on first build
      envbuilderEnv.push({ name: "ENVBUILDER_PUSH_IMAGE", value: "true" });
    }

    // Merge user-specified env vars
    for (const [name, value] of Object.entries(mergedEnv)) {
      envbuilderEnv.push({ name, value });
    }

    workspaceContainer = {
      name: "workspace",
      image: envbuilderImage,
      env: envbuilderEnv,
      ports: [
        { containerPort: 22, name: "ssh" },
        { containerPort: 8080, name: "web-terminal" },
      ],
      ...(Object.keys(resourceLimits).length > 0
        ? { resources: { limits: resourceLimits, requests: resourceLimits } }
        : {}),
      volumeMounts: [
        { name: "workspace", mountPath: "/workspaces" },
      ],
    };
  } else {
    // Direct image mode: no repos or explicit image only
    const image = sandbox.devcontainerImage ?? DEFAULT_FALLBACK_IMAGE;
    const envVars = Object.entries(mergedEnv).map(([name, value]) => ({ name, value }));

    workspaceContainer = {
      name: "workspace",
      image,
      command: ["sleep", "infinity"],
      env: envVars,
      ports: [
        { containerPort: 22, name: "ssh" },
        { containerPort: 8080, name: "web-terminal" },
      ],
      ...(Object.keys(resourceLimits).length > 0
        ? { resources: { limits: resourceLimits, requests: resourceLimits } }
        : {}),
      volumeMounts: [
        { name: "workspace", mountPath: "/workspaces" },
      ],
    };
  }

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
      ...(initContainers.length > 0 ? { initContainers } : {}),
      containers: [
        workspaceContainer,
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

/** Sanitize an ID for use in k8s resource names (RFC 1123). */
function k8sName(id: string): string {
  return id.replace(/_/g, "-").toLowerCase();
}

/**
 * Generate VolumeSnapshot resources for both workspace and docker PVCs.
 */
export function generateVolumeSnapshots(
  slug: string,
  sandboxId: string,
  snapshotId: string,
  snapshotClassName: string = "csi-hostpath-snapclass",
): KubeResource[] {
  const ns = `sandbox-${slug}`;
  const safeName = k8sName(snapshotId);
  const labels: Record<string, string> = {
    "dx.dev/sandbox": sandboxId,
    "dx.dev/snapshot": snapshotId,
    "dx.dev/managed-by": "factory-reconciler",
  };

  return [
    {
      apiVersion: "snapshot.storage.k8s.io/v1",
      kind: "VolumeSnapshot",
      metadata: {
        name: `snap-${safeName}-workspace`,
        namespace: ns,
        labels,
      },
      spec: {
        volumeSnapshotClassName: snapshotClassName,
        source: {
          persistentVolumeClaimName: `sandbox-${slug}-workspace`,
        },
      },
    },
    {
      apiVersion: "snapshot.storage.k8s.io/v1",
      kind: "VolumeSnapshot",
      metadata: {
        name: `snap-${safeName}-docker`,
        namespace: ns,
        labels,
      },
      spec: {
        volumeSnapshotClassName: snapshotClassName,
        source: {
          persistentVolumeClaimName: `sandbox-${slug}-docker`,
        },
      },
    },
  ];
}

/**
 * Generate a PVC that restores data from a VolumeSnapshot.
 */
export function generatePVCFromSnapshot(
  slug: string,
  snapshotName: string,
  pvcSuffix: "workspace" | "docker",
  storageGb: number,
  sandboxId: string,
  storageClassName?: string,
): KubeResource {
  const ns = `sandbox-${slug}`;
  const labels: Record<string, string> = {
    "dx.dev/sandbox": sandboxId,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "sandbox",
  };

  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `sandbox-${slug}-${pvcSuffix}`,
      namespace: ns,
      labels,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(storageClassName ? { storageClassName } : {}),
      resources: {
        requests: {
          storage: `${storageGb}Gi`,
        },
      },
      dataSource: {
        kind: "VolumeSnapshot",
        apiGroup: "snapshot.storage.k8s.io",
        name: snapshotName,
      },
    },
  };
}
