import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** factory/cli root (directory containing `bin/`). */
export const CLI_ROOT = path.join(__dirname, "..", "..");

export const RUN_JS = path.join(CLI_ROOT, "bin", "run.js");

export type RunDxResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function runDx(
  args: string[],
  options: { home: string; env?: NodeJS.ProcessEnv; input?: string }
): RunDxResult {
  const result = spawnSync("bun", [RUN_JS, ...args], {
    cwd: CLI_ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...options.env, HOME: options.home },
    input: options.input,
    // Avoid a piped stdin with no consumer (Bun/Crust can block on readline).
    stdio:
      options.input !== undefined
        ? "pipe"
        : (["ignore", "pipe", "pipe"] as const),
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
