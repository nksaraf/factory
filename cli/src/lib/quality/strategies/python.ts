import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type {
  CheckKind,
  CheckOpts,
  CheckResult,
  ComponentContext,
  QualityStrategy,
} from "../types.js"
import { runTool } from "../run-tool.js"

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

function hasRuffConfig(dir: string): boolean {
  if (existsSync(join(dir, "ruff.toml"))) return true
  if (existsSync(join(dir, ".ruff.toml"))) return true
  const pyproject = join(dir, "pyproject.toml")
  if (existsSync(pyproject)) {
    try {
      const content = readFileSync(pyproject, "utf-8")
      return content.includes("[tool.ruff]")
    } catch {
      return false
    }
  }
  return false
}

export class PythonStrategy implements QualityStrategy {
  readonly runtime = "python" as const

  async lint(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "ruff"
    if (!hasRuffConfig(ctx.dir)) return skip("lint", tool)

    const args = ["check"]
    if (opts.fix) args.push("--fix")

    if (opts.staged && opts.stagedFiles) {
      const files = filterStagedFiles(opts.stagedFiles, ctx.dir, [".py"])
      if (!files || files.length === 0) return skip("lint", tool)
      args.push(...files)
    } else {
      args.push(".")
    }

    const result = runTool("ruff", args, ctx.dir)
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
    const tool = "mypy"
    const pyproject = join(ctx.dir, "pyproject.toml")
    const hasMypyConfig =
      existsSync(join(ctx.dir, "mypy.ini")) ||
      existsSync(join(ctx.dir, ".mypy.ini")) ||
      (existsSync(pyproject) &&
        readFileSync(pyproject, "utf-8").includes("[tool.mypy]"))

    if (!hasMypyConfig) return skip("typecheck", tool)

    const args = ["."]
    if (opts.staged && opts.stagedFiles) {
      const files = filterStagedFiles(opts.stagedFiles, ctx.dir, [".py"])
      if (!files || files.length === 0) return skip("typecheck", tool)
      args.length = 0
      args.push(...files)
    }

    const result = runTool("mypy", args, ctx.dir)
    return {
      kind: "typecheck",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  async test(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "pytest"
    const pyproject = join(ctx.dir, "pyproject.toml")
    const hasPytest =
      existsSync(join(ctx.dir, "pytest.ini")) ||
      existsSync(join(ctx.dir, "conftest.py")) ||
      (existsSync(pyproject) &&
        readFileSync(pyproject, "utf-8").includes("[tool.pytest"))

    if (!hasPytest) return skip("test", tool)

    const result = runTool("pytest", [], ctx.dir)
    return {
      kind: "test",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    }
  }

  async format(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "ruff"
    if (!hasRuffConfig(ctx.dir)) return skip("format", tool)

    const args = opts.fix ? ["format"] : ["format", "--check"]

    if (opts.staged && opts.stagedFiles) {
      const files = filterStagedFiles(opts.stagedFiles, ctx.dir, [".py"])
      if (!files || files.length === 0) return skip("format", tool)
      args.push(...files)
    } else {
      args.push(".")
    }

    const result = runTool("ruff", args, ctx.dir)
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
      lint: ["ruff.toml", ".ruff.toml", "pyproject.toml"],
      typecheck: ["mypy.ini", ".mypy.ini", "pyproject.toml"],
      test: ["pytest.ini", "conftest.py", "pyproject.toml"],
      format: ["ruff.toml", ".ruff.toml", "pyproject.toml"],
    }
  }
}
