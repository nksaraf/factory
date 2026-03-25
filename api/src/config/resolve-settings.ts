import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveConfig } from "@rio.js/app-config";

import {
  factorySettingsSchema,
  type FactorySettings,
} from "../settings.js";

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const CONFIG_DIR = path.join(PKG_ROOT, "config");

function emptyToUndefined(s: string): string | undefined {
  const t = s.trim();
  return t === "" ? undefined : t;
}

/**
 * Apply env fallbacks not covered by the FACTORY_* overlay alone.
 */
function applyEnvFallbacks(s: FactorySettings): FactorySettings {
  let dbUrl = emptyToUndefined(s.factory.database.url);
  if (!dbUrl && process.env.DATABASE_URL) {
    dbUrl = process.env.DATABASE_URL.trim();
  }

  let jwksUrl = emptyToUndefined(s.factory.auth.jwksUrl);
  if (
    !jwksUrl &&
    process.env.BETTER_AUTH_BASE_URL &&
    process.env.BETTER_AUTH_JWKS_PATH
  ) {
    jwksUrl = `${process.env.BETTER_AUTH_BASE_URL}${process.env.BETTER_AUTH_JWKS_PATH}`;
  }

  // Mode: FACTORY_MODE or DX_MODE env fallback
  let mode = s.factory.mode;
  const envMode = process.env.FACTORY_MODE ?? process.env.DX_MODE;
  if (envMode && (envMode === "factory" || envMode === "site" || envMode === "dev")) {
    mode = envMode;
  }

  // Site config env fallbacks
  const siteName = emptyToUndefined(s.factory.site.name) ?? process.env.FACTORY_SITE_NAME?.trim() ?? "";
  const siteFactoryUrl = emptyToUndefined(s.factory.site.factoryUrl) ?? process.env.FACTORY_URL?.trim() ?? "";

  return {
    factory: {
      ...s.factory,
      mode,
      database: { url: dbUrl ?? "" },
      auth: { jwksUrl: jwksUrl ?? "" },
      log: s.factory.log,
      site: {
        ...s.factory.site,
        name: siteName,
        factoryUrl: siteFactoryUrl,
      },
    },
  };
}

export async function resolveFactorySettings(): Promise<FactorySettings> {
  const raw = await resolveConfig(factorySettingsSchema, {
    configDir: CONFIG_DIR,
    envPrefix: [],
  });
  return applyEnvFallbacks(raw);
}
