import type { DxBase } from "../dx-root.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { styleBold, styleMuted } from "./list-helpers.js"
import { stubRun } from "./stub-run.js"

setExamples("ops", [
  "$ dx ops restart <target>              Restart a service",
  "$ dx ops scale <target> --replicas 3   Scale a service",
])

export function opsCommand(app: DxBase) {
  return app
    .sub("ops")
    .meta({
      description: "Platform operations: service controls",
    })

    .run(() => {
      console.log(
        styleBold("dx ops") + " — Service controls (restart, scale)\n"
      )
      console.log("Commands:")
      console.log("  dx ops restart <target>               Restart a service")
      console.log("  dx ops scale <target>                 Scale a service")
      console.log("")
      console.log(
        styleMuted(
          "For compose discovery and import, use dx scan [host] instead."
        )
      )
    })

    .command("restart", (c) =>
      c.meta({ description: "Restart services" }).run(stubRun)
    )
    .command("scale", (c) =>
      c.meta({ description: "Scale services" }).run(stubRun)
    )
}
