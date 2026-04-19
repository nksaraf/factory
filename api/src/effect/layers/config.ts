import { Context, Layer } from "effect"
import type { FactorySettings } from "../../settings"

export class FactoryConfig extends Context.Tag("FactoryConfig")<
  FactoryConfig,
  FactorySettings
>() {}

export const makeConfigLayer = (settings: FactorySettings) =>
  Layer.succeed(FactoryConfig, settings)
