/**
 * CliConfig — Effect service tag wrapping the existing DxConfig store.
 *
 * Provides config values as a flat Record<string, string> so Effect programs
 * can depend on configuration without importing the Crust store directly.
 */

import { Context, Layer } from "effect"

export class CliConfig extends Context.Tag("CliConfig")<
  CliConfig,
  Record<string, string>
>() {}

export function makeCliConfigLayer(
  config: Record<string, string>
): Layer.Layer<CliConfig> {
  return Layer.succeed(CliConfig, config)
}
