import "dotenv/config"

import { FactoryAPI } from "./factory.api"
import { getMode } from "./settings"

export async function createServer() {
  const service = await FactoryAPI.create()
  const mode = getMode(service.settings)

  if (mode === "factory" || mode === "dev") {
    await service.setupDb()
  }

  return service.createApp()
}

export type Server = Awaited<ReturnType<typeof createServer>>
