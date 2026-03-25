import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  conventionsFileSchema,
  defaultConventionsConfig,
  normalizeConventionsConfig,
} from "./conventions-schema";
import type { ConventionsConfig } from "./conventions-schema";

export type { ConventionsConfig } from "./conventions-schema";

export interface ValidationResult {
  valid: boolean;
  violations: string[];
  suggestions: string[];
}

export interface DeployGateContext {
  testsPassing?: boolean;
  hasReview?: boolean;
  hasStagingDeploy?: boolean;
}

const CONVENTIONS_REL = join(".dx", "conventions.yaml");

export function loadConventions(repoRoot: string): ConventionsConfig {
  const path = join(repoRoot, CONVENTIONS_REL);
  if (!existsSync(path)) return defaultConventionsConfig();
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as unknown;
  const file = conventionsFileSchema.safeParse(parsed);
  if (!file.success) return defaultConventionsConfig();
  return normalizeConventionsConfig(file.data);
}

function buildBranchRegex(config: ConventionsConfig): RegExp | null {
  const { pattern, types, require_ticket } = config.branches;
  if (types.length === 0 && !require_ticket) return null;

  const esc = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typeGroup =
    types.length > 0 ? `(${types.map((t) => esc(t)).join("|")})` : "([^/]+)";
  const ticketGroup = require_ticket
    ? "([A-Z][A-Z0-9]*-\\d+)"
    : "([^/]+)";

  const parts: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("{type}", i)) {
      parts.push(typeGroup);
      i += "{type}".length;
    } else if (pattern.startsWith("{ticket}", i)) {
      parts.push(ticketGroup);
      i += "{ticket}".length;
    } else if (pattern.startsWith("{slug}", i)) {
      parts.push("(.+)");
      i += "{slug}".length;
    } else {
      parts.push(esc(pattern[i]!));
      i += 1;
    }
  }

  try {
    return new RegExp(`^${parts.join("")}$`);
  } catch {
    return null;
  }
}

export function validateBranchName(
  name: string,
  config: ConventionsConfig
): ValidationResult {
  const re = buildBranchRegex(config);
  if (!re) {
    return { valid: true, violations: [], suggestions: [] };
  }
  if (re.test(name.trim())) {
    return { valid: true, violations: [], suggestions: [] };
  }
  const { pattern, types } = config.branches;
  return {
    valid: false,
    violations: [`Branch "${name}" does not match required pattern.`],
    suggestions: [
      types.length
        ? `Use pattern ${pattern} with type one of: ${types.join(", ")}`
        : `Use pattern ${pattern}`,
    ],
  };
}

const CONVENTIONAL_TYPES =
  "feat|fix|chore|docs|style|refactor|test|build|ci|perf|revert";

const CONVENTIONAL_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES})(\\([^)]+\\))?!?: .+$`
);

export function validateCommitMessage(
  message: string,
  config: ConventionsConfig
): ValidationResult {
  if (config.commits.format !== "conventional") {
    return { valid: true, violations: [], suggestions: [] };
  }
  const m = message.trim();
  if (!CONVENTIONAL_RE.test(m)) {
    return {
      valid: false,
      violations: [
        'Message must follow Conventional Commits, e.g. "feat(scope): description".',
      ],
      suggestions: [
        `Allowed types: ${CONVENTIONAL_TYPES.replace(/\|/g, ", ")}`,
      ],
    };
  }
  if (config.commits.require_scope) {
    const scopeRequired = new RegExp(
      `^(${CONVENTIONAL_TYPES})\\([^)]+\\)!?: .+$`
    );
    if (!scopeRequired.test(m)) {
      return {
        valid: false,
        violations: ["Conventions require a scope in parentheses, e.g. feat(api): ..."],
        suggestions: ['Example: fix(cli): handle missing dx.yaml'],
      };
    }
  }
  return { valid: true, violations: [], suggestions: [] };
}

export interface ConnectionPolicyResult {
  allowed: boolean;
  forceReadonly: boolean;
  requireReason: boolean;
  violations: string[];
}

export function checkConnectionPolicy(
  targetKind: string,
  readonly: boolean,
  config: ConventionsConfig
): ConnectionPolicyResult {
  const { connections } = config;
  const rules = connections.allow;

  // No rules = permissive (allow everything)
  if (rules.length === 0) {
    const isProduction =
      targetKind === "production" || targetKind === "prod";
    return {
      allowed: true,
      forceReadonly: false,
      requireReason: isProduction && connections.production_require_reason,
      violations: [],
    };
  }

  const kind = targetKind.toLowerCase();
  const rule = rules.find((r) => r.kind.toLowerCase() === kind);

  if (!rule) {
    return {
      allowed: false,
      forceReadonly: false,
      requireReason: false,
      violations: [
        `No connection rule allows target kind "${targetKind}". Allowed kinds: ${rules.map((r) => r.kind).join(", ")}`,
      ],
    };
  }

  const forceReadonly = rule.force_readonly ?? false;
  const violations: string[] = [];

  if (forceReadonly && !readonly) {
    violations.push(
      `Connections to "${targetKind}" require --readonly flag.`
    );
  }

  const isProduction = kind === "production" || kind === "prod";
  const requireReason =
    isProduction && connections.production_require_reason;

  return {
    allowed: violations.length === 0,
    forceReadonly,
    requireReason,
    violations,
  };
}

export function checkDeployGates(
  tier: string,
  config: ConventionsConfig,
  ctx: DeployGateContext = {}
): ValidationResult {
  const violations: string[] = [];
  const suggestions: string[] = [];
  const t = tier.toLowerCase();
  const gates =
    t === "production" || t === "prod"
      ? config.deploy.production
      : t === "sandbox"
        ? config.deploy.sandbox
        : undefined;

  if (!gates) {
    return { valid: true, violations: [], suggestions: [] };
  }

  if (gates.require_passing_tests && ctx.testsPassing === false) {
    violations.push("Production deploy requires passing tests.");
    suggestions.push("Run tests locally or in CI before deploy.");
  }
  if (gates.require_review && ctx.hasReview === false) {
    violations.push("Production deploy requires code review.");
    suggestions.push("Open a PR and obtain approval before deploy.");
  }
  if (gates.require_staging_first && ctx.hasStagingDeploy === false) {
    violations.push("Production deploy requires a prior staging deploy.");
    suggestions.push("Deploy to staging first, then production.");
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestions,
  };
}
