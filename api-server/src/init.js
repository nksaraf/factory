import "dotenv/config"
import { FactoryAPI } from "@smp/factory-api"
import { getMode } from "@smp/factory-api/settings"

export default async function () {
  const service = await FactoryAPI.create()
  const mode = getMode(service.settings)

  if (mode === "factory" || mode === "dev") {
    await service.setupDb()
  }

  global._appPromise = service.createApp()
}
