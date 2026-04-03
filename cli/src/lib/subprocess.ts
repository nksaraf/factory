/**
 * Process utilities for running shell commands.
 *
 * All functions delegate to the centralized shell adapter (`./shell.ts`)
 * which handles secret env injection, OS normalization, and path injection.
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

import {
  shell,
  shellCapture,
  shellCaptureOrThrow,
  shellSync,
  type ShellOptions,
  type ShellResult,
} from "./shell.js";

// ---------------------------------------------------------------------------
// Async API — delegates to shell adapter
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
  await shell(cmd, toShellOpts(opts));
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
  return shellCapture(cmd, toShellOpts(opts));
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
  return shellCaptureOrThrow(cmd, toShellOpts(opts));
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

/** @deprecated Use the async API instead. */
export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): RunResult {
  const result = shellSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    verbose: opts.verbose,
    inherit: opts.inherit,
    timeout: opts.timeout,
  });
  return {
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** @deprecated Use the async API instead. */
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

/** @deprecated Use the async API instead. */
export function runInherit(
  cmd: string,
  args: string[],
  opts: Omit<RunOptions, "inherit"> = {},
): number {
  const result = run(cmd, args, { ...opts, inherit: true });
  return result.status;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toShellOpts(opts: ExecOptions): ShellOptions {
  return {
    cwd: opts.cwd,
    env: opts.env,
  };
}
