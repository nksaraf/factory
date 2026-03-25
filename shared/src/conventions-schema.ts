import { z } from "zod";

export const branchConventionsSchema = z.object({
  pattern: z.string().default("{type}/{ticket}-{slug}"),
  types: z.array(z.string()).default([]),
  require_ticket: z.boolean().default(false),
});

export const commitConventionsSchema = z.object({
  format: z.enum(["conventional", "none"]).default("none"),
  require_scope: z.boolean().default(false),
});

export const deployTierGatesSchema = z.object({
  require_passing_tests: z.boolean().optional(),
  require_review: z.boolean().optional(),
  require_staging_first: z.boolean().optional(),
  auto_create: z.boolean().optional(),
  ttl: z.string().optional(),
  max_per_module: z.number().optional(),
});

export const deployConventionsSchema = z.object({
  production: deployTierGatesSchema.optional(),
  sandbox: deployTierGatesSchema.optional(),
});

/** YAML may use kebab-case keys; normalize to snake_case for Zod. */
const branchConventionsYamlSchema = z
  .object({
    pattern: z.string().optional(),
    types: z.array(z.string()).optional(),
    require_ticket: z.boolean().optional(),
    "require-ticket": z.boolean().optional(),
  })
  .transform((o) => ({
    pattern: o.pattern,
    types: o.types,
    require_ticket: o.require_ticket ?? o["require-ticket"] ?? false,
  }));

const commitConventionsYamlSchema = z
  .object({
    format: z.enum(["conventional", "none"]).optional(),
    require_scope: z.boolean().optional(),
    "require-scope": z.boolean().optional(),
  })
  .transform((o) => ({
    format: o.format,
    require_scope: o.require_scope ?? o["require-scope"] ?? false,
  }));

const deployTierYamlSchema = z
  .object({
    require_passing_tests: z.boolean().optional(),
    "require-passing-tests": z.boolean().optional(),
    require_review: z.boolean().optional(),
    "require-review": z.boolean().optional(),
    require_staging_first: z.boolean().optional(),
    "require-staging-first": z.boolean().optional(),
    auto_create: z.boolean().optional(),
    "auto-create": z.boolean().optional(),
    ttl: z.string().optional(),
    max_per_module: z.number().optional(),
    "max-per-module": z.number().optional(),
  })
  .transform((o) => ({
    require_passing_tests: o.require_passing_tests ?? o["require-passing-tests"],
    require_review: o.require_review ?? o["require-review"],
    require_staging_first: o.require_staging_first ?? o["require-staging-first"],
    auto_create: o.auto_create ?? o["auto-create"],
    ttl: o.ttl,
    max_per_module: o.max_per_module ?? o["max-per-module"],
  }));

const connectionAllowRuleYamlSchema = z
  .object({
    kind: z.string(),
    require: z.string().optional(),
    force_readonly: z.boolean().optional(),
    "force-readonly": z.boolean().optional(),
  })
  .transform((o) => ({
    kind: o.kind,
    require: o.require,
    force_readonly: o.force_readonly ?? o["force-readonly"],
  }));

const connectionConventionsYamlSchema = z
  .object({
    allow: z.array(connectionAllowRuleYamlSchema).optional(),
    default_profile: z.string().nullable().optional(),
    "default-profile": z.string().nullable().optional(),
    production_session_ttl: z.string().optional(),
    "production-session-ttl": z.string().optional(),
    production_require_reason: z.boolean().optional(),
    "production-require-reason": z.boolean().optional(),
  })
  .transform((o) => ({
    allow: o.allow,
    default_profile: o.default_profile ?? o["default-profile"] ?? null,
    production_session_ttl:
      o.production_session_ttl ?? o["production-session-ttl"] ?? "2h",
    production_require_reason:
      o.production_require_reason ?? o["production-require-reason"] ?? true,
  }));

export const connectionAllowRuleSchema = z.object({
  kind: z.string(),
  require: z.string().optional(),
  force_readonly: z.boolean().optional(),
});

export type ConnectionAllowRule = z.infer<typeof connectionAllowRuleSchema>;

export const connectionConventionsSchema = z.object({
  allow: z.array(connectionAllowRuleSchema).default([]),
  default_profile: z.string().nullable().default(null),
  production_session_ttl: z.string().default("2h"),
  production_require_reason: z.boolean().default(true),
});

export type ConnectionConventions = z.infer<typeof connectionConventionsSchema>;

export const conventionsFileSchema = z.object({
  branches: branchConventionsYamlSchema.optional(),
  commits: commitConventionsYamlSchema.optional(),
  deploy: z
    .object({
      production: deployTierYamlSchema.optional(),
      sandbox: deployTierYamlSchema.optional(),
    })
    .optional(),
  connections: connectionConventionsYamlSchema.optional(),
});

export type BranchConventions = z.infer<typeof branchConventionsSchema>;
export type CommitConventions = z.infer<typeof commitConventionsSchema>;
export type DeployConventions = z.infer<typeof deployConventionsSchema>;

export type ConventionsConfig = {
  branches: BranchConventions;
  commits: CommitConventions;
  deploy: DeployConventions;
  connections: ConnectionConventions;
};

export function defaultConventionsConfig(): ConventionsConfig {
  return {
    branches: branchConventionsSchema.parse({}),
    commits: commitConventionsSchema.parse({}),
    deploy: {},
    connections: connectionConventionsSchema.parse({}),
  };
}

/** Merge file payload into typed conventions with defaults. */
/** Parse API / partial YAML object into full conventions (defaults fill gaps). */
export function parseConventionsInput(raw: unknown): ConventionsConfig {
  const file = conventionsFileSchema.safeParse(raw);
  if (!file.success) return defaultConventionsConfig();
  return normalizeConventionsConfig(file.data);
}

export function normalizeConventionsConfig(
  raw: z.infer<typeof conventionsFileSchema>
): ConventionsConfig {
  const branches = branchConventionsSchema.parse({
    pattern: raw.branches?.pattern,
    types: raw.branches?.types ?? [],
    require_ticket: raw.branches?.require_ticket ?? false,
  });
  const commits = commitConventionsSchema.parse({
    format: raw.commits?.format ?? "none",
    require_scope: raw.commits?.require_scope ?? false,
  });
  const deploy: DeployConventions = {
    production: raw.deploy?.production
      ? deployTierGatesSchema.parse(raw.deploy.production)
      : undefined,
    sandbox: raw.deploy?.sandbox
      ? deployTierGatesSchema.parse(raw.deploy.sandbox)
      : undefined,
  };
  const connections: ConnectionConventions = connectionConventionsSchema.parse({
    allow: raw.connections?.allow ?? [],
    default_profile: raw.connections?.default_profile ?? null,
    production_session_ttl: raw.connections?.production_session_ttl ?? "2h",
    production_require_reason:
      raw.connections?.production_require_reason ?? true,
  });
  return { branches, commits, deploy, connections };
}
