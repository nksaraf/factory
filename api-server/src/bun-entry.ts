import "./instrumentation.js" // must be first — sets up OTel before modules load
import "dotenv/config"
import { FactoryAPI } from "@smp/factory-api"
import { getMode } from "@smp/factory-api/settings"
import { logger } from "@smp/factory-api/logger"

const port = Number(process.env.PORT || 4100)

const service = await FactoryAPI.create()
const mode = getMode(service.settings)
if (mode === "factory" || mode === "dev") {
  await service.setupDb()
}

const app = service.createApp()
app.listen(port, () => {
  logger.info(`Listening on http://[::]:${port}`)
})
