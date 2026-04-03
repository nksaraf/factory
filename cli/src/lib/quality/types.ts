import type { QualityConventions } from "@smp/factory-shared/conventions-schema";
import type { ServiceType } from "../detect-service-type.js";

export type CheckKind = "lint" | "typecheck" | "test" | "format";

export const ALL_CHECK_KINDS: CheckKind[] = [
  "lint",
  "typecheck",
  "test",
  "format",
];

export type Runtime = ServiceType;

export interface ComponentContext {
  /** Component name from catalog. */
  name: string;
  /** Absolute path to the component's build context directory. */
  dir: string;
  /** Detected or declared runtime. */
  runtime: Runtime;
}

export interface CheckOpts {
  /** Only check staged files. */
  staged?: boolean;
  /** Auto-fix where possible. */
  fix?: boolean;
  /** Show tool output even on pass. */
  verbose?: boolean;
  /** List of staged file paths (absolute) when staged mode is active. */
  stagedFiles?: string[];
}

export interface CheckResult {
  kind: CheckKind;
  tool: string;
  passed: boolean;
  /** Duration in milliseconds. */
  duration: number;
  /** Tool's stdout/stderr output. */
  output: string;
  /** Whether this check was skipped (no config found). */
  skipped?: boolean;
  /** Coverage metrics if this is a test check with coverage enabled. */
  coverage?: {
    line: number;
    branch: number;
  };
}

export interface ComponentReport {
  component: ComponentContext;
  results: CheckResult[];
}

export interface CheckReport {
  components: ComponentReport[];
  /** Resolved quality conventions used for this run. */
  quality: QualityConventions;
}

export interface QualityStrategy {
  runtime: Runtime;
  lint(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult>;
  typecheck(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult>;
  test(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult>;
  format(ctx: ComponentContext, opts: CheckOpts): Promise<CheckResult>;
  /** Config files this strategy expects to find for each check. */
  expectedConfigs(): Record<CheckKind, string[]>;
}
