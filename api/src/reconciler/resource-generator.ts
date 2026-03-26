import type { KubeResource } from "../lib/kube-client";
import type {
  ComponentSpec,
  Workload,
  DeploymentTarget,
} from "@smp/factory-shared/types";

export function generateResources(
  workload: Workload,
  component: ComponentSpec,
  target: DeploymentTarget,
  moduleName: string
): KubeResource[] {
  const resources: KubeResource[] = [];
  const ns = target.namespace ?? target.name;
  const labels = {
    "dx.dev/module": moduleName,
    "dx.dev/component": component.name,
    "dx.dev/module-version": workload.moduleVersionId,
    "dx.dev/target": target.name,
    "dx.dev/target-kind": target.kind,
    "dx.dev/managed-by": "factory-reconciler",
  };

  // Namespace (caller should deduplicate — multiple workloads share a namespace)
  resources.push({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: ns,
      labels: {
        "dx.dev/target": target.name,
        "dx.dev/managed-by": "factory-reconciler",
      },
    },
  });

  const resourceLimits = {
    cpu: component.defaultCpu,
    memory: component.defaultMemory,
    ...(workload.resourceOverrides as Record<string, string>),
  };

  switch (component.kind) {
    case "server":
    case "worker":
    case "gateway":
      if (component.stateful) {
        resources.push(makeStatefulSet(workload, component, ns, labels, resourceLimits));
      } else {
        resources.push(makeDeployment(workload, component, ns, labels, resourceLimits));
      }
      break;
    case "database":
      resources.push(makeStatefulSet(workload, component, ns, labels, resourceLimits));
      break;
    case "task":
      resources.push(makeJob(workload, component, ns, labels, resourceLimits));
      break;
    case "scheduled":
      resources.push(makeCronJob(workload, component, ns, labels, resourceLimits));
      break;
    case "site":
      resources.push(makeDeployment(workload, component, ns, labels, resourceLimits));
      break;
  }

  if (component.ports.length > 0) {
    resources.push(makeService(component, ns, labels));
  }

  if (component.isPublic && component.ports.length > 0) {
    resources.push(makeIngressRoute(component, ns, labels, target));
  }

  return resources;
}

function makeContainer(
  workload: Workload,
  component: ComponentSpec,
  resourceLimits: Record<string, string>
) {
  const container: Record<string, unknown> = {
    name: component.name,
    image: workload.desiredImage,
    resources: {
      limits: { cpu: resourceLimits.cpu, memory: resourceLimits.memory },
      requests: { cpu: resourceLimits.cpu, memory: resourceLimits.memory },
    },
    env: Object.entries(
      (workload.envOverrides as Record<string, string>) ?? {}
    ).map(([name, value]) => ({ name, value })),
  };

  if (component.ports.length > 0) {
    container.ports = component.ports.map((p) => ({ name: p.name, containerPort: p.port, protocol: p.protocol }));
  }

  const healthcheck = component.healthcheck;
  if (healthcheck) {
    const hcPort = component.ports.find((p) => p.name === healthcheck.portName);
    const portValue = hcPort ? hcPort.port : (component.ports[0]?.port ?? 80);
    container.livenessProbe = {
      httpGet: { path: healthcheck.path, port: portValue },
      initialDelaySeconds: 10,
      periodSeconds: 15,
    };
    container.readinessProbe = {
      httpGet: { path: healthcheck.path, port: portValue },
      initialDelaySeconds: 5,
      periodSeconds: 10,
    };
  }

  return container;
}

function makeDeployment(
  workload: Workload,
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  resourceLimits: Record<string, string>
): KubeResource {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      replicas: workload.replicas,
      selector: { matchLabels: { "dx.dev/component": component.name } },
      template: {
        metadata: { labels },
        spec: {
          containers: [makeContainer(workload, component, resourceLimits)],
        },
      },
    },
  };
}

function makeStatefulSet(
  workload: Workload,
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  resourceLimits: Record<string, string>
): KubeResource {
  return {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      replicas: workload.replicas,
      serviceName: component.name,
      selector: { matchLabels: { "dx.dev/component": component.name } },
      template: {
        metadata: { labels },
        spec: {
          containers: [makeContainer(workload, component, resourceLimits)],
        },
      },
    },
  };
}

function makeJob(
  workload: Workload,
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  resourceLimits: Record<string, string>
): KubeResource {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          containers: [makeContainer(workload, component, resourceLimits)],
        },
      },
    },
  };
}

function makeCronJob(
  workload: Workload,
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  resourceLimits: Record<string, string>
): KubeResource {
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      schedule: "*/5 * * * *",
      jobTemplate: {
        spec: {
          template: {
            metadata: { labels },
            spec: {
              restartPolicy: "Never",
              containers: [makeContainer(workload, component, resourceLimits)],
            },
          },
        },
      },
    },
  };
}

function makeService(
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      selector: { "dx.dev/component": component.name },
      ports: component.ports.map((p) => ({ name: p.name, port: p.port, targetPort: p.port, protocol: p.protocol })),
    },
  };
}

function makeIngressRoute(
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  target: DeploymentTarget
): KubeResource {
  const firstPort = component.ports[0]?.port ?? 80;
  const host = `${component.name}.${target.name}.dx.dev`;
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: `${component.name}-ingress`, namespace: ns, labels },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: `Host(\`${host}\`)`,
          kind: "Rule",
          services: [{ name: component.name, port: firstPort }],
        },
      ],
    },
  };
}
