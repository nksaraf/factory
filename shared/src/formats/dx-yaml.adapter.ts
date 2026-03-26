/**
 * dx-yaml format adapter.
 *
 * Converts between dx.yaml (DxYaml + DxComponentYaml) and CatalogSystem.
 * This is the bridge between the flat dx.yaml config format and the
 * Backstage-aligned catalog model used internally.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type {
  CatalogComponent,
  CatalogConnection,
  CatalogResource,
  CatalogSystem,
} from "../catalog";
import type {
  CatalogFormatAdapter,
  CatalogGenerateResult,
  CatalogParseResult,
} from "../catalog-registry";
import {
  loadFullConfig,
  findDxYaml,
} from "../config-loader";
import type {
  DxComponentYaml,
  DxYaml,
  DxComponentRef,
} from "../config-schemas";

// ─── Image → resource type heuristics ────────────────────────

const IMAGE_TYPE_MAP: [RegExp, string][] = [
  [/^postgres/i, "database"],
  [/^postgis/i, "database"],
  [/^timescale/i, "database"],
  [/^mysql/i, "database"],
  [/^mariadb/i, "database"],
  [/^clickhouse/i, "database"],
  [/^sqlite/i, "database"],
  [/^redis/i, "cache"],
  [/^valkey/i, "cache"],
  [/^memcached/i, "cache"],
  [/^rabbitmq/i, "queue"],
  [/^nats/i, "queue"],
  [/^kafka/i, "queue"],
  [/^minio/i, "storage"],
  [/^elasticsearch/i, "search"],
  [/^opensearch/i, "search"],
  [/^meilisearch/i, "search"],
  [/^traefik/i, "gateway"],
  [/^nginx/i, "gateway"],
  [/^envoy/i, "gateway"],
];

function inferResourceType(image: string): string {
  for (const [pattern, type] of IMAGE_TYPE_MAP) {
    if (pattern.test(image)) return type;
  }
  return "database"; // safe default for infra deps
}

// ─── dx.yaml → CatalogSystem ────────────────────────────────

function componentRefToComponentType(ref: DxComponentRef): string {
  if (ref.worker) return "worker";
  return "service";
}

function dxComponentToCatalog(
  name: string,
  ref: DxComponentRef,
  compCfg: DxComponentYaml,
  systemName: string,
  rootDir: string,
): CatalogComponent {
  const ports = ref.port != null
    ? [{ name: "http", port: ref.port, protocol: "http" as const }]
    : [];

  const build = compCfg.build
    ? {
        context: resolve(rootDir, ref.path, compCfg.build.context),
        dockerfile: compCfg.build.dockerfile,
      }
    : { context: resolve(rootDir, ref.path) };

  return {
    kind: "Component",
    metadata: { name, namespace: "default" },
    spec: {
      type: componentRefToComponentType(ref),
      lifecycle: "production",
      owner: "",
      system: systemName,
      image: compCfg.image,
      build,
      ports,
      healthchecks: ref.healthcheck
        ? {
            ready: {
              http: { path: ref.healthcheck, port: "http" },
            },
          }
        : undefined,
      environment: {},
      stateful: false,
      isPublic: false,
      dev: compCfg.dev
        ? {
            command: compCfg.dev.command,
            sync: compCfg.dev.sync,
          }
        : undefined,
      test: compCfg.test,
      lint: compCfg.lint,
      runtime: ref.type,
    },
  };
}

function dxResourceToCatalog(
  name: string,
  dep: DxYaml["resources"][string],
  systemName: string,
): CatalogResource {
  const ports = [{ name: "default", port: dep.port, protocol: "tcp" as const }];

  return {
    kind: "Resource",
    metadata: { name, namespace: "default" },
    spec: {
      type: inferResourceType(dep.image),
      lifecycle: "production",
      owner: "",
      system: systemName,
      image: dep.image,
      ports,
      containerPort: dep.container_port,
      environment: dep.env,
      volumes: dep.volumes,
      healthcheck: dep.healthcheck,
    },
  };
}

function dxConnectionToCatalog(
  name: string,
  conn: DxYaml["connections"][string],
): CatalogConnection {
  return {
    name,
    targetModule: conn.module,
    targetComponent: conn.component,
    envVar: conn.env_var,
    localDefault: conn.local_default,
    optional: conn.optional,
  };
}

export function dxYamlToCatalogSystem(
  rootDir: string,
  dxConfig: DxYaml,
  componentConfigs: Record<string, DxComponentYaml>,
): CatalogSystem {
  const systemName = dxConfig.module;

  const components: Record<string, CatalogComponent> = {};
  for (const [name, ref] of Object.entries(dxConfig.components)) {
    const compCfg = componentConfigs[name] ?? {};
    components[name] = dxComponentToCatalog(name, ref, compCfg, systemName, rootDir);
  }

  const resources: Record<string, CatalogResource> = {};
  for (const [name, dep] of Object.entries(dxConfig.resources)) {
    resources[name] = dxResourceToCatalog(name, dep, systemName);
  }

  const connections: CatalogConnection[] = Object.entries(dxConfig.connections).map(
    ([name, conn]) => dxConnectionToCatalog(name, conn),
  );

  return {
    kind: "System",
    metadata: {
      name: systemName,
      namespace: "default",
    },
    spec: {
      owner: dxConfig.team,
      lifecycle: "production",
    },
    components,
    resources,
    connections,
    formatExtensions: {
      "dx-yaml": {
        rootDir,
      },
    },
  };
}

// ─── CatalogSystem → dx.yaml (generate) ─────────────────────

function catalogComponentToDxRef(
  comp: CatalogComponent,
): { ref: Partial<DxComponentRef>; compCfg: DxComponentYaml } {
  const httpPort = comp.spec.ports?.find((p) => p.name === "http");
  const ref: Record<string, unknown> = {
    path: comp.spec.build?.context ?? ".",
  };
  if (httpPort) ref.port = httpPort.port;
  if (comp.spec.type === "worker") ref.worker = true;
  const hcPath = comp.spec.healthchecks?.ready?.http?.path ?? comp.spec.healthchecks?.live?.http?.path;
  if (hcPath) ref.healthcheck = hcPath;
  if (comp.spec.runtime) ref.type = comp.spec.runtime;

  const compCfg: DxComponentYaml = {};
  if (comp.spec.image) compCfg.image = comp.spec.image;
  if (comp.spec.build) {
    compCfg.build = {
      context: comp.spec.build.context,
      dockerfile: comp.spec.build.dockerfile ?? "Dockerfile",
    };
  }
  if (comp.spec.dev) {
    compCfg.dev = {
      command: comp.spec.dev.command,
      sync: comp.spec.dev.sync ?? [],
    };
  }
  if (comp.spec.test) compCfg.test = comp.spec.test;
  if (comp.spec.lint) compCfg.lint = comp.spec.lint;

  return { ref: ref as Partial<DxComponentRef>, compCfg };
}

// ─── Adapter ─────────────────────────────────────────────────

export class DxYamlFormatAdapter implements CatalogFormatAdapter {
  readonly format = "dx-yaml" as const;

  detect(rootDir: string): boolean {
    return existsSync(join(rootDir, "dx.yaml"));
  }

  parse(rootDir: string): CatalogParseResult {
    const dxYamlPath = findDxYaml(rootDir);
    if (!dxYamlPath) {
      throw new Error(`No dx.yaml found in ${rootDir}`);
    }

    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    return {
      system,
      warnings: [],
      sourceVersion: "1",
    };
  }

  generate(
    system: CatalogSystem,
    _options?: { rootDir?: string },
  ): CatalogGenerateResult {
    const warnings: string[] = [];

    // Build dx.yaml content
    const components: Record<string, Record<string, unknown>> = {};
    for (const [name, comp] of Object.entries(system.components)) {
      const { ref } = catalogComponentToDxRef(comp);
      components[name] = ref;
    }

    const resources: Record<string, Record<string, unknown>> = {};
    for (const [name, res] of Object.entries(system.resources)) {
      const r: Record<string, unknown> = {
        image: res.spec.image,
        port: res.spec.ports?.[0]?.port ?? 0,
      };
      if (res.spec.containerPort) r.container_port = res.spec.containerPort;
      if (res.spec.environment && Object.keys(res.spec.environment).length) {
        r.env = res.spec.environment;
      }
      if (res.spec.volumes?.length) r.volumes = res.spec.volumes;
      if (res.spec.healthcheck) r.healthcheck = res.spec.healthcheck;
      resources[name] = r;
    }

    const connections: Record<string, Record<string, unknown>> = {};
    for (const conn of system.connections) {
      connections[conn.name] = {
        module: conn.targetModule,
        component: conn.targetComponent,
        env_var: conn.envVar,
        ...(conn.localDefault ? { local_default: conn.localDefault } : {}),
        ...(conn.optional ? { optional: true } : {}),
      };
    }

    const dxYaml = {
      module: system.metadata.name,
      team: system.spec.owner,
      components,
      resources,
      connections,
    };

    // We serialize to YAML string
    const content = stringifyYaml(dxYaml, { lineWidth: 120 });

    return {
      files: { "dx.yaml": content },
      warnings,
    };
  }
}
