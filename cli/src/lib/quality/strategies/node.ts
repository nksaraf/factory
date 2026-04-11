import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { runTool } from "../run-tool.js"
import type {
  CheckKind,
  CheckOpts,
  CheckResult,
  ComponentContext,
  QualityStrategy,
} from "../types.js"

function hasDevDependency(dir: string, pkg: string): boolean {
  const pkgJsonPath = join(dir, "package.json")
  if (!existsSync(pkgJsonPath)) return false
  try {
    const content = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
    return Boolean(
      content.devDependencies?.[pkg] || content.dependencies?.[pkg]
    )
  } catch {
    return false
  }
}

const PRETTIER_CONFIG_NAMES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.cjs",
]

/** Walk up from dir to filesystem root checking for prettier config. */
function hasPrettierConfig(dir: string): boolean {
  let current = dir
  for (let i = 0; i < 10; i++) {
    if (PRETTIER_CONFIG_NAMES.some((name) => existsSync(join(current, name)))) {
      return true
    }
    // Also check package.json for "prettier" key existence (we don't parse it, just check the file exists)
    const parent = dirname(current)
    if (parent === current) break // reached root
    current = parent
  }
  return false
}

function skip(kind: CheckKind, tool: string): CheckResult {
  return { kind, tool, passed: true, duration: 0, output: "", skipped: true }
}

function filterStagedFiles(
  files: string[] | undefined,
  dir: string,
  extensions: string[]
): string[] | undefined {
  if (!files) return undefined
  return files.filter(
    (f) => f.startsWith(dir) && extensions.some((ext) => f.endsWith(ext))
  )
}

export class NodeStrategy implements QualityStrategy {
  readonly runtime = "node" as const

  async lint(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "oxlint"
    // Require oxlint config or devDependency to avoid surprise npx downloads
    const hasOxlint =
      existsSync(join(ctx.dir, "oxlint.config.json")) ||
      existsSync(join(ctx.dir, ".oxlintrc.json")) ||
      hasDevDependency(ctx.dir, "oxlint")
    if (!hasOxlint) return skip("lint", tool)

    const args: string[] = []

    if (opts.fix) args.push("--fix")

    if (opts.staged && opts.stagedFiles) {
      const files = filterStagedFiles(opts.stagedFiles, ctx.dir, [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
      ])
      if (!files || files.length === 0) return skip("lint", tool)
      args.push(...files)
    } else {
      args.push(".")
    }

    const result = runTool("npx", ["oxlint", ...args], ctx.dir)
    return {
      kind: "lint",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  async typecheck(
    ctx: ComponentContext,
    opts: CheckOpts
  ): Promise<CheckResult> {
    const tool = "tsgo"
    if (!existsSync(join(ctx.dir, "tsconfig.json"))) {
      return skip("typecheck", tool)
    }

    const result = runTool("tsgo", ["--noEmit"], ctx.dir)
    return {
      kind: "typecheck",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  async test(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "vitest"
    const hasConfig =
      existsSync(join(ctx.dir, "vitest.config.ts")) ||
      existsSync(join(ctx.dir, "vitest.config.js")) ||
      existsSync(join(ctx.dir, "vitest.config.mts"))
    if (!hasConfig) return skip("test", tool)

    const args = ["vitest", "run"]
    if (opts.staged) args.push("--changed")

    const result = runTool("npx", args, ctx.dir)
    return {
      kind: "test",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  async format(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "prettier"
    if (!hasPrettierConfig(ctx.dir)) return skip("format", tool)

    const args = opts.fix ? ["prettier", "--write"] : ["prettier", "--check"]

    if (opts.staged && opts.stagedFiles) {
      const files = filterStagedFiles(opts.stagedFiles, ctx.dir, [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".css",
        ".md",
      ])
      if (!files || files.length === 0) return skip("format", tool)
      args.push(...files)
    } else {
      args.push(".")
    }

    const result = runTool("npx", args, ctx.dir)
    return {
      kind: "format",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  expectedConfigs(): Record<CheckKind, string[]> {
    return {
      lint: ["oxlint.config.json", ".oxlintrc.json"],
      typecheck: ["tsconfig.json"],
      test: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"],
      format: [".prettierrc", ".prettierrc.json", ".prettierrc.js"],
    }
  }
}
