import * as k8s from "@kubernetes/client-node";
import type { KubeClient, KubeResource } from "./kube-client";

function loadKubeConfig(kubeconfig: string): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  return kc;
}

export class KubeClientImpl implements KubeClient {
  async apply(kubeconfig: string, resource: KubeResource): Promise<void> {
    const kc = loadKubeConfig(kubeconfig);
    const client = k8s.KubernetesObjectApi.makeApiClient(kc);
    const obj = resource as unknown as k8s.KubernetesObject;
    await client.patch(
      obj,
      undefined,
      undefined,
      "factory-reconciler",
      true,
      k8s.PatchStrategy.ServerSideApply
    );
  }

  async get(
    kubeconfig: string,
    kind: string,
    namespace: string,
    name: string
  ): Promise<KubeResource | null> {
    const kc = loadKubeConfig(kubeconfig);
    const client = k8s.KubernetesObjectApi.makeApiClient(kc);
    try {
      const res = await client.read({
        apiVersion: kindToApiVersion(kind),
        kind,
        metadata: { name, namespace },
      } as Required<Pick<k8s.KubernetesObject, "apiVersion" | "kind">> & { metadata: { name: string; namespace?: string } });
      return res as unknown as KubeResource;
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async list(
    kubeconfig: string,
    kind: string,
    namespace: string,
    labelSelector?: string
  ): Promise<KubeResource[]> {
    const kc = loadKubeConfig(kubeconfig);
    const api = kc.makeApiClient(k8s.CoreV1Api);

    if (kind === "Pod") {
      const res = await api.listNamespacedPod({
        namespace,
        labelSelector,
      });
      return (res.items ?? []) as unknown as KubeResource[];
    }

    return [];
  }

  async remove(
    kubeconfig: string,
    kind: string,
    namespace: string,
    name: string
  ): Promise<void> {
    const kc = loadKubeConfig(kubeconfig);
    const client = k8s.KubernetesObjectApi.makeApiClient(kc);
    await client.delete({
      apiVersion: kindToApiVersion(kind),
      kind,
      metadata: { name, namespace },
    } as k8s.KubernetesObject);
  }

  async getDeploymentImage(
    kubeconfig: string,
    namespace: string,
    deploymentName: string
  ): Promise<string | null> {
    const kc = loadKubeConfig(kubeconfig);
    const api = kc.makeApiClient(k8s.AppsV1Api);
    try {
      const res = await api.readNamespacedDeployment({
        name: deploymentName,
        namespace,
      });
      return res.spec?.template?.spec?.containers?.[0]?.image ?? null;
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async pauseNode(kubeconfig: string, nodeName: string): Promise<void> {
    const kc = loadKubeConfig(kubeconfig);
    const api = kc.makeApiClient(k8s.CoreV1Api);
    await api.patchNode({
      name: nodeName,
      body: { spec: { unschedulable: true } },
    });
  }

  async resumeNode(kubeconfig: string, nodeName: string): Promise<void> {
    const kc = loadKubeConfig(kubeconfig);
    const api = kc.makeApiClient(k8s.CoreV1Api);
    await api.patchNode({
      name: nodeName,
      body: { spec: { unschedulable: false } },
    });
  }

  async evacuateNode(kubeconfig: string, nodeName: string): Promise<void> {
    await this.pauseNode(kubeconfig, nodeName);

    const kc = loadKubeConfig(kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const pods = await coreApi.listNamespacedPod({
      namespace: "",
      fieldSelector: `spec.nodeName=${nodeName}`,
    });

    for (const pod of pods.items ?? []) {
      // Skip DaemonSet-managed pods
      const owners = pod.metadata?.ownerReferences ?? [];
      if (owners.some((o) => o.kind === "DaemonSet")) continue;

      const eviction: k8s.V1Eviction = {
        apiVersion: "policy/v1",
        kind: "Eviction",
        metadata: {
          name: pod.metadata?.name ?? "",
          namespace: pod.metadata?.namespace ?? "default",
        },
      };

      await coreApi.createNamespacedPodEviction({
        name: pod.metadata?.name ?? "",
        namespace: pod.metadata?.namespace ?? "default",
        body: eviction,
      });
    }
  }
}

function kindToApiVersion(kind: string): string {
  switch (kind) {
    case "Deployment":
    case "StatefulSet":
      return "apps/v1";
    case "Job":
    case "CronJob":
      return "batch/v1";
    case "IngressRoute":
      return "traefik.io/v1alpha1";
    default:
      return "v1";
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}
