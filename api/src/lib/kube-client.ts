export interface KubeResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
}

export interface KubeClient {
  apply(kubeconfig: string, resource: KubeResource): Promise<void>;
  get(kubeconfig: string, kind: string, namespace: string, name: string): Promise<KubeResource | null>;
  list(kubeconfig: string, kind: string, namespace: string, labelSelector?: string): Promise<KubeResource[]>;
  remove(kubeconfig: string, kind: string, namespace: string, name: string): Promise<void>;
  getDeploymentImage(kubeconfig: string, namespace: string, deploymentName: string): Promise<string | null>;
  evacuateNode(kubeconfig: string, nodeName: string): Promise<void>;
  pauseNode(kubeconfig: string, nodeName: string): Promise<void>;
  resumeNode(kubeconfig: string, nodeName: string): Promise<void>;
}
