import { spawnSync, type SpawnSyncOptions } from "node:child_process";

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

/**
 * Run a subprocess and return structured output.
 * Throws on non-zero exit only if `throwOnError` is true.
 */
export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
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

/** Run and throw on non-zero exit. */
export function runOrThrow(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): RunResult {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `exit code ${result.status}`;
    throw new Error(`${cmd} ${args[0]} failed: ${detail.trim()}`);
  }
  return result;
}

/** Run with inherited stdio (interactive). */
export function runInherit(
  cmd: string,
  args: string[],
  opts: Omit<RunOptions, "inherit"> = {}
): number {
  const result = run(cmd, args, { ...opts, inherit: true });
  return result.status;
}
