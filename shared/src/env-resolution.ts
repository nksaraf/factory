import { createHash } from "node:crypto";

import type { DxYaml } from "./config-schemas";
import type {
  NormalizedProfileEntry,
  ResolvedConnectionContext,
  ResolvedEnvEntry,
  TunnelBackendKind,
  TunnelSpec,
} from "./connection-context-schemas";

export interface EnvResolutionInput {
  dxConfig: DxYaml;
  tierOverlay?: Record<string, string>;
  connectionOverrides?: Record<string, NormalizedProfileEntry>;
  cliEnvFlags?: Record<string, string>;
}

/**
 * Compute a deterministic local port from target+name.
 * Range: 15000–15999 (1000 slots). Stable across restarts.
 */
export function computeDeterministicPort(
  target: string,
  name: string,
  basePort = 15000,
  range = 1000
): number {
  const hash = createHash("sha256")
    .update(`${target}:${name}`)
    .digest();
  const num = hash.readUInt32BE(0);
  return basePort + (num % range);
}

/**
 * Categorize dependencies as local (spin up as containers) or remote (tunneled/direct).
 */
export function categorizeDeps(
  dxConfig: DxYaml,
  connectionOverrides: Record<string, NormalizedProfileEntry>
): { local: string[]; remote: string[] } {
  const allDeps = Object.keys(dxConfig.resources);
  const allConns = Object.keys(dxConfig.connections);
  const overrideKeys = new Set(Object.keys(connectionOverrides));

  const local: string[] = [];
  const remote: string[] = [];

  for (const dep of allDeps) {
    if (overrideKeys.has(dep)) {
      remote.push(dep);
    } else {
      local.push(dep);
    }
  }

  // Module connections that are overridden are also "remote"
  for (const conn of allConns) {
    if (overrideKeys.has(conn)) {
      remote.push(conn);
    }
  }

  return { local, remote };
}

/**
 * Build Layer 1 defaults from dx.yaml dependencies and connections.
 * Mirrors the logic in compose-gen.ts for DATABASE_URL/REDIS_URL auto-generation.
 */
function buildLayer1Defaults(dxConfig: DxYaml): Record<string, ResolvedEnvEntry> {
  const env: Record<string, ResolvedEnvEntry> = {};

  // Connection local_defaults
  for (const [connKey, conn] of Object.entries(dxConfig.connections)) {
    if (conn.local_default) {
      env[conn.env_var] = {
        value: conn.local_default,
        source: "default",
        sourceDetail: `connections.${connKey}.local_default`,
      };
    }
  }

  // Auto-generate DATABASE_URL from postgres dependency
  if (dxConfig.resources.postgres) {
    const p = dxConfig.resources.postgres;
    const db = p.env.POSTGRES_DB ?? "postgres";
    const user = p.env.POSTGRES_USER ?? "postgres";
    const pass = p.env.POSTGRES_PASSWORD ?? "postgres";
    if (!env.DATABASE_URL) {
      env.DATABASE_URL = {
        value: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@localhost:${p.port}/${encodeURIComponent(db)}`,
        source: "default",
        sourceDetail: "resources.postgres (auto-generated)",
      };
    }
  }

  // Auto-generate REDIS_URL from redis dependency
  if (dxConfig.resources.redis) {
    const r = dxConfig.resources.redis;
    if (!env.REDIS_URL) {
      env.REDIS_URL = {
        value: `redis://localhost:${r.port}`,
        source: "default",
        sourceDetail: "resources.redis (auto-generated)",
      };
    }
  }

  return env;
}

/**
 * Resolve the 4-layer environment variable stack.
 *
 * Layer 1: Component defaults (dx.yaml dependencies + connections local_default)
 * Layer 2: Tier overlay env vars
 * Layer 3: Connection overrides (remote deps → tunnel specs or direct connection strings)
 * Layer 4: Explicit CLI --env flags
 */
export function resolveEnvVars(input: EnvResolutionInput): ResolvedConnectionContext {
  const { dxConfig, tierOverlay, connectionOverrides = {}, cliEnvFlags } = input;

  // Layer 1: defaults
  const envVars: Record<string, ResolvedEnvEntry> = buildLayer1Defaults(dxConfig);

  // Layer 2: tier overlay
  if (tierOverlay) {
    for (const [key, value] of Object.entries(tierOverlay)) {
      envVars[key] = {
        value,
        source: "tier",
        sourceDetail: "tier overlay",
      };
    }
  }

  // Layer 3: connection overrides
  const tunnels: TunnelSpec[] = [];
  const { local, remote } = categorizeDeps(dxConfig, connectionOverrides);

  for (const [name, override] of Object.entries(connectionOverrides)) {
    const dep = dxConfig.resources[name];
    const conn = dxConfig.connections[name];

    if (dep) {
      // Infrastructure dependency (postgres, redis, etc.)
      const localPort = computeDeterministicPort(override.target, name);
      const remotePort = dep.container_port ?? dep.port;

      const tunnel: TunnelSpec = {
        name,
        localPort,
        remoteHost: `${override.target}-${name}`,
        remotePort,
        backend: override.backend as TunnelBackendKind,
      };

      // For direct backend, use tier overlay connection string if available
      if (override.backend === "direct" && tierOverlay) {
        const envKey = name === "postgres" ? "DATABASE_URL" : name === "redis" ? "REDIS_URL" : undefined;
        if (envKey && tierOverlay[envKey]) {
          tunnel.connectionString = tierOverlay[envKey];
          envVars[envKey] = {
            value: tierOverlay[envKey],
            source: "connection",
            sourceDetail: `${name} → ${override.target} (direct)`,
          };
        }
      }

      // For non-direct backends, env points at the tunnel's local port
      if (override.backend !== "direct") {
        if (name === "postgres") {
          const p = dxConfig.resources.postgres!;
          const db = p.env.POSTGRES_DB ?? "postgres";
          const user = p.env.POSTGRES_USER ?? "postgres";
          const pass = p.env.POSTGRES_PASSWORD ?? "postgres";
          envVars.DATABASE_URL = {
            value: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@localhost:${localPort}/${encodeURIComponent(db)}`,
            source: "connection",
            sourceDetail: `${name} → ${override.target} (tunnel :${localPort})`,
          };
        } else if (name === "redis") {
          envVars.REDIS_URL = {
            value: `redis://localhost:${localPort}`,
            source: "connection",
            sourceDetail: `${name} → ${override.target} (tunnel :${localPort})`,
          };
        }
      }

      tunnels.push(tunnel);
    } else if (conn) {
      // Module connection (auth, analytics, etc.)
      const localPort = computeDeterministicPort(override.target, name);

      const tunnel: TunnelSpec = {
        name,
        localPort,
        remoteHost: `${override.target}-${conn.component}`,
        remotePort: 8080,
        backend: override.backend as TunnelBackendKind,
      };

      if (override.backend === "direct" && tierOverlay?.[conn.env_var]) {
        tunnel.connectionString = tierOverlay[conn.env_var];
        envVars[conn.env_var] = {
          value: tierOverlay[conn.env_var],
          source: "connection",
          sourceDetail: `${name} → ${override.target} (direct)`,
        };
      } else if (override.backend !== "direct") {
        envVars[conn.env_var] = {
          value: `http://localhost:${localPort}`,
          source: "connection",
          sourceDetail: `${name} → ${override.target} (tunnel :${localPort})`,
        };
      }

      tunnels.push(tunnel);
    }
  }

  // Layer 4: explicit CLI env flags
  if (cliEnvFlags) {
    for (const [key, value] of Object.entries(cliEnvFlags)) {
      envVars[key] = {
        value,
        source: "cli",
        sourceDetail: "--env flag",
      };
    }
  }

  return {
    envVars,
    tunnels,
    remoteDeps: remote,
    localDeps: local,
  };
}

/** Format resolved env vars for display with source annotations. */
export function formatResolvedEnv(
  envVars: Record<string, ResolvedEnvEntry>,
  mode: "annotated" | "export" = "annotated"
): string {
  return Object.entries(envVars)
    .map(([key, entry]) => {
      if (mode === "export") {
        return `export ${key}=${entry.value}`;
      }
      const source = entry.sourceDetail ?? entry.source;
      return `${key}=${entry.value}  # ← ${source}`;
    })
    .join("\n");
}
