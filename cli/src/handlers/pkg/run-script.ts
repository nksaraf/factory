/**
 * dx pkg run <script> — run scripts across workspace packages.
 *
 * npm   → pnpm -r run <script> (recursive, with native filtering/parallelism)
 * python → look up [project.scripts] in pyproject.toml
 * java  → map script names to maven goals
 */

import { exec } from "../../lib/subprocess.js";
import {
  fromCwd,
  filterPackages,
  type WorkspacePackage,
  type PythonManifest,
} from "../../lib/workspace-context.js";
import { printTable } from "../../output.js";
import { styleSuccess, styleError, styleMuted } from "../../cli-style.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunScriptOptions {
  script: string;
  filter?: string;
  parallel?: boolean;
  continueOnError?: boolean;
  json?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Script resolution
// ---------------------------------------------------------------------------

const MAVEN_SCRIPT_MAP: Record<string, string> = {
  test: "test",
  build: "package",
  dev: "spring-boot:run",
  compile: "compile",
  clean: "clean",
  lint: "checkstyle:check",
};

interface ScriptResult {
  package: string;
  type: string;
  status: "ok" | "failed" | "skipped";
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function runNpmScripts(
  root: string,
  script: string,
  opts: RunScriptOptions,
): Promise<ScriptResult[]> {
  const args = ["pnpm"];

  if (opts.filter) {
    args.push("--filter", opts.filter);
  } else {
    args.push("-r");
  }

  if (opts.parallel) args.push("--parallel");
  args.push("run", script);

  const start = Date.now();
  try {
    await exec(args, { cwd: root });
    return [
      {
        package: opts.filter ?? "(all npm)",
        type: "npm",
        status: "ok",
        durationMs: Date.now() - start,
      },
    ];
  } catch {
    return [
      {
        package: opts.filter ?? "(all npm)",
        type: "npm",
        status: "failed",
        durationMs: Date.now() - start,
      },
    ];
  }
}

async function runPythonScript(
  pkg: WorkspacePackage,
  script: string,
): Promise<ScriptResult> {
  const manifest = pkg.manifest as PythonManifest;
  const entry = manifest.scripts[script];
  const start = Date.now();

  if (!entry) {
    return {
      package: pkg.name,
      type: "python",
      status: "skipped",
      durationMs: 0,
    };
  }

  try {
    // Python scripts are module:function references
    const [mod, fn] = entry.split(":");
    if (fn) {
      await exec(["python", "-c", `from ${mod} import ${fn}; ${fn}()`], {
        cwd: pkg.dir,
      });
    } else {
      await exec(["python", "-m", mod], { cwd: pkg.dir });
    }
    return {
      package: pkg.name,
      type: "python",
      status: "ok",
      durationMs: Date.now() - start,
    };
  } catch {
    return {
      package: pkg.name,
      type: "python",
      status: "failed",
      durationMs: Date.now() - start,
    };
  }
}

async function runJavaScript(
  pkg: WorkspacePackage,
  script: string,
): Promise<ScriptResult> {
  const goal = MAVEN_SCRIPT_MAP[script];
  const start = Date.now();

  if (!goal) {
    return {
      package: pkg.name,
      type: "java",
      status: "skipped",
      durationMs: 0,
    };
  }

  try {
    await exec(["mvn", goal], { cwd: pkg.dir });
    return {
      package: pkg.name,
      type: "java",
      status: "ok",
      durationMs: Date.now() - start,
    };
  } catch {
    return {
      package: pkg.name,
      type: "java",
      status: "failed",
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function pkgRunScript(
  root: string,
  opts: RunScriptOptions,
): Promise<void> {
  const ws = fromCwd(root);
  const pkgs = filterPackages(ws, opts.filter);
  const results: ScriptResult[] = [];

  const hasNpm = pkgs.some((p) => p.type === "npm");
  const pythonPkgs = pkgs.filter((p) => p.type === "python");
  const javaPkgs = pkgs.filter((p) => p.type === "java");

  // npm: use pnpm's native recursive runner
  if (hasNpm) {
    const npmResults = await runNpmScripts(ws.root, opts.script, opts);
    results.push(...npmResults);
  }

  // Python packages
  for (const pkg of pythonPkgs) {
    const result = await runPythonScript(pkg, opts.script);
    results.push(result);
    if (result.status === "failed" && !opts.continueOnError) break;
  }

  // Java packages
  for (const pkg of javaPkgs) {
    const result = await runJavaScript(pkg, opts.script);
    results.push(result);
    if (result.status === "failed" && !opts.continueOnError) break;
  }

  // Summary
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          success: results.every(
            (r) => r.status === "ok" || r.status === "skipped",
          ),
          results,
        },
        null,
        2,
      ),
    );
  } else {
    const rows = results
      .filter((r) => r.status !== "skipped")
      .map((r) => [
        r.package,
        r.type,
        r.status === "ok" ? styleSuccess("✓") : styleError("✗"),
        styleMuted(`${r.durationMs}ms`),
      ]);

    if (rows.length > 0) {
      console.log(
        "\n" + printTable(["Package", "Type", "Status", "Duration"], rows),
      );
    }

    const failed = results.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      throw new Error(`${failed.length} script(s) failed`);
    }
  }
}
