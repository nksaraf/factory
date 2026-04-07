/**
 * Centralized environment configuration with Zod validation.
 *
 * Import `env` instead of accessing `process.env` directly.
 * All env vars are validated at import time — the process fails fast
 * if required vars are missing or malformed.
 *
 * Note: This supplements (does not replace) resolve-settings.ts which
 * handles the YAML config system. This covers env vars used outside
 * that config pipeline (reconciler, logger, services, etc.).
 */

import { z } from "zod";

const EnvSchema = z.object({
  // ── Core ──────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  FACTORY_MODE: z
    .enum(["factory", "site", "dev"])
    .optional(),
  DX_MODE: z
    .enum(["factory", "site", "dev"])
    .optional(),

  // ── Database ──────────────────────────────────────────────
  DATABASE_URL: z.string().optional(),
  FACTORY_DATABASE_URL: z.string().optional(),

  // ── Auth ──────────────────────────────────────────────────
  BETTER_AUTH_BASE_URL: z.string().optional(),
  BETTER_AUTH_JWKS_PATH: z.string().optional(),

  // ── Logging ───────────────────────────────────────────────
  FACTORY_LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  FACTORY_LOG_FORMAT: z
    .enum(["json", "pretty"])
    .default("json"),

  // ── Gateway / Networking ──────────────────────────────────
  DX_GATEWAY_DOMAIN: z.string().default("dx.dev"),
  DX_FACTORY_WS_URL: z.string().default("wss://factory.dx.dev/ws"),
  SANDBOX_INGRESS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // ── Secrets ───────────────────────────────────────────────
  FACTORY_SECRET_MASTER_KEY: z.string().optional(),
  ENTITLEMENT_SIGNING_KEY: z.string().optional(),
  ENTITLEMENT_PUBLIC_KEY: z.string().optional(),

  // ── Site Config ───────────────────────────────────────────
  FACTORY_SITE_NAME: z.string().optional(),
  FACTORY_URL: z.string().optional(),

  // ── Reconciler ────────────────────────────────────────────
  SANDBOX_STORAGE_CLASS: z.string().default("csi-hostpath-sc"),
  ENVBUILDER_CACHE_REPO: z.string().optional(),
  ENVBUILDER_IMAGE: z.string().optional(),
  PREVIEW_REGISTRY: z.string().default("registry.dx.dev"),

  // ── LLM ───────────────────────────────────────────────────
  LLM_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-sonnet-4-20250514"),

  // ── Test-only ─────────────────────────────────────────────
  __DX_SKIP_GATEWAY_ONSTART: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validated environment. Access as `env.DATABASE_URL`, `env.DX_GATEWAY_DOMAIN`, etc.
 *
 * Throws a ZodError at startup if any var fails validation.
 */
export const env: Env = EnvSchema.parse(process.env);
