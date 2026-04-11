import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { resolveDxContext, type ProjectContextData } from "../lib/dx-context.js"
import { detectToolchain } from "../lib/toolchain-detector.js"
import { resolveVariant } from "../lib/toolchain-detector.js"
import { loadPackageJson } from "../lib/dx-project-config.js"

import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("test", [
  "$ dx test                Run all tests",
  "$ dx test api            Run tests for a component",
  "$ dx test --watch        Watch mode",
  "$ dx test --coverage     With coverage",
  "$ dx test --changed      Only test changed files",
])

export function testCommand(app: DxBase) {
  return app
    .sub("test")
    .meta({ description: "Run tests" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description:
          "Component names (default: all that define a test command)",
      },
    ])
    .flags({
      watch: {
        type: "boolean",
        short: "w",
        description: "Watch mode (re-run on file changes)",
      },
      coverage: {
        type: "boolean",
        description: "Run with coverage reporting",
      },
      changed: {
        type: "boolean",
        description: "Only test changed files",
      },
      integration: {
        type: "boolean",
        description: "Run integration tests",
      },
      e2e: {
        type: "boolean",
        description: "Run end-to-end tests",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)

      // Determine variant from flags
      const variant = flags.watch
        ? "watch"
        : flags.coverage
          ? "coverage"
          : flags.changed
            ? "changed"
            : flags.integration
              ? "integration"
              : flags.e2e
                ? "e2e"
                : null

      const ctx = await resolveDxContext({ need: "host" })
      const project = ctx.project
      const pkg = ctx.package

      if (project && args.components?.length) {
        // Component-targeted mode: run tests per component from catalog
        return runCatalogTests(project, args.components, variant, f)
      }

      if (project && !args.components?.length) {
        // Full project: try toolchain first, fall back to catalog
        if (pkg?.toolchain.testRunner) {
          return runToolchainTest(
            pkg.toolchain.testRunner,
            pkg.dir,
            pkg.scripts,
            variant,
            f
          )
        }
        // Fall back to catalog-based test commands
        const componentNames = Object.keys(project.catalog.components)
        return runCatalogTests(project, componentNames, variant, f)
      }

      // No docker-compose — standalone package mode
      if (!pkg)
        return exitWithError(
          f,
          "No project found (no package.json or docker-compose)."
        )

      if (!pkg.toolchain.testRunner) {
        return exitWithError(
          f,
          'No test runner detected. Add a "test" script to package.json or install vitest/jest.'
        )
      }

      return runToolchainTest(
        pkg.toolchain.testRunner,
        pkg.dir,
        pkg.scripts,
        variant,
        f
      )
    })
}

function runToolchainTest(
  testRunner: {
    tool: string
    configFile: string
    runCmd: string
    source: "auto-detect" | "package.json"
  },
  rootDir: string,
  scripts: Record<string, string>,
  variant: string | null,
  f: ReturnType<typeof toDxFlags>
): void {
  let tool = testRunner

  if (variant) {
    const packageJson = loadPackageJson(rootDir)
    const resolved = resolveVariant("test", variant, testRunner, packageJson)
    if (resolved) {
      tool = resolved
    } else if (!f.quiet) {
      console.log(
        `  No ${variant} variant found for ${testRunner.tool}, running default.`
      )
    }
  }

  if (!f.quiet) {
    const sourceLabel =
      tool.source === "package.json"
        ? `Using: package.json → "${variant ? `test:${variant}` : "test"}"`
        : `Detected: ${tool.tool} (from ${tool.configFile})`
    console.log(`  ${sourceLabel}`)
  }

  const [bin, ...args] = tool.runCmd.split(" ")
  const result = spawnSync(bin!, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
  })

  if (f.json) {
    console.log(
      JSON.stringify({
        command: "test",
        tool: tool.tool,
        source: tool.source,
        variant: variant ?? "default",
        executed: tool.runCmd,
        result: result.status === 0 ? "pass" : "fail",
      })
    )
  }

  process.exit(result.status ?? 1)
}

function runCatalogTests(
  project: ProjectContextData,
  names: string[],
  variant: string | null,
  f: ReturnType<typeof toDxFlags>
): void {
  let ran = 0

  for (const name of names) {
    const comp = project.catalog.components[name]
    if (!comp) {
      exitWithError(f, `Unknown component "${name}"`)
    }

    const cmd = comp!.spec.test
    if (!cmd?.trim()) {
      if (f.verbose) {
        console.warn(
          `Skipping ${name}: no test command defined (add dx.test label)`
        )
      }
      continue
    }

    if (!f.quiet) {
      console.log(`  Testing ${name}...`)
    }

    const buildContext = comp!.spec.build?.context ?? "."
    const cwd = resolve(project.rootDir, buildContext)

    // For catalog components, try toolchain detection in the component's directory
    // to support variant flags
    let finalCmd = cmd
    if (variant) {
      const compToolchain = detectToolchain(cwd)
      if (compToolchain?.testRunner) {
        const packageJson = loadPackageJson(cwd)
        const resolved = resolveVariant(
          "test",
          variant,
          compToolchain.testRunner,
          packageJson
        )
        if (resolved) {
          finalCmd = resolved.runCmd
        }
      }
    }

    const proc = spawnSync("sh", ["-c", finalCmd], { cwd, stdio: "inherit" })
    if (proc.status !== 0) {
      process.exit(proc.status ?? 1)
    }
    ran += 1
  }

  if (ran === 0) {
    exitWithError(
      f,
      "No test commands found. Add a `dx.test` label to your docker-compose services or install a test runner."
    )
  }

  if (f.json) {
    console.log(JSON.stringify({ success: true, exitCode: 0, ran }))
  }
}
