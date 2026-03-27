import { z } from "zod";

/**
 * Single settings model for factory-api: YAML (`config/application.yml`), profiles,
 * `config/.env`, and env vars via @rio.js/app-config.
 *
 * Env overlay: FACTORY_DATABASE_URL, FACTORY_AUTH_JWKS_URL, FACTORY_LOG_LEVEL, FACTORY_LOG_FORMAT
 */
export const factoryModes = ["factory", "site", "dev"] as const;
export type FactoryMode = (typeof factoryModes)[number];

export const factorySettingsSchema = z.object({
  factory: z
    .object({
      mode: z.enum(factoryModes).default("factory"),
      database: z
        .object({
          url: z.string().default(""),
        })
        .default({}),
      auth: z
        .object({
          jwksUrl: z.string().default(""),
          serviceUrl: z.string().default(""),
        })
        .default({}),
      redis: z
        .object({
          url: z.string().default(""),
        })
        .default({}),
      log: z
        .object({
          level: z
            .enum(["trace", "debug", "info", "warn", "error", "fatal"])
            .default("info"),
          format: z.enum(["json", "pretty"]).default("json"),
        })
        .default({}),
      site: z
        .object({
          name: z.string().default(""),
          factoryUrl: z.string().default(""),
          namespace: z.string().default("default"),
          issuerName: z.string().default("letsencrypt-prod"),
          pollIntervalMs: z.number().default(10_000),
          crdOutputDir: z.string().default(""),
        })
        .default({}),
    })
    .default({}),
});

export type FactorySettings = z.infer<typeof factorySettingsSchema>;

/** Non-empty connection URL, or undefined. */
export function getDatabaseUrl(s: FactorySettings): string | undefined {
  const v = (s.factory.database.url ?? "").trim();
  return v === "" ? undefined : v;
}

/** Non-empty JWKS URL, or undefined. */
export function getJwksUrl(s: FactorySettings): string | undefined {
  const v = (s.factory.auth.jwksUrl ?? "").trim();
  return v === "" ? undefined : v;
}

/** Resolved run mode. */
export function getMode(s: FactorySettings): FactoryMode {
  return s.factory.mode;
}

/** Non-empty auth service URL, or undefined. */
export function getAuthServiceUrl(s: FactorySettings): string | undefined {
  const v = (s.factory.auth.serviceUrl ?? "").trim();
  return v === "" ? undefined : v;
}

/** Non-empty Redis URL, or undefined. */
export function getRedisUrl(s: FactorySettings): string | undefined {
  const v = (s.factory.redis.url ?? "").trim();
  return v === "" ? undefined : v;
}

/** Site-side config (meaningful only when mode is "site" or "dev"). */
export function getSiteConfig(s: FactorySettings) {
  return s.factory.site;
}
