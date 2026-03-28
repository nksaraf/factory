import { spawnSync } from "node:child_process";

export interface ToolRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/**
 * Run a quality tool as a subprocess and collect its output.
 */
export function runTool(
  command: string,
  args: string[],
  cwd: string,
): ToolRunResult {
  const start = performance.now();
  const proc = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000, // 5 minutes max
  });
  const duration = performance.now() - start;
  if (proc.error) {
    const msg =
      (proc.error as NodeJS.ErrnoException).code === "ENOENT"
        ? `Command not found: ${command}. Is it installed?`
        : proc.error.message;
    return { exitCode: 1, stdout: "", stderr: msg, duration };
  }
  return {
    exitCode: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    duration,
  };
}
