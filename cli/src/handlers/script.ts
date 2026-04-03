import fs from "node:fs";
import path from "node:path";
import { shellSync } from "../lib/shell.js";

export interface RunScriptOptions {
  file: string;
  watch?: boolean;
  passthrough: string[];
  /** Secret environment scope (production, development, preview). */
  environment?: string;
  /** Skip secret injection. */
  noSecrets?: boolean;
}

/**
 * Resolve a script path. Supports:
 *   - Absolute or relative file paths (.ts, .js, .mjs, .mts)
 *   - Bare names resolved from `.dx/scripts/` directory
 */
function resolveScriptPath(file: string): string {
  // Direct path (absolute or relative)
  if (
    file.startsWith("/") ||
    file.startsWith("./") ||
    file.startsWith("../") ||
    file.includes(path.sep)
  ) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Script not found: ${resolved}`);
    }
    return resolved;
  }

  // Try as-is first (e.g., "deploy.ts" in cwd)
  const asCwd = path.resolve(file);
  if (fs.existsSync(asCwd)) return asCwd;

  // Try .dx/scripts/ directory
  const dxScriptsDir = path.resolve(".dx", "scripts");
  const extensions = ["", ".ts", ".js", ".mts", ".mjs"];
  for (const ext of extensions) {
    const candidate = path.join(dxScriptsDir, `${file}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Script not found: ${file}\n` +
    `  Looked in: current directory, .dx/scripts/`
  );
}

export async function runScript(opts: RunScriptOptions): Promise<void> {
  const scriptPath = resolveScriptPath(opts.file);

  // dx is a Crust-compiled Bun binary — process.execPath IS bun
  const bunPath = process.execPath;
  const args = ["run"];

  if (opts.watch) {
    args.push("--watch");
  }

  args.push(scriptPath, ...opts.passthrough);

  const result = shellSync(bunPath, args, {
    noSecrets: opts.noSecrets,
    environment: opts.environment,
    inherit: true,
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}
