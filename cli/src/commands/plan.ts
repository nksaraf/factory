import type { DxBase } from "../dx-root.js"
import { runPlanList } from "../handlers/plan.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("plan", ["$ dx plan list             List pricing plans"])

export function planCommand(app: DxBase) {
  return app
    .sub("plan")
    .meta({ description: "Pricing plans" })
    .command("list", (c) =>
      c.meta({ description: "List plans" }).run(({ flags }) => {
        return runPlanList(toDxFlags(flags))
      })
    )
}
