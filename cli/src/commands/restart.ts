import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { SiteOrchestrator } from "../lib/site-orchestrator.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("restart", [
  "$ dx restart           Restart all native dev servers",
  "$ dx restart api       Restart a specific component",
])

export function restartCommand(app: DxBase) {
  return app
    .sub("restart")
    .meta({ description: "Restart native dev servers" })
    .args([
      {
        name: "component",
        type: "string",
        description: "Component to restart (omit for all)",
      },
    ])
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      try {
        const orch = await SiteOrchestrator.create({ quiet: f.quiet })
        const component = args.component as string | undefined

        if (component) {
          const result = await orch.restartComponent(component)
          console.log(
            `Restarted ${result.name} on :${result.port} (PID ${result.pid})`
          )
        } else {
          await orch.restartDevServers()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
