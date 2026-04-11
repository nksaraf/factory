import type { KubeResource } from "../lib/kube-client"

/** Flat-field input (v1 style). */
export interface WorkbenchResourceInputFlat {
  workbenchId?: string
  slug: string
  devcontainerImage: string | null
  devcontainerConfig: Record<string, unknown>
  repos: Array<{ url: string; branch: string; clonePath?: string }>
  cpu: string | null
  memory: string | null
  storageGb: number
  dockerCacheGb: number
  storageClassName?: string
  envbuilderCacheRepo?: string
  envbuilderImage?: string
  devcontainerDir?: string
}

/** Spec-JSONB input (v2 style). */
export interface WorkbenchResourceInputSpec {
  id: string
  slug: string
  spec: {
    devcontainerImage?: string | null
    devcontainerConfig?: Record<string, unknown>
    repos?: Array<{ url: string; branch: string; clonePath?: string }>
    cpu?: string | null
    memory?: string | null
    storageGb?: number
    dockerCacheGb?: number
    storageClassName?: string
    envbuilderCacheRepo?: string
    envbuilderImage?: string
    devcontainerDir?: string
  }
}

export type WorkbenchResourceInput =
  | WorkbenchResourceInputFlat
  | WorkbenchResourceInputSpec

function normalizeInput(
  input: WorkbenchResourceInput
): WorkbenchResourceInputFlat {
  if ("spec" in input && input.spec) {
    return {
      workbenchId: input.id,
      slug: input.slug,
      devcontainerImage: input.spec.devcontainerImage ?? null,
      devcontainerConfig: input.spec.devcontainerConfig ?? {},
      repos: input.spec.repos ?? [],
      cpu: input.spec.cpu ?? null,
      memory: input.spec.memory ?? null,
      storageGb: input.spec.storageGb ?? 20,
      dockerCacheGb: input.spec.dockerCacheGb ?? 20,
      storageClassName: input.spec.storageClassName,
      envbuilderCacheRepo: input.spec.envbuilderCacheRepo,
      envbuilderImage: input.spec.envbuilderImage,
      devcontainerDir: input.spec.devcontainerDir,
    }
  }
  return input as WorkbenchResourceInputFlat
}

export function generateWorkbenchResources(
  raw: WorkbenchResourceInput
): KubeResource[] {
  const wb = normalizeInput(raw)
  const id = wb.workbenchId ?? wb.slug
  const ns = `workbench-${wb.slug}`
  const labels: Record<string, string> = {
    "dx.dev/workbench": id,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "workbench",
  }

  const resources = [
    makeNamespace(ns, labels),
    makeWorkbenchPVC(wb, ns, labels),
    makeDockerPVC(wb, ns, labels),
    makePod(wb, ns, labels),
    makeService(wb, ns, labels),
  ]

  // Only generate IngressRoute when in-cluster Traefik CRDs are available.
  // When routing is handled by the gateway proxy (the common case), this is
  // not needed — the reconciler creates DB-backed routes instead.
  if (process.env.WORKBENCH_INGRESS_ENABLED === "true") {
    resources.push(makeIngressRoute(wb, ns, labels))
  }

  return resources
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
  }
}

function makeWorkbenchPVC(
  wb: WorkbenchResourceInputFlat,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `workbench-${wb.slug}-data`,
      namespace: ns,
      labels,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(wb.storageClassName ? { storageClassName: wb.storageClassName } : {}),
      resources: {
        requests: {
          storage: `${wb.storageGb}Gi`,
        },
      },
    },
  }
}

function makeDockerPVC(
  wb: WorkbenchResourceInputFlat,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const dockerCacheGb = wb.dockerCacheGb ?? 20
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `workbench-${wb.slug}-docker`,
      namespace: ns,
      labels,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(wb.storageClassName ? { storageClassName: wb.storageClassName } : {}),
      resources: {
        requests: {
          storage: `${dockerCacheGb}Gi`,
        },
      },
    },
  }
}

function buildCloneScript(
  repos: Array<{ url: string; branch: string; clonePath?: string }>
): string {
  const steps = repos.map((repo) => {
    const path =
      repo.clonePath ??
      repo.url
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") ??
      "repo"
    return (
      `if [ -d /workspaces/${path}/.git ]; then\n` +
      `  cd /workspaces/${path} && git fetch origin ${repo.branch} && git reset --hard origin/${repo.branch}\n` +
      `else\n` +
      `  git clone -b ${repo.branch} ${repo.url} /workspaces/${path}\n` +
      `fi`
    )
  })
  return steps.join("\n")
}

const DEFAULT_ENVBUILDER_IMAGE = "ghcr.io/coder/envbuilder:latest"
const DEFAULT_FALLBACK_IMAGE =
  process.env.WORKBENCH_DEFAULT_IMAGE || "ghcr.io/nksaraf/dx-sandbox:latest"

function makePod(
  wb: WorkbenchResourceInputFlat,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const workbenchPvcName = `workbench-${wb.slug}-data`
  const dockerPvcName = `workbench-${wb.slug}-docker`

  const containerEnv = (wb.devcontainerConfig.containerEnv ?? {}) as Record<
    string,
    string
  >
  const remoteEnv = (wb.devcontainerConfig.remoteEnv ?? {}) as Record<
    string,
    string
  >
  const factoryWsUrl =
    process.env.DX_FACTORY_WS_URL || "wss://factory.dx.dev/ws"
  const mergedEnv = {
    ...containerEnv,
    ...remoteEnv,
    DOCKER_HOST: "tcp://localhost:2375",
    DX_WORKBENCH_ID: wb.workbenchId ?? wb.slug,
    DX_WORKBENCH_SLUG: wb.slug,
    DX_FACTORY_WS_URL: factoryWsUrl,
  }

  const resourceLimits: Record<string, string> = {}
  if (wb.cpu) resourceLimits.cpu = wb.cpu
  if (wb.memory) resourceLimits.memory = wb.memory

  const hasRepos = wb.repos.length > 0
  const useEnvbuilder = hasRepos
  const primaryRepo = hasRepos ? wb.repos[0]! : null
  const additionalRepos = hasRepos ? wb.repos.slice(1) : []

  // --- Init containers: only needed for additional repos beyond the primary ---
  const initContainers: Record<string, unknown>[] = []
  if (additionalRepos.length > 0) {
    const cloneScript = buildCloneScript(additionalRepos)
    initContainers.push({
      name: "clone-extra-repos",
      image: "alpine/git",
      command: ["sh", "-c", cloneScript],
      volumeMounts: [{ name: "workbench", mountPath: "/workspaces" }],
    })
  }
  if (!useEnvbuilder && hasRepos) {
    // Fallback: clone all repos via init container when envbuilder is off
    const cloneScript = buildCloneScript(wb.repos)
    initContainers.push({
      name: "clone-repos",
      image: "alpine/git",
      command: ["sh", "-c", cloneScript],
      volumeMounts: [{ name: "workbench", mountPath: "/workspaces" }],
    })
  }

  // --- Workbench container ---
  let workbenchContainer: Record<string, unknown>

  if (useEnvbuilder) {
    // Envbuilder mode: envbuilder clones the primary repo, detects devcontainer.json,
    // builds the image (or hits cache), and execs into the result.
    const envbuilderImage = wb.envbuilderImage ?? DEFAULT_ENVBUILDER_IMAGE
    const fallbackImage = wb.devcontainerImage ?? DEFAULT_FALLBACK_IMAGE

    // The workbench PVC is mounted at /workspace-pvc (not /workspaces) because
    // envbuilder deletes the root filesystem during image rebuilds. After envbuilder
    // finishes, the init script syncs user data from the PVC into /workspaces so
    // snapshot-restored files survive container restarts.
    const initScript =
      "cp -a /workspace-pvc/. /workspaces/ 2>/dev/null; " +
      "touch /tmp/.envbuilder-ready; " +
      "(while true; do sleep 30; cp -a /workspaces/. /workspace-pvc/ 2>/dev/null; done) & " +
      "if [ -x /usr/local/bin/dx-entrypoint.sh ]; then exec /usr/local/bin/dx-entrypoint.sh; else sleep infinity; fi"

    const envbuilderEnv: Array<{ name: string; value: string }> = [
      { name: "ENVBUILDER_GIT_URL", value: primaryRepo!.url },
      { name: "ENVBUILDER_GIT_CLONE_DEPTH", value: "1" },
      { name: "ENVBUILDER_FALLBACK_IMAGE", value: fallbackImage },
      // After building, sync PVC data and keep alive
      { name: "ENVBUILDER_INIT_SCRIPT", value: initScript },
      // Envbuilder clones to /workspaces (its own managed directory)
      { name: "ENVBUILDER_WORKSPACE_FOLDER", value: "/workspaces" },
    ]

    if (primaryRepo!.branch) {
      envbuilderEnv.push({
        name: "ENVBUILDER_GIT_CLONE_SINGLE_BRANCH",
        value: "true",
      })
      envbuilderEnv.push({ name: "ENVBUILDER_GIT_HTTP_PROXY_URL", value: "" }) // placeholder
    }

    if (wb.devcontainerDir) {
      envbuilderEnv.push({
        name: "ENVBUILDER_DEVCONTAINER_DIR",
        value: wb.devcontainerDir,
      })
    }

    if (wb.envbuilderCacheRepo) {
      envbuilderEnv.push({
        name: "ENVBUILDER_CACHE_REPO",
        value: wb.envbuilderCacheRepo,
      })
      // Push the built image to cache on first build
      envbuilderEnv.push({ name: "ENVBUILDER_PUSH_IMAGE", value: "true" })
    }

    // Merge user-specified env vars
    for (const [name, value] of Object.entries(mergedEnv)) {
      envbuilderEnv.push({ name, value })
    }

    workbenchContainer = {
      name: "workbench",
      image: envbuilderImage,
      imagePullPolicy: "IfNotPresent",
      env: envbuilderEnv,
      ports: [
        { containerPort: 22, name: "ssh" },
        { containerPort: 8080, name: "web-terminal" },
        { containerPort: 8081, name: "web-ide" },
      ],
      ...(Object.keys(resourceLimits).length > 0
        ? { resources: { limits: resourceLimits, requests: resourceLimits } }
        : {}),
      volumeMounts: [{ name: "workbench", mountPath: "/workspace-pvc" }],
      readinessProbe: {
        exec: { command: ["sh", "-c", "test -f /tmp/.envbuilder-ready"] },
        initialDelaySeconds: 5,
        periodSeconds: 5,
        failureThreshold: 120,
      },
    }
  } else {
    // Direct image mode: no repos or explicit image only
    const image = wb.devcontainerImage ?? DEFAULT_FALLBACK_IMAGE
    const envVars = Object.entries(mergedEnv).map(([name, value]) => ({
      name,
      value,
    }))

    workbenchContainer = {
      name: "workbench",
      image,
      imagePullPolicy: "IfNotPresent",
      command: [
        "sh",
        "-c",
        "if [ -x /usr/local/bin/dx-entrypoint.sh ]; then exec /usr/local/bin/dx-entrypoint.sh; else sleep infinity; fi",
      ],
      env: envVars,
      ports: [
        { containerPort: 22, name: "ssh" },
        { containerPort: 8080, name: "web-terminal" },
        { containerPort: 8081, name: "web-ide" },
      ],
      ...(Object.keys(resourceLimits).length > 0
        ? { resources: { limits: resourceLimits, requests: resourceLimits } }
        : {}),
      volumeMounts: [{ name: "workbench", mountPath: "/workspaces" }],
      readinessProbe: {
        exec: { command: ["true"] },
        initialDelaySeconds: 1,
        periodSeconds: 5,
      },
    }
  }

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: `workbench-${wb.slug}`,
      namespace: ns,
      labels,
    },
    spec: {
      restartPolicy: "Never",
      ...(initContainers.length > 0 ? { initContainers } : {}),
      containers: [
        workbenchContainer,
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
          name: "workbench",
          persistentVolumeClaim: { claimName: workbenchPvcName },
        },
        {
          name: "docker-storage",
          persistentVolumeClaim: { claimName: dockerPvcName },
        },
      ],
    },
  }
}

function makeService(
  wb: WorkbenchResourceInputFlat,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `workbench-${wb.slug}`,
      namespace: ns,
      labels,
    },
    spec: {
      type: "NodePort",
      selector: {
        "dx.dev/workbench": wb.workbenchId ?? wb.slug,
      },
      ports: [
        { name: "ssh", port: 22, targetPort: 22 },
        { name: "web-terminal", port: 8080, targetPort: 8080 },
        { name: "web-ide", port: 8081, targetPort: 8081 },
      ],
    },
  }
}

function makeIngressRoute(
  wb: WorkbenchResourceInputFlat,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  const primaryEndpoint = (
    process.env.WORKBENCH_PRIMARY_ENDPOINT || "ide"
  ).toLowerCase()
  const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
  const host = `${wb.slug}.workbench.${gatewayDomain}`
  const primaryPort = primaryEndpoint === "terminal" ? 8080 : 8081
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: `workbench-${wb.slug}-ingress`,
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
              name: `workbench-${wb.slug}`,
              port: primaryPort,
            },
          ],
        },
        {
          match: `Host(\`${wb.slug}--terminal.workbench.${gatewayDomain}\`)`,
          kind: "Rule",
          services: [
            {
              name: `workbench-${wb.slug}`,
              port: 8080,
            },
          ],
        },
        {
          match: `Host(\`${wb.slug}--ide.workbench.${gatewayDomain}\`)`,
          kind: "Rule",
          services: [
            {
              name: `workbench-${wb.slug}`,
              port: 8081,
            },
          ],
        },
      ],
    },
  }
}

/** Sanitize an ID for use in k8s resource names (RFC 1123). */
function k8sName(id: string): string {
  return id.replace(/_/g, "-").toLowerCase()
}

/**
 * Generate VolumeSnapshot resources for both workbench and docker PVCs.
 */
export function generateVolumeSnapshots(
  slug: string,
  workbenchId: string,
  snapshotId: string,
  snapshotClassName: string = "csi-hostpath-snapclass"
): KubeResource[] {
  const ns = `workbench-${slug}`
  const safeName = k8sName(snapshotId)
  const labels: Record<string, string> = {
    "dx.dev/workbench": workbenchId,
    "dx.dev/snapshot": snapshotId,
    "dx.dev/managed-by": "factory-reconciler",
  }

  return [
    {
      apiVersion: "snapshot.storage.k8s.io/v1",
      kind: "VolumeSnapshot",
      metadata: {
        name: `snap-${safeName}-workbench`,
        namespace: ns,
        labels,
      },
      spec: {
        volumeSnapshotClassName: snapshotClassName,
        source: {
          persistentVolumeClaimName: `workbench-${slug}-data`,
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
          persistentVolumeClaimName: `workbench-${slug}-docker`,
        },
      },
    },
  ]
}

/**
 * Generate a PVC that restores data from a VolumeSnapshot.
 */
export function generatePVCFromSnapshot(
  slug: string,
  snapshotName: string,
  pvcSuffix: "workbench" | "docker",
  storageGb: number,
  workbenchId: string,
  storageClassName?: string
): KubeResource {
  const ns = `workbench-${slug}`
  const labels: Record<string, string> = {
    "dx.dev/workbench": workbenchId,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "workbench",
  }

  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `workbench-${slug}-${pvcSuffix}`,
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
  }
}
