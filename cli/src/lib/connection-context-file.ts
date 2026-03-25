import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { ResolvedConnectionContext, ResolvedEnvEntry, TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

const CONTEXT_FILE = join(".dx", ".connection-context.yaml");
const ENV_FILE_PREFIX = join(".dx", ".env.");

/** Write the resolved connection context to .dx/.connection-context.yaml */
export function writeConnectionContext(
  rootDir: string,
  ctx: ResolvedConnectionContext
): void {
  const path = join(rootDir, CONTEXT_FILE);
  mkdirSync(dirname(path), { recursive: true });

  const serializable = {
    envVars: Object.fromEntries(
      Object.entries(ctx.envVars).map(([k, v]) => [k, { value: v.value, source: v.source, sourceDetail: v.sourceDetail }])
    ),
    tunnels: ctx.tunnels,
    remoteDeps: ctx.remoteDeps,
    localDeps: ctx.localDeps,
  };

  writeFileSync(path, stringifyYaml(serializable), "utf8");
}

/** Read the connection context from .dx/.connection-context.yaml */
export function readConnectionContext(
  rootDir: string
): ResolvedConnectionContext | null {
  const path = join(rootDir, CONTEXT_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as {
      envVars?: Record<string, ResolvedEnvEntry>;
      tunnels?: TunnelSpec[];
      remoteDeps?: string[];
      localDeps?: string[];
    };
    return {
      envVars: raw.envVars ?? {},
      tunnels: raw.tunnels ?? [],
      remoteDeps: raw.remoteDeps ?? [],
      localDeps: raw.localDeps ?? [],
    };
  } catch {
    return null;
  }
}

/** Delete the connection context file. */
export function cleanupConnectionContext(rootDir: string): void {
  const path = join(rootDir, CONTEXT_FILE);
  if (existsSync(path)) rmSync(path, { force: true });
}

/** Write a .env file for a target (.dx/.env.{target}). */
export function writeEnvFile(
  rootDir: string,
  target: string,
  envVars: Record<string, ResolvedEnvEntry>
): void {
  const path = join(rootDir, `${ENV_FILE_PREFIX}${target}`);
  mkdirSync(dirname(path), { recursive: true });
  const lines = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v.value}`)
    .join("\n");
  writeFileSync(path, lines + "\n", "utf8");
}
