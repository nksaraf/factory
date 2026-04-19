import { Layer } from "effect"
import type { Database } from "../db/connection"
import type { FactorySettings } from "../settings"
import { makeDbLayer } from "./layers/database"
import { makeConfigLayer } from "./layers/config"

export function createAppLayer(db: Database, settings: FactorySettings) {
  return Layer.mergeAll(makeDbLayer(db), makeConfigLayer(settings))
}

export type AppLayer = Layer.Layer.Success<ReturnType<typeof createAppLayer>>
