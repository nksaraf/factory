import type {
  CheckKind,
  CheckOpts,
  CheckResult,
  ComponentContext,
  QualityStrategy,
} from "../types.js";
import { runTool } from "../run-tool.js";
import { detectToolchain, type DetectedTool } from "../../toolchain-detector.js";

function skip(kind: CheckKind, tool: string): CheckResult {
  return { kind, tool, passed: true, duration: 0, output: "", skipped: true };
}

function runDetectedTool(kind: CheckKind, detected: DetectedTool | null, dir: string, extraArgs?: string[]): CheckResult {
  if (!detected) return skip(kind, "-");

  const parts = detected.runCmd.split(" ");
  const [bin, ...args] = parts;
  if (extraArgs) args.push(...extraArgs);

  const result = runTool(bin!, args, dir);
  return {
    kind,
    tool: detected.tool,
    passed: result.exitCode === 0,
    duration: result.duration,
    output: result.stdout + result.stderr,
  };
}

/**
 * A quality strategy that uses the toolchain detector instead of hardcoded
 * tool detection. Works for any runtime the detector supports.
 *
 * Used by `dx check` to leverage the same convention engine as
 * `dx lint`, `dx test`, `dx format`, `dx typecheck`.
 */
export class ToolchainStrategy implements QualityStrategy {
  readonly runtime = "node" as const; // nominal — works for any detected runtime

  async lint(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tc = detectToolchain(ctx.dir);
    if (!tc.linter) return skip("lint", "-");

    const extra: string[] = [];
    if (opts.fix && !tc.linter.runCmd.includes("--fix")) extra.push("--fix");

    if (opts.staged && opts.stagedFiles) {
      const relevant = opts.stagedFiles.filter((f) => f.startsWith(ctx.dir));
      if (relevant.length === 0) return skip("lint", tc.linter.tool);
      // For staged mode, replace the trailing "." with specific files
      const parts = tc.linter.runCmd.split(" ");
      const lastArg = parts[parts.length - 1];
      if (lastArg === ".") parts.pop();
      const [bin, ...args] = parts;
      if (opts.fix && !args.includes("--fix")) args.push("--fix");
      args.push(...relevant);
      const result = runTool(bin!, args, ctx.dir);
      return {
        kind: "lint",
        tool: tc.linter.tool,
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }

    return runDetectedTool("lint", tc.linter, ctx.dir, extra);
  }

  async typecheck(ctx: ComponentContext, _opts: CheckOpts): Promise<CheckResult> {
    const tc = detectToolchain(ctx.dir);
    return runDetectedTool("typecheck", tc.typeChecker, ctx.dir);
  }

  async test(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tc = detectToolchain(ctx.dir);
    if (!tc.testRunner) return skip("test", "-");

    const extra: string[] = [];
    if (opts.staged) {
      // Add --changed flag for vitest
      if (tc.testRunner.tool === "vitest") extra.push("--changed");
    }

    return runDetectedTool("test", tc.testRunner, ctx.dir, extra);
  }

  async format(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tc = detectToolchain(ctx.dir);
    if (!tc.formatter) return skip("format", "-");

    // In check mode (default for dx check), use --check instead of --write
    let runCmd = tc.formatter.runCmd;
    if (!opts.fix) {
      runCmd = runCmd.replace("--write", "--check").replace("format .", "format --check .");
      if (!runCmd.includes("--check")) runCmd += " --check";
    }

    const parts = runCmd.split(" ");
    const [bin, ...args] = parts;

    if (opts.staged && opts.stagedFiles) {
      const relevant = opts.stagedFiles.filter((f) => f.startsWith(ctx.dir));
      if (relevant.length === 0) return skip("format", tc.formatter.tool);
      // Remove trailing "." and add specific files
      const dotIdx = args.indexOf(".");
      if (dotIdx >= 0) args.splice(dotIdx, 1);
      args.push(...relevant);
    }

    const result = runTool(bin!, args, ctx.dir);
    return {
      kind: "format",
      tool: tc.formatter.tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    };
  }

  expectedConfigs(): Record<CheckKind, string[]> {
    return {
      lint: ["eslint.config.js", "oxlint.config.json", "biome.json", ".golangci-lint.yaml"],
      typecheck: ["tsconfig.json"],
      test: ["vitest.config.ts", "jest.config.ts", "pytest.ini", "go.mod"],
      format: [".prettierrc", "biome.json"],
    };
  }
}
