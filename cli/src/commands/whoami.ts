import type { DxBase } from "../dx-root.js"
import { runWhoami } from "../handlers/whoami.js"

import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("whoami", [
  "$ dx whoami              Show current user",
  "$ dx whoami --json       Machine-readable output",
])

export function whoamiCommand(app: DxBase) {
  return app
    .sub("whoami")
    .meta({ description: "Print the current signed-in user" })
    .run(async ({ flags }) => {
      await runWhoami(toDxFlags(flags))
    })
}
