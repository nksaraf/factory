/**
 * Centralized shell command adapter for dx CLI.
 *
 * All subprocess spawning goes through this module, which handles:
 * - Secret env injection (local + remote)
 * - OS normalization (platform-specific command resolution)
 * - Path injection (DX_BIN, DX_CONFIG_DIR)
 * - Consistent env merging with clear precedence
 *
 * Precedence (lowest → highest):
 *   process.env → local secrets → remote secrets → explicit opts.env
 */

import { $ as bun$ } from "bun";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { platform } from "node:os";
import { configDir } from "@crustjs/store";
import { DxError } from "./dx-error.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShellOptions {
  cwd?: string;
  /** Explicit env overrides (highest priority). */
  env?: Record<string, string>;
  /** Skip secret injection entirely. */
  noSecrets?: boolean;
  /** Secret environment scope (default: "development"). */
  environment?: string;
  timeout?: number;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Secret env cache (singleton per dx process invocation)
// ---------------------------------------------------------------------------

let _secretEnvCache: Record<string, string> | null = null;
let _secretEnvPromise: Promise<Record<string, string>> | null = null;

/** Clear the cached secret env (useful for testing). */
export function clearSecretEnvCache(): void {
  _secretEnvCache = null;
  _secretEnvPromise = null;
}

/**
 * Resolve secrets from local store + remote Factory API.
 * Result is cached for the lifetime of the dx process.
 */
async function loadSecretEnv(
  environment?: string,
): Promise<Record<string, string>> {
  if (_secretEnvCache) return _secretEnvCache;
  if (_secretEnvPromise) return _secretEnvPromise;

  _secretEnvPromise = (async () => {
    const env: Record<string, string> = {};

    // 1. Local vars + secrets
    try {
      const { loadLocalVars } = await import(
        "../handlers/var-local-store.js"
      );
      Object.assign(env, loadLocalVars());
    } catch {
      // Local var store unavailable — continue
    }
    try {
      const { loadLocalSecrets } = await import(
        "../handlers/secret-local-store.js"
      );
      Object.assign(env, loadLocalSecrets());
    } catch {
      // Local secret store unavailable — continue
    }

    // 2. Remote vars + secrets (if connected to Factory)
    try {
      const { readConfig, resolveFactoryUrl } = await import("../config.js");
      const { getStoredBearerToken } = await import("../session-token.js");

      const config = await readConfig();
      const factoryUrl = resolveFactoryUrl(config);
      const token = await getStoredBearerToken();

      if (factoryUrl && token) {
        const resolveBody = JSON.stringify({
          environment: environment ?? "development",
        });
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        // Fetch vars and secrets in parallel (5s timeout to avoid hanging)
        const signal = AbortSignal.timeout(5_000);
        const [varsRes, secretsRes] = await Promise.all([
          fetch(`${factoryUrl}/api/v1/factory/vars/resolve`, {
            method: "POST",
            headers,
            body: resolveBody,
            signal,
          }),
          fetch(`${factoryUrl}/api/v1/factory/secrets/resolve`, {
            method: "POST",
            headers,
            body: resolveBody,
            signal,
          }),
        ]);

        // Vars first (lower precedence)
        if (varsRes.ok) {
          const data = (await varsRes.json()) as {
            vars?: Array<{ slug: string; value: string }>;
          };
          if (data.vars) {
            for (const v of data.vars) {
              env[v.slug] = v.value;
            }
          }
        }

        // Secrets override vars
        if (secretsRes.ok) {
          const data = (await secretsRes.json()) as {
            secrets?: Array<{ slug: string; value: string }>;
          };
          if (data.secrets) {
            for (const s of data.secrets) {
              env[s.slug] = s.value;
            }
          }
        }
      }
    } catch {
      // Remote unavailable — continue with local values only
    }

    _secretEnvCache = env;
    return env;
  })();

  return _secretEnvPromise;
}

/**
 * Synchronous version of secret loading (local only — no remote fetch).
 * Used by sync spawn paths where async isn't possible.
 */
function loadSecretEnvSync(): Record<string, string> {
  if (_secretEnvCache) return _secretEnvCache;

  const env: Record<string, string> = {};

  try {
    // Dynamic require for sync context
    const { loadLocalVars } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../handlers/var-local-store.js") as typeof import("../handlers/var-local-store.js");
    Object.assign(env, loadLocalVars());
  } catch {
    // Local var store unavailable — continue
  }
  try {
    const { loadLocalSecrets } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../handlers/secret-local-store.js") as typeof import("../handlers/secret-local-store.js");
    Object.assign(env, loadLocalSecrets());
  } catch {
    // Local secret store unavailable — continue
  }

  // Note: remote secrets not available in sync path.
  // If the async path ran first, _secretEnvCache includes remote secrets.
  return env;
}

// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------

const DX_CONFIG_DIR = configDir("dx");

/** Build the merged env for a subprocess. */
export async function resolveEnv(
  opts?: ShellOptions,
): Promise<Record<string, string>> {
  const base = { ...process.env } as Record<string, string>;

  // Inject dx-specific env vars
  base.DX_BIN = process.argv[1] ?? process.execPath;
  base.DX_CONFIG_DIR = DX_CONFIG_DIR;

  // Platform-normalized PATH
  if (platform() === "win32") {
    // Ensure common tool paths on Windows
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    base.PATH = base.PATH ?? `${systemRoot}\\system32;${systemRoot}`;
  }

  if (!opts?.noSecrets) {
    const secrets = await loadSecretEnv(opts?.environment);
    Object.assign(base, secrets);
  }

  // Explicit overrides have highest priority
  if (opts?.env) {
    Object.assign(base, opts.env);
  }

  return base;
}

/** Synchronous env resolution (local secrets only). */
export function resolveEnvSync(
  opts?: ShellOptions,
): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;

  base.DX_BIN = process.argv[1] ?? process.execPath;
  base.DX_CONFIG_DIR = DX_CONFIG_DIR;

  if (!opts?.noSecrets) {
    const secrets = loadSecretEnvSync();
    Object.assign(base, secrets);
  }

  if (opts?.env) {
    Object.assign(base, opts.env);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Async API (Bun shell)
// ---------------------------------------------------------------------------

/** Apply common options to a Bun shell expression. */
function apply(
  proc: ReturnType<typeof bun$>,
  cwd: string | undefined,
  env: Record<string, string>,
): ReturnType<typeof bun$> {
  if (cwd) proc = proc.cwd(normalizeCwd(cwd));
  proc = proc.env(env);
  return proc;
}

/** Normalize cwd for the current platform. */
function normalizeCwd(cwd: string): string {
  if (platform() === "win32") {
    return cwd.replace(/\//g, "\\");
  }
  return cwd;
}

/**
 * Run a command with output streamed to the terminal.
 * Prints the command being run (dimmed), then streams stdout/stderr.
 * Throws on non-zero exit.
 */
export async function shell(
  cmd: string[],
  opts?: ShellOptions,
): Promise<void> {
  const env = await resolveEnv(opts);
  console.log(`\x1b[2m$ ${cmd.join(" ")}\x1b[0m`);
  await apply(bun$`${cmd}`, opts?.cwd, env);
}

/**
 * Run a command and capture its output (no terminal streaming).
 * Does NOT throw on non-zero exit — check result.exitCode.
 */
export async function shellCapture(
  cmd: string[],
  opts?: ShellOptions,
): Promise<ShellResult> {
  const env = await resolveEnv(opts);
  const result = await apply(
    bun$`${cmd}`.quiet().throws(false),
    opts?.cwd,
    env,
  );
  return {
    exitCode: result.exitCode,
    stdout: result.text(),
    stderr: result.stderr.toString(),
  };
}

/**
 * Run a command, capture output, and throw on non-zero exit.
 */
export async function shellCaptureOrThrow(
  cmd: string[],
  opts?: ShellOptions,
): Promise<ShellResult> {
  const result = await shellCapture(cmd, opts);
  if (result.exitCode !== 0) {
    const detail =
      result.stderr || result.stdout || `exit code ${result.exitCode}`;
    throw new DxError(
      `${cmd[0]} ${cmd[1] ?? ""} failed: ${detail.trim()}`,
      {
        operation: `subprocess: ${cmd.join(" ")}`,
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(-500),
          stderr: result.stderr.slice(-500),
        },
        code: "SUBPROCESS_FAILED",
      },
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sync API
// ---------------------------------------------------------------------------

/**
 * Synchronous subprocess execution with env injection.
 * Uses spawnSync with explicit argument arrays (no shell interpolation).
 */
export function shellSync(
  cmd: string,
  args: string[],
  opts?: ShellOptions & { inherit?: boolean; verbose?: boolean },
): ShellResult {
  const env = resolveEnvSync(opts);

  if (opts?.verbose) {
    console.error(`$ ${cmd} ${args.join(" ")}`);
  }

  const spawnOpts: SpawnSyncOptions = {
    cwd: opts?.cwd ? normalizeCwd(opts.cwd) : undefined,
    timeout: opts?.timeout ?? 120_000,
    env,
  };

  if (opts?.inherit) {
    spawnOpts.stdio = "inherit";
  } else {
    spawnOpts.encoding = "utf8";
  }

  // On Windows, resolve .cmd/.bat extensions for npm/pnpm/etc
  let resolvedCmd = cmd;
  if (platform() === "win32" && !path.extname(cmd)) {
    for (const ext of [".cmd", ".bat", ".exe"]) {
      const candidate = cmd + ext;
      try {
        // Check if the command with extension exists in PATH
        const { status } = spawnSync("where", [candidate], {
          encoding: "utf8",
          timeout: 5_000,
        });
        if (status === 0) {
          resolvedCmd = candidate;
          break;
        }
      } catch {
        // continue
      }
    }
  }

  const proc = spawnSync(resolvedCmd, args, spawnOpts);

  const result: ShellResult = {
    exitCode: proc.status ?? 1,
    stdout: typeof proc.stdout === "string" ? proc.stdout : "",
    stderr: typeof proc.stderr === "string" ? proc.stderr : "",
  };

  if (opts?.verbose && !opts?.inherit) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }

  return result;
}
