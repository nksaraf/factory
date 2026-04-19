import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { SiteOrchestrator } from "../lib/site-orchestrator.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("stop", [
  "$ dx stop              Stop all native dev servers",
  "$ dx stop api          Stop a specific component",
])

export function stopCommand(app: DxBase) {
  return app
    .sub("stop")
    .meta({ description: "Stop native dev servers" })
    .args([
      {
        name: "component",
        type: "string",
        description: "Component to stop (omit for all)",
      },
    ])
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      try {
        const orch = await SiteOrchestrator.create({ quiet: f.quiet })
        const stopped = orch.stop(args.component as string | undefined)

        if (stopped.length === 0) {
          console.log("No running dev servers to stop.")
          return
        }

        for (const s of stopped) {
          console.log(`Stopped ${s.name} (PID ${s.pid})`)
        }
        orch.site.setPhase("stopped")
        orch.site.save()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
