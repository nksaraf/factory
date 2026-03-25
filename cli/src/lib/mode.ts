import { loadConfig } from "../config.js"

export type DxMode = "factory" | "site" | "dev"

/**
 * Infer the CLI operating mode.
 *
 * Priority: DX_MODE env → FACTORY_MODE env → config.mode → default "factory"
 */
export function inferMode(): DxMode {
  const env = process.env.DX_MODE ?? process.env.FACTORY_MODE
  if (env && isValidMode(env)) return env

  const cfg = loadConfig()
  if (cfg.mode && isValidMode(cfg.mode)) return cfg.mode

  return "factory"
}

function isValidMode(v: string): v is DxMode {
  return v === "factory" || v === "site" || v === "dev"
}
