/** Vinxi plugin: no-op. Migrations are handled by createServer() in server.ts. */


import "dotenv/config"

import { FactoryAPI } from "./factory.api"
import { getMode } from "./settings"

let appPromise = global._appPromise

export default async function () {
  const service = await FactoryAPI.create()

  const mode = getMode(service.settings)

  if (mode === "factory" || mode === "dev") {
    await service.setupDb()
  }

  global._appPromise = service.createApp()
}
