import type { KubeResource } from "../lib/kube-client";

export interface PreviewResourceInput {
  previewSlug: string;
  previewId: string;
  imageRef: string;
  port: number;
  replicas?: number;
}

/**
 * Generate K8s Deployment + Service for a preview from a built image.
 */
export function generatePreviewResources(input: PreviewResourceInput): KubeResource[] {
  const ns = `preview-${input.previewSlug}`;
  const labels: Record<string, string> = {
    "dx.dev/preview": input.previewId,
    "dx.dev/managed-by": "factory-reconciler",
    "dx.dev/target-kind": "preview",
  };

  return [
    makeNamespace(ns, labels),
    makeDeployment(input, ns, labels),
    makeService(input, ns, labels),
  ];
}

function makeNamespace(ns: string, labels: Record<string, string>): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: ns, labels },
  };
}

function makeDeployment(
  input: PreviewResourceInput,
  ns: string,
  labels: Record<string, string>,
): KubeResource {
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
        spec: {
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
        },
      },
    },
  };
}

function makeService(
  input: PreviewResourceInput,
  ns: string,
  labels: Record<string, string>,
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
  };
}
