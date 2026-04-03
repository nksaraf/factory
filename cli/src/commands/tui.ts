import type { DxBase } from "../dx-root.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("tui", [
  "$ dx tui                          Launch interactive dashboard",
  "$ dx tui --tab logs               Open directly to logs tab",
  "$ dx tui --api http://localhost:4200  Connect to custom API",
])

export function tuiCommand(app: DxBase) {
  return app
    .sub("tui")
    .meta({ description: "Interactive terminal dashboard" })
    .flags({
      tab: {
        type: "string",
        description: "Open to a specific tab (infra, fleet, sandbox, build, gateway, commerce, alerts, logs)",
      },
      api: {
        type: "string",
        description: "Factory API URL override (default: from config)",
      },
    })
    .run(async ({ flags }) => {
      // Set DX_FACTORY_URL so getFactoryClient() picks it up
      if (flags.api) {
        process.env.DX_FACTORY_URL = flags.api as string
      }
      const { renderApp } = await import("../tui/app.js")
      await renderApp({ initialTab: flags.tab as string | undefined })
    })
}
