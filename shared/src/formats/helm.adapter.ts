/**
 * Helm chart format adapter.
 *
 * Converts between Helm chart structure (Chart.yaml + values.yaml) and CatalogSystem.
 * A Helm chart maps to a single Component; subchart dependencies may map to
 * Resources (infra like postgres/redis) or additional Components.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  CatalogComponent,
  CatalogResource,
  CatalogSystem,
} from "../catalog";
import type {
  CatalogFormatAdapter,
  CatalogGenerateResult,
  CatalogParseResult,
} from "../catalog-registry";

// ─── Infra name heuristics ──────────────────────────────────

const INFRA_PATTERNS: [RegExp, string][] = [
  [/postgres/i, "database"],
  [/postgis/i, "database"],
  [/mysql/i, "database"],
  [/mariadb/i, "database"],
  [/mongodb/i, "database"],
  [/redis/i, "cache"],
  [/valkey/i, "cache"],
  [/memcached/i, "cache"],
  [/rabbitmq/i, "queue"],
  [/kafka/i, "queue"],
  [/nats/i, "queue"],
  [/minio/i, "storage"],
  [/elasticsearch/i, "search"],
  [/opensearch/i, "search"],
  [/meilisearch/i, "search"],
];

function inferInfraType(name: string): string | null {
  for (const [pattern, type] of INFRA_PATTERNS) {
    if (pattern.test(name)) return type;
  }
  return null;
}

// ─── Parse helpers ──────────────────────────────────────────

interface ChartYaml {
  apiVersion?: string;
  name?: string;
  description?: string;
  type?: string;
  version?: string;
  appVersion?: string;
  dependencies?: Array<{
    name: string;
    version?: string;
    repository?: string;
    condition?: string;
    alias?: string;
  }>;
}

interface ValuesYaml {
  replicaCount?: number;
  image?: {
    repository?: string;
    tag?: string;
    pullPolicy?: string;
  };
  service?: {
    type?: string;
    port?: number;
  };
  ingress?: {
    enabled?: boolean;
    hosts?: unknown[];
  };
  resources?: {
    limits?: { cpu?: string; memory?: string };
    requests?: { cpu?: string; memory?: string };
  };
  [key: string]: unknown;
}

// ─── Adapter ────────────────────────────────────────────────

export class HelmFormatAdapter implements CatalogFormatAdapter {
  readonly format = "helm" as const;

  detect(rootDir: string): boolean {
    return existsSync(join(rootDir, "Chart.yaml"));
  }

  parse(rootDir: string): CatalogParseResult {
    const warnings: string[] = [];

    // Read Chart.yaml
    const chartPath = join(rootDir, "Chart.yaml");
    if (!existsSync(chartPath)) {
      throw new Error(`No Chart.yaml found in ${rootDir}`);
    }
    const chartContent = readFileSync(chartPath, "utf-8");
    const chart: ChartYaml = parseYaml(chartContent) ?? {};

    const systemName = chart.name ?? basename(rootDir);

    // Read values.yaml (optional)
    const valuesPath = join(rootDir, "values.yaml");
    let values: ValuesYaml = {};
    if (existsSync(valuesPath)) {
      const valuesContent = readFileSync(valuesPath, "utf-8");
      values = parseYaml(valuesContent) ?? {};
    }

    // Build the main component from chart + values
    const image = values.image
      ? [values.image.repository, values.image.tag].filter(Boolean).join(":")
      : undefined;

    const ports =
      values.service?.port != null
        ? [
            {
              name: "http",
              port: values.service.port,
              protocol: "http" as const,
            },
          ]
        : [];

    // Map k8s resources → general compute (min/max)
    const valLimits = values.resources?.limits;
    const valRequests = values.resources?.requests;
    const compute =
      valLimits || valRequests
        ? {
            min: valRequests ? { cpu: valRequests.cpu, memory: valRequests.memory } : undefined,
            max: valLimits ? { cpu: valLimits.cpu, memory: valLimits.memory } : undefined,
          }
        : undefined;

    const componentType =
      chart.type === "library" ? "library" : "service";

    const component: CatalogComponent = {
      kind: "Component",
      metadata: {
        name: systemName,
        namespace: "default",
        description: chart.description,
      },
      spec: {
        type: componentType,
        lifecycle: "production",
        owner: "",
        system: systemName,
        image,
        ports,
        replicas: values.replicaCount,
        compute,
        isPublic: values.ingress?.enabled === true,
      },
    };

    const components: Record<string, CatalogComponent> = {
      [systemName]: component,
    };

    // Map chart dependencies
    const catalogResources: Record<string, CatalogResource> = {};
    if (chart.dependencies) {
      for (const dep of chart.dependencies) {
        const depName = dep.alias ?? dep.name;
        const infraType = inferInfraType(dep.name);

        if (infraType) {
          catalogResources[depName] = {
            kind: "Resource",
            metadata: {
              name: depName,
              namespace: "default",
            },
            spec: {
              type: infraType,
              lifecycle: "production",
              owner: "",
              system: systemName,
              image: dep.name,
              ports: [],
            },
          };
        } else {
          // Treat as a sub-component
          components[depName] = {
            kind: "Component",
            metadata: {
              name: depName,
              namespace: "default",
            },
            spec: {
              type: "service",
              lifecycle: "production",
              owner: "",
              system: systemName,
              ports: [],
            },
          };
        }
      }
    }

    const formatExtensions: Record<string, Record<string, unknown>> = {
      helm: {},
    };
    if (chart.appVersion) {
      formatExtensions.helm.appVersion = chart.appVersion;
    }
    if (chart.version) {
      formatExtensions.helm.chartVersion = chart.version;
    }

    const system: CatalogSystem = {
      kind: "System",
      metadata: {
        name: systemName,
        namespace: "default",
        description: chart.description,
      },
      spec: {
        owner: "",
        lifecycle: "production",
      },
      components,
      resources: catalogResources,
      connections: [],
      formatExtensions,
    };

    return {
      system,
      warnings,
      sourceVersion: chart.apiVersion,
    };
  }

  generate(
    system: CatalogSystem,
    _options?: { rootDir?: string },
  ): CatalogGenerateResult {
    const warnings: string[] = [];

    // Pick the first component as the main chart component
    const componentEntries = Object.entries(system.components);
    if (componentEntries.length > 1) {
      warnings.push(
        `Helm charts represent a single application. Only the first component will be used; ${componentEntries.length - 1} additional component(s) will be ignored.`,
      );
    }

    if (system.connections.length > 0) {
      warnings.push(
        "Connections cannot be represented in a Helm chart and will be lost.",
      );
    }

    const helmExt = system.formatExtensions?.helm ?? {};
    const appVersion =
      (helmExt.appVersion as string) ?? "1.0.0";
    const chartVersion =
      (helmExt.chartVersion as string) ?? "0.1.0";

    // Build Chart.yaml
    const chartYaml: Record<string, unknown> = {
      apiVersion: "v2",
      name: system.metadata.name,
      description: system.metadata.description ?? `A Helm chart for ${system.metadata.name}`,
      type: "application",
      version: chartVersion,
      appVersion: appVersion,
    };

    const chartContent = stringifyYaml(chartYaml, { lineWidth: 120 });

    // Build values.yaml from first component
    const valuesObj: Record<string, unknown> = {};

    if (componentEntries.length > 0) {
      const [, comp] = componentEntries[0];

      // replicas
      if (comp.spec.replicas != null) {
        valuesObj.replicaCount = comp.spec.replicas;
      } else {
        valuesObj.replicaCount = 1;
      }

      // image
      if (comp.spec.image) {
        const colonIdx = comp.spec.image.lastIndexOf(":");
        if (colonIdx > 0) {
          valuesObj.image = {
            repository: comp.spec.image.substring(0, colonIdx),
            tag: comp.spec.image.substring(colonIdx + 1),
            pullPolicy: "IfNotPresent",
          };
        } else {
          valuesObj.image = {
            repository: comp.spec.image,
            tag: "latest",
            pullPolicy: "IfNotPresent",
          };
        }
      }

      // service
      const httpPort = comp.spec.ports?.[0];
      if (httpPort) {
        valuesObj.service = {
          type: "ClusterIP",
          port: httpPort.port,
        };
      }

      // ingress
      valuesObj.ingress = {
        enabled: comp.spec.isPublic === true,
        hosts: [],
      };

      // compute → k8s resources (translate min/max → requests/limits)
      if (comp.spec.compute) {
        const res: Record<string, Record<string, string>> = {};
        if (comp.spec.compute.max) {
          const limits: Record<string, string> = {};
          if (comp.spec.compute.max.cpu) limits.cpu = comp.spec.compute.max.cpu;
          if (comp.spec.compute.max.memory) limits.memory = comp.spec.compute.max.memory;
          if (Object.keys(limits).length) res.limits = limits;
        }
        if (comp.spec.compute.min) {
          const requests: Record<string, string> = {};
          if (comp.spec.compute.min.cpu) requests.cpu = comp.spec.compute.min.cpu;
          if (comp.spec.compute.min.memory) requests.memory = comp.spec.compute.min.memory;
          if (Object.keys(requests).length) res.requests = requests;
        }
        if (Object.keys(res).length > 0) {
          valuesObj.resources = res;
        }
      }
    }

    const valuesContent = stringifyYaml(valuesObj, { lineWidth: 120 });

    return {
      files: {
        "Chart.yaml": chartContent,
        "values.yaml": valuesContent,
      },
      warnings,
    };
  }
}
