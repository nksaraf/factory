import { join, resolve } from "node:path";

import { stringify } from "yaml";

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
  build?: { context: string; dockerfile?: string };
  ports?: string[];
  environment?: Record<string, string>;
  depends_on?: string[];
  volumes?: string[];
  command?: string | string[];
  healthcheck?: ComposeHealthcheck;
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

  const depKeys = Object.keys(dxConfig.dependencies);
  const depServiceNames = depKeys.map(depServiceName);

  // Only include local deps in compose; remote deps are tunneled/direct
  const localDepKeys = depKeys.filter((k) => !remoteDepsSet.has(k));
  const localDepServiceNames = localDepKeys.map(depServiceName);

  for (const depKey of localDepKeys) {
    const dep = dxConfig.dependencies[depKey];
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

      if (dxConfig.dependencies.postgres) {
        const p = dxConfig.dependencies.postgres;
        const host = depServiceName("postgres");
        const db = p.env.POSTGRES_DB ?? "postgres";
        const user = p.env.POSTGRES_USER ?? "postgres";
        const pass = p.env.POSTGRES_PASSWORD ?? "postgres";
        env.DATABASE_URL =
          env.DATABASE_URL ??
          `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/${encodeURIComponent(db)}`;
      }
      if (dxConfig.dependencies.redis) {
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
