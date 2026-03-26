/**
 * Process utilities for running shell commands.
 *
 * Two APIs:
 *
 * **Async (preferred)** — uses Bun shell, streams output by default:
 *   exec()          — stream output to terminal, throw on error
 *   capture()       — capture output silently, return result
 *   captureOrThrow() — capture + throw on non-zero exit
 *
 * **Sync (legacy)** — uses node:child_process spawnSync:
 *   run(), runOrThrow(), runInherit()
 *   @deprecated Prefer the async API for new code.
 */

import { $ as bun$ } from "bun";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

// ---------------------------------------------------------------------------
// Async API (Bun shell) — preferred for new code
// ---------------------------------------------------------------------------

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface CaptureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Apply common options to a Bun shell expression. */
function apply(
  proc: ReturnType<typeof bun$>,
  opts: ExecOptions,
): ReturnType<typeof bun$> {
  if (opts.cwd) proc = proc.cwd(opts.cwd);
  if (opts.env) proc = proc.env({ ...process.env, ...opts.env });
  return proc;
}

/**
 * Run a command with output streamed to the terminal.
 * Prints the command being run (dimmed), then streams stdout/stderr.
 * Throws on non-zero exit.
 *
 * Use for mutative or long-running commands:
 *   await exec(["git", "clone", "--progress", url, dest], { cwd });
 *   await exec(["pnpm", "install"], { cwd: root });
 */
export async function exec(
  cmd: string[],
  opts: ExecOptions = {},
): Promise<void> {
  console.log(`\x1b[2m$ ${cmd.join(" ")}\x1b[0m`);
  await apply(bun$`${cmd}`, opts);
}

/**
 * Run a command and capture its output (no terminal streaming).
 * Does NOT throw on non-zero exit — check result.exitCode.
 *
 * Use for read-only / query commands:
 *   const { stdout } = await capture(["git", "rev-parse", "HEAD"], { cwd });
 */
export async function capture(
  cmd: string[],
  opts: ExecOptions = {},
): Promise<CaptureResult> {
  const result = await apply(bun$`${cmd}`.quiet().throws(false), opts);
  return {
    exitCode: result.exitCode,
    stdout: result.text(),
    stderr: result.stderr.toString(),
  };
}

/**
 * Run a command, capture output, and throw on non-zero exit.
 *
 *   const { stdout } = await captureOrThrow(["git", "rev-parse", "HEAD"], { cwd });
 */
export async function captureOrThrow(
  cmd: string[],
  opts: ExecOptions = {},
): Promise<CaptureResult> {
  const result = await capture(cmd, opts);
  if (result.exitCode !== 0) {
    const detail =
      result.stderr || result.stdout || `exit code ${result.exitCode}`;
    throw new Error(
      `${cmd[0]} ${cmd[1] ?? ""} failed: ${detail.trim()}`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sync API (legacy) — kept for callers that haven't migrated yet
// ---------------------------------------------------------------------------

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Print command + output to stderr (default: false). */
  verbose?: boolean;
  /** Inherit parent stdio instead of capturing (default: false). */
  inherit?: boolean;
  /** Timeout in ms (default: 120_000). */
  timeout?: number;
}

/** @deprecated Use `exec` or `capture` instead. */
export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): RunResult {
  if (opts.verbose) {
    console.error(`$ ${cmd} ${args.join(" ")}`);
  }

  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 120_000,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  };

  if (opts.inherit) {
    spawnOpts.stdio = "inherit";
  } else {
    spawnOpts.encoding = "utf8";
  }

  const proc = spawnSync(cmd, args, spawnOpts);

  const result: RunResult = {
    status: proc.status ?? 1,
    stdout: typeof proc.stdout === "string" ? proc.stdout : "",
    stderr: typeof proc.stderr === "string" ? proc.stderr : "",
  };

  if (opts.verbose && !opts.inherit) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }

  return result;
}

/** @deprecated Use `exec` or `captureOrThrow` instead. */
export function runOrThrow(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): RunResult {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    const detail =
      result.stderr || result.stdout || `exit code ${result.status}`;
    throw new Error(`${cmd} ${args[0]} failed: ${detail.trim()}`);
  }
  return result;
}

/** @deprecated Use `exec` instead. */
export function runInherit(
  cmd: string,
  args: string[],
  opts: Omit<RunOptions, "inherit"> = {},
): number {
  const result = run(cmd, args, { ...opts, inherit: true });
  return result.status;
}
