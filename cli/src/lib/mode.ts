import { readConfig } from "../config.js"

export type DxMode = "factory" | "site" | "dev"

/**
 * Infer the CLI operating mode.
 *
 * Priority: DX_MODE env → FACTORY_MODE env → config.mode → default "factory"
 */
export async function inferMode(): Promise<DxMode> {
  const env = process.env.DX_MODE ?? process.env.FACTORY_MODE
  if (env && isValidMode(env)) return env

  const config = await readConfig()
  const mode =
    config.role === "factory"
      ? "factory"
      : config.role === "site"
        ? "site"
        : "dev"
  if (isValidMode(mode)) return mode

  return "factory"
}

function isValidMode(v: string): v is DxMode {
  return v === "factory" || v === "site" || v === "dev"
}
