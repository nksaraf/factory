import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  CheckKind,
  CheckOpts,
  CheckResult,
  ComponentContext,
  QualityStrategy,
} from "../types.js";
import { runTool } from "../run-tool.js";

function skip(kind: CheckKind, tool: string): CheckResult {
  return { kind, tool, passed: true, duration: 0, output: "", skipped: true };
}

function hasMaven(dir: string): boolean {
  return existsSync(join(dir, "pom.xml"));
}

function hasGradle(dir: string): boolean {
  return (
    existsSync(join(dir, "build.gradle")) ||
    existsSync(join(dir, "build.gradle.kts"))
  );
}

function hasPomPlugin(dir: string, artifactId: string): boolean {
  const pomPath = join(dir, "pom.xml");
  if (!existsSync(pomPath)) return false;
  try {
    const content = readFileSync(pomPath, "utf-8");
    return content.includes(artifactId);
  } catch {
    return false;
  }
}

export class JavaStrategy implements QualityStrategy {
  readonly runtime = "java" as const;

  async lint(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "checkstyle";
    if (!hasPomPlugin(ctx.dir, "maven-checkstyle-plugin") && !existsSync(join(ctx.dir, "checkstyle.xml"))) {
      return skip("lint", tool);
    }

    if (hasMaven(ctx.dir)) {
      const result = runTool("mvn", ["checkstyle:check", "-q"], ctx.dir);
      return {
        kind: "lint",
        tool,
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }

    return skip("lint", tool);
  }

  async typecheck(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "javac";
    if (hasMaven(ctx.dir)) {
      const result = runTool("mvn", ["compile", "-q"], ctx.dir);
      return {
        kind: "typecheck",
        tool: "mvn compile",
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }
    if (hasGradle(ctx.dir)) {
      const result = runTool("gradle", ["compileJava", "-q"], ctx.dir);
      return {
        kind: "typecheck",
        tool: "gradle compileJava",
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }
    return skip("typecheck", tool);
  }

  async test(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    if (hasMaven(ctx.dir)) {
      const result = runTool("mvn", ["test", "-q"], ctx.dir);
      return {
        kind: "test",
        tool: "mvn test",
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }
    if (hasGradle(ctx.dir)) {
      const result = runTool("gradle", ["test", "-q"], ctx.dir);
      return {
        kind: "test",
        tool: "gradle test",
        passed: result.exitCode === 0,
        duration: result.duration,
        output: result.stdout + result.stderr,
      };
    }
    return skip("test", "mvn test");
  }

  async format(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult> {
    const tool = "spotless";
    if (!hasPomPlugin(ctx.dir, "spotless-maven-plugin")) {
      return skip("format", tool);
    }

    const goal = opts.fix ? "spotless:apply" : "spotless:check";
    const result = runTool("mvn", [goal, "-q"], ctx.dir);
    return {
      kind: "format",
      tool,
      passed: result.exitCode === 0,
      duration: result.duration,
      output: result.stdout + result.stderr,
    };
  }

  expectedConfigs(): Record<CheckKind, string[]> {
    return {
      lint: ["checkstyle.xml", "pom.xml"],
      typecheck: ["pom.xml", "build.gradle", "build.gradle.kts"],
      test: ["pom.xml", "build.gradle", "build.gradle.kts"],
      format: ["pom.xml"],
    };
  }
}
