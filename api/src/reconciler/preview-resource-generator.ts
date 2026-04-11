import type { KubeResource } from "../lib/kube-client"

const GAR_JSON_KEY =
  process.env.GAR_JSON_KEY ??
  (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
    ? Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        "base64"
      ).toString("utf-8")
    : undefined)
const PREVIEW_REGISTRY_HOST =
  process.env.PREVIEW_REGISTRY_HOST ?? "asia-south2-docker.pkg.dev"
const IMAGE_PULL_SECRET_NAME = "gar-pull-secret"

export interface PreviewResourceInput {
  previewSlug: string
  previewId: string
  imageRef: string
  port: number
  replicas?: number
}

/**
 * Generate K8s Deployment + Service for a preview from a built image.
 * Optionally includes an imagePullSecret for private registries (GAR).
 */
export function generatePreviewResources(
  input: PreviewResourceInput
): KubeResource[] {
  const ns = `preview-${input.previewSlug}`
  const labels: Record<string, string> = {
    "dx.dev/preview": input.previewId,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "preview",
  }

  const resources: KubeResource[] = [makeNamespace(ns, labels)]

  // Add imagePullSecret for private registries (e.g. Google Artifact Registry)
  // Skipped on GKE clusters where Workload Identity handles auth natively
  if (GAR_JSON_KEY) {
    resources.push(
      makeImagePullSecret(ns, labels, PREVIEW_REGISTRY_HOST, GAR_JSON_KEY)
    )
  }

  resources.push(
    makeDeployment(
      input,
      ns,
      labels,
      GAR_JSON_KEY ? IMAGE_PULL_SECRET_NAME : undefined
    ),
    makeService(input, ns, labels)
  )

  return resources
}

function makeNamespace(
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: ns, labels },
  }
}

function makeImagePullSecret(
  ns: string,
  labels: Record<string, string>,
  registryHost: string,
  jsonKey: string
): KubeResource {
  const auth = Buffer.from(`_json_key:${jsonKey}`).toString("base64")
  const dockerConfig = JSON.stringify({
    auths: { [registryHost]: { auth } },
  })
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: IMAGE_PULL_SECRET_NAME, namespace: ns, labels },
    type: "kubernetes.io/dockerconfigjson",
    data: {
      ".dockerconfigjson": Buffer.from(dockerConfig).toString("base64"),
    },
  } as KubeResource
}

function makeDeployment(
  input: PreviewResourceInput,
  ns: string,
  labels: Record<string, string>,
  imagePullSecretName?: string
): KubeResource {
  const podSpec: Record<string, unknown> = {
    containers: [
      {
        name: "app",
        image: input.imageRef,
        ports: [{ containerPort: input.port, name: "http" }],
        readinessProbe: {
          httpGet: { path: "/", port: input.port },
          initialDelaySeconds: 5,
          periodSeconds: 10,
        },
      },
    ],
  }

  if (imagePullSecretName) {
    podSpec.imagePullSecrets = [{ name: imagePullSecretName }]
  }

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: `preview-${input.previewSlug}`,
      namespace: ns,
      labels,
    },
    spec: {
      replicas: input.replicas ?? 1,
      selector: {
        matchLabels: { "dx.dev/preview": input.previewId },
      },
      template: {
        metadata: { labels: { "dx.dev/preview": input.previewId } },
        spec: podSpec,
      },
    },
  }
}

function makeService(
  input: PreviewResourceInput,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `preview-${input.previewSlug}`,
      namespace: ns,
      labels,
    },
    spec: {
      type: "ClusterIP",
      selector: { "dx.dev/preview": input.previewId },
      ports: [{ name: "http", port: input.port, targetPort: input.port }],
    },
  }
}
