import { spawnSync } from "node:child_process"
import { join } from "node:path"

export interface ToolRunResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

/**
 * Run a quality tool as a subprocess and collect its output.
 * Prepends node_modules/.bin to PATH so locally installed tools are found.
 */
export function runTool(
  command: string,
  args: string[],
  cwd: string
): ToolRunResult {
  const binDir = join(cwd, "node_modules", ".bin")
  const PATH = `${binDir}:${process.env.PATH ?? ""}`
  const start = performance.now()
  const proc = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH },
    timeout: 300_000, // 5 minutes max
  })
  const duration = performance.now() - start
  if (proc.error) {
    const msg =
      (proc.error as NodeJS.ErrnoException).code === "ENOENT"
        ? `Command not found: ${command}. Is it installed?`
        : proc.error.message
    return { exitCode: 1, stdout: "", stderr: msg, duration }
  }
  return {
    exitCode: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    duration,
  }
}
