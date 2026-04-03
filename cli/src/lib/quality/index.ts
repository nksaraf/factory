import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { CatalogComponent } from "@smp/factory-shared/catalog";
import type { QualityConventions } from "@smp/factory-shared/conventions-schema";
import { resolveComponentQuality } from "@smp/factory-shared/conventions-schema";

import { detectServiceType } from "../detect-service-type.js";
import type {
  CheckKind,
  CheckOpts,
  CheckReport,
  CheckResult,
  ComponentContext,
  ComponentReport,
  QualityStrategy,
  Runtime,
} from "./types.js";
import { ALL_CHECK_KINDS } from "./types.js";
import { NodeStrategy } from "./strategies/node.js";
import { PythonStrategy } from "./strategies/python.js";
import { JavaStrategy } from "./strategies/java.js";

const strategies: Record<Runtime, QualityStrategy> = {
  node: new NodeStrategy(),
  python: new PythonStrategy(),
  java: new JavaStrategy(),
};

export interface QualityRunOpts extends CheckOpts {
  /** Run only these check kinds. Default: all. */
  kinds?: CheckKind[];
  /** Quality conventions from project conventions.yaml. */
  quality: QualityConventions;
}

/**
 * Resolve runtime for a catalog component: prefer spec.runtime, fall back to
 * file-system heuristic via detectServiceType.
 */
export function resolveRuntime(
  comp: CatalogComponent,
  rootDir: string,
): Runtime | null {
  if (comp.spec.runtime) return comp.spec.runtime;
  const buildContext = comp.spec.build?.context ?? ".";
  const dir = resolve(rootDir, buildContext);
  return detectServiceType(dir);
}

/**
 * Build a ComponentContext for a catalog component.
 */
export function buildComponentContext(
  name: string,
  comp: CatalogComponent,
  rootDir: string,
): ComponentContext | null {
  const runtime = resolveRuntime(comp, rootDir);
  if (!runtime) return null;
  const buildContext = comp.spec.build?.context ?? ".";
  const dir = resolve(rootDir, buildContext);
  return { name, dir, runtime };
}

/**
 * Get list of staged file paths (absolute) from git.
 */
export function getStagedFiles(rootDir: string): string[] {
  const proc = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (proc.status !== 0) return [];
  return proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((f) => resolve(rootDir, f));
}

/**
 * Run quality checks for a single component.
 */
export async function runComponentChecks(
  ctx: ComponentContext,
  opts: QualityRunOpts,
): Promise<ComponentReport> {
  const strategy = strategies[ctx.runtime];
  const kinds = opts.kinds ?? ALL_CHECK_KINDS;
  const componentQuality = resolveComponentQuality(opts.quality, ctx.name);
  const results: CheckResult[] = [];

  for (const kind of kinds) {
    const config = componentQuality[kind];
    if (!config.enabled) {
      results.push({
        kind,
        tool: "-",
        passed: true,
        duration: 0,
        output: "",
        skipped: true,
      });
      continue;
    }

    const result = await strategy[kind](ctx, opts);
    results.push(result);
  }

  return { component: ctx, results };
}

/**
 * Run quality checks across all provided components.
 */
export async function runQualityChecks(
  components: ComponentContext[],
  opts: QualityRunOpts,
): Promise<CheckReport> {
  const reports: ComponentReport[] = [];
  for (const ctx of components) {
    reports.push(await runComponentChecks(ctx, opts));
  }
  return { components: reports, quality: opts.quality };
}

export { strategies, ALL_CHECK_KINDS };
export type { CheckKind, CheckResult, ComponentContext, ComponentReport, CheckReport, QualityStrategy };
