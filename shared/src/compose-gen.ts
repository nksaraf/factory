import { join, resolve } from "node:path";

import { stringify } from "yaml";

import type { CatalogSystem } from "./catalog";
import type { DxComponentYaml, DxYaml } from "./config-schemas";
import type { ResolvedConnectionContext } from "./connection-context-schemas";

export interface ComposeHealthcheck {
  test: string[] | string;
  interval?: string;
  timeout?: string;
  retries?: number;
}

export interface ComposeService {
  image?: string;
  build?: { context: string; dockerfile?: string; args?: Record<string, string> };
  ports?: string[];
  environment?: Record<string, string>;
  depends_on?: string[] | Record<string, { condition?: string }>;
  volumes?: string[];
  command?: string | string[];
  healthcheck?: ComposeHealthcheck;
  labels?: Record<string, string>;
  platform?: string;
  restart?: string;
}

export interface ComposeOutput {
  services: Record<string, ComposeService>;
  volumes: Record<string, Record<string, never>>;
}

function serviceName(module: string, suffix: string): string {
  const base = `${module}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.replace(/-+/g, "-").replace(/^-|-$/g, "") || "service";
}

function depServiceName(depKey: string): string {
  return `dep-${depKey}`.toLowerCase().replace(/_/g, "-");
}

/** Generate docker-compose structure from dx module + component configs. */
export function generateCompose(
  rootDir: string,
  dxConfig: DxYaml,
  componentConfigs: Record<string, DxComponentYaml>,
  options?: {
    portOffset?: number;
    portMap?: Record<string, number>;
    componentFilter?: string[];
    connectionContext?: ResolvedConnectionContext;
  }
): ComposeOutput {
  const offset = options?.portOffset ?? 0;
  const filter = options?.componentFilter;
  const connCtx = options?.connectionContext;
  const remoteDepsSet = new Set(connCtx?.remoteDeps ?? []);
  const services: Record<string, ComposeService> = {};
  const volumes: Record<string, Record<string, never>> = {};

  const depKeys = Object.keys(dxConfig.resources);
  const depServiceNames = depKeys.map(depServiceName);

  // Only include local deps in compose; remote deps are tunneled/direct
  const localDepKeys = depKeys.filter((k) => !remoteDepsSet.has(k));
  const localDepServiceNames = localDepKeys.map(depServiceName);

  for (const depKey of localDepKeys) {
    const dep = dxConfig.resources[depKey];
    const sn = depServiceName(depKey);
    const depContainerPort = dep.container_port ?? dep.port;
    const svc: ComposeService = {
      image: dep.image,
      ports: [`${options?.portMap?.[sn] ?? (dep.port + offset)}:${depContainerPort}`],
      environment: { ...(dep.env ?? {}) },
    };
    const depVolumes = dep.volumes ?? [];
    if (depVolumes.length) {
      svc.volumes = [...depVolumes];
      for (const v of depVolumes) {
        const named = v.split(":")[0];
        if (named && !named.startsWith(".")) volumes[named] = {};
      }
    }
    if (dep.healthcheck) {
      svc.healthcheck = {
        test: ["CMD-SHELL", dep.healthcheck],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      };
    }
    services[sn] = svc;
  }

  const mod = dxConfig.module;
  for (const [compName, ref] of Object.entries(dxConfig.components)) {
    if (filter?.length && !filter.includes(compName)) continue;
    const compCfg = componentConfigs[compName] ?? {};
    const sn = serviceName(mod, compName);
    const contextAbs = resolve(rootDir, ref.path);
    const buildCtx = compCfg.build?.context ?? ".";
    const dockerfile = compCfg.build?.dockerfile ?? "Dockerfile";
    const buildContext = join(contextAbs, buildCtx);
    const useImage = Boolean(compCfg.image?.trim());

    // Build env vars: if connectionContext is available, use resolved values;
    // otherwise fall back to the default compose-local generation.
    let env: Record<string, string> = {};

    if (connCtx) {
      // Use resolved env vars from connection context
      for (const [key, entry] of Object.entries(connCtx.envVars)) {
        env[key] = entry.value;
      }
    } else {
      // Default: local dev env vars
      for (const [connKey, conn] of Object.entries(dxConfig.connections)) {
        if (conn.local_default) {
          env[conn.env_var] = conn.local_default;
        }
      }

      if (dxConfig.resources.postgres) {
        const p = dxConfig.resources.postgres;
        const host = depServiceName("postgres");
        const db = p.env.POSTGRES_DB ?? "postgres";
        const user = p.env.POSTGRES_USER ?? "postgres";
        const pass = p.env.POSTGRES_PASSWORD ?? "postgres";
        env.DATABASE_URL =
          env.DATABASE_URL ??
          `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/${encodeURIComponent(db)}`;
      }
      if (dxConfig.resources.redis) {
        const host = depServiceName("redis");
        env.REDIS_URL = env.REDIS_URL ?? `redis://${host}:6379`;
      }
    }

    const svc: ComposeService = useImage
      ? {
          image: compCfg.image!.trim(),
          environment: env,
          depends_on: localDepServiceNames.length ? [...localDepServiceNames] : undefined,
        }
      : {
          build: { context: buildContext, dockerfile },
          environment: env,
          depends_on: localDepServiceNames.length ? [...localDepServiceNames] : undefined,
        };

    if (ref.port != null) {
      const hostP = options?.portMap?.[sn] ?? (ref.port + offset);
      const containerP = ref.container_port ?? ref.port;
      svc.ports = [`${hostP}:${containerP}`];
    }

    if (compCfg.dev?.command) {
      svc.command = compCfg.dev.command.includes(" ")
        ? ["sh", "-c", compCfg.dev.command]
        : compCfg.dev.command;
    }

    if (compCfg.dev?.sync?.length) {
      svc.volumes = compCfg.dev.sync.map((m) => {
        const parts = m.split(":");
        if (parts.length >= 2) {
          return `${resolve(contextAbs, parts[0]!)}:${parts.slice(1).join(":")}`;
        }
        return m;
      });
    }

    if (ref.healthcheck) {
      const path = ref.healthcheck.startsWith("/")
        ? ref.healthcheck
        : `/${ref.healthcheck}`;
      const innerPort =
        ref.container_port ?? ref.port ?? (useImage ? 80 : 8080);
      svc.healthcheck = {
        test: [
          "CMD-SHELL",
          `wget -qO- http://127.0.0.1:${innerPort}${path} >/dev/null || exit 1`,
        ],
        interval: "10s",
        timeout: "3s",
        retries: 3,
      };
    }

    services[sn] = svc;
  }

  return { services, volumes };
}

/**
 * Generate docker-compose structure from a CatalogSystem.
 * This is the catalog-native entry point; the DxYaml version above
 * is kept for backward compatibility.
 */
export function generateComposeFromCatalog(
  catalog: CatalogSystem,
  options?: {
    portOffset?: number;
    portMap?: Record<string, number>;
    componentFilter?: string[];
    connectionContext?: ResolvedConnectionContext;
  }
): ComposeOutput {
  const offset = options?.portOffset ?? 0;
  const filter = options?.componentFilter;
  const connCtx = options?.connectionContext;
  const remoteDepsSet = new Set(connCtx?.remoteDeps ?? []);
  const services: Record<string, ComposeService> = {};
  const volumes: Record<string, Record<string, never>> = {};

  const systemName = catalog.metadata.name;

  // Resource services (infrastructure dependencies)
  const allResKeys = Object.keys(catalog.resources);
  const localResKeys = allResKeys.filter((k) => !remoteDepsSet.has(k));
  const localResServiceNames = localResKeys.map(depServiceName);

  for (const resKey of localResKeys) {
    const res = catalog.resources[resKey];
    const sn = depServiceName(resKey);
    const hostPort = res.spec.ports?.[0]?.port ?? 0;
    const containerPort = res.spec.containerPort ?? hostPort;
    const svc: ComposeService = {
      image: res.spec.image,
      ports: [`${options?.portMap?.[sn] ?? (hostPort + offset)}:${containerPort}`],
      environment: { ...(res.spec.environment ?? {}) },
    };
    const resVolumes = res.spec.volumes ?? [];
    if (resVolumes.length) {
      svc.volumes = resVolumes.map((v) => {
        if (typeof v === "string") return v;
        // CatalogVolume → compose volume string
        const src = v.hostPath ?? v.name ?? "";
        const ro = v.readOnly ? ":ro" : "";
        return src ? `${src}:${v.containerPath}${ro}` : v.containerPath;
      });
      for (const v of svc.volumes) {
        const named = v.split(":")[0];
        if (named && !named.startsWith(".") && !named.startsWith("/")) volumes[named] = {};
      }
    }
    if (res.spec.healthcheck) {
      svc.healthcheck = {
        test: ["CMD-SHELL", res.spec.healthcheck],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      };
    }
    services[sn] = svc;
  }

  // Component services
  for (const [compName, comp] of Object.entries(catalog.components)) {
    if (filter?.length && !filter.includes(compName)) continue;
    const sn = serviceName(systemName, compName);

    // Build env vars
    let env: Record<string, string> = {};
    if (connCtx) {
      for (const [key, entry] of Object.entries(connCtx.envVars)) {
        env[key] = entry.value;
      }
    } else {
      // Default: local dev env vars from connections
      for (const conn of catalog.connections) {
        if (conn.localDefault) {
          env[conn.envVar] = conn.localDefault;
        }
      }
      // Auto-generate DATABASE_URL/REDIS_URL from resources
      const pgRes = catalog.resources.postgres;
      if (pgRes) {
        const pgEnv = pgRes.spec.environment ?? {};
        const host = depServiceName("postgres");
        const db = pgEnv.POSTGRES_DB ?? "postgres";
        const user = pgEnv.POSTGRES_USER ?? "postgres";
        const pass = pgEnv.POSTGRES_PASSWORD ?? "postgres";
        env.DATABASE_URL =
          env.DATABASE_URL ??
          `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/${encodeURIComponent(db)}`;
      }
      const redisRes = catalog.resources.redis;
      if (redisRes) {
        const host = depServiceName("redis");
        env.REDIS_URL = env.REDIS_URL ?? `redis://${host}:6379`;
      }
    }

    const useImage = Boolean(comp.spec.image?.trim());
    const buildCtx = comp.spec.build?.context ?? ".";
    const dockerfile = comp.spec.build?.dockerfile ?? "Dockerfile";

    const svc: ComposeService = useImage
      ? {
          image: comp.spec.image!.trim(),
          environment: env,
          depends_on: localResServiceNames.length ? [...localResServiceNames] : undefined,
        }
      : {
          build: { context: buildCtx, dockerfile },
          environment: env,
          depends_on: localResServiceNames.length ? [...localResServiceNames] : undefined,
        };

    const httpPort = comp.spec.ports?.find((p) => p.name === "http" || p.name === "default");
    if (httpPort) {
      const hostP = options?.portMap?.[sn] ?? (httpPort.port + offset);
      const containerP = httpPort.port;
      svc.ports = [`${hostP}:${containerP}`];
    }

    if (comp.spec.dev?.command) {
      svc.command = comp.spec.dev.command.includes(" ")
        ? ["sh", "-c", comp.spec.dev.command]
        : comp.spec.dev.command;
    }

    if (comp.spec.dev?.sync?.length) {
      svc.volumes = comp.spec.dev.sync.map((m) => {
        const parts = m.split(":");
        if (parts.length >= 2) {
          return `${resolve(buildCtx, parts[0]!)}:${parts.slice(1).join(":")}`;
        }
        return m;
      });
    }

    const readyCheck = comp.spec.healthchecks?.ready ?? comp.spec.healthchecks?.live;
    if (readyCheck?.http) {
      const path = readyCheck.http.path.startsWith("/")
        ? readyCheck.http.path
        : `/${readyCheck.http.path}`;
      const innerPort = httpPort?.port ?? (useImage ? 80 : 8080);
      svc.healthcheck = {
        test: [
          "CMD-SHELL",
          `wget -qO- http://127.0.0.1:${innerPort}${path} >/dev/null || exit 1`,
        ],
        interval: "10s",
        timeout: "3s",
        retries: 3,
      };
    }

    services[sn] = svc;
  }

  return { services, volumes };
}

export function composeToYaml(compose: ComposeOutput): string {
  return stringify(
    {
      services: compose.services,
      ...(Object.keys(compose.volumes).length
        ? { volumes: compose.volumes }
        : {}),
    },
    { lineWidth: 120 }
  );
}
