import type { DxBase } from "../dx-root.js"
import { runPlanList, runPlanShow, runPlanCreate } from "../handlers/plan.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("plan", [
  "$ dx plan list                     List pricing plans",
  "$ dx plan list --json              Output as JSON",
  "$ dx plan show starter             Show plan details",
  "$ dx plan create --slug starter --name 'Starter' --type base --price 2999",
])

export function planCommand(app: DxBase) {
  return app
    .sub("plan")
    .meta({ description: "Pricing plans" })
    .command("list", (c) =>
      c.meta({ description: "List plans" }).run(({ flags }) => {
        return runPlanList(toDxFlags(flags))
      })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show plan details" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Plan slug",
          },
        ])
        .run(({ args, flags }) => {
          return runPlanShow(toDxFlags(flags), args.slug)
        })
    )
    .command("create", (c) =>
      c
        .meta({ description: "Create a pricing plan" })
        .flags({
          slug: {
            type: "string",
            required: true,
            description: "Plan slug",
          },
          name: {
            type: "string",
            required: true,
            description: "Plan name",
          },
          type: {
            type: "string",
            required: true,
            description: "Plan type (base, add-on, suite)",
          },
          price: {
            type: "number",
            required: true,
            description: "Price in cents",
          },
          interval: {
            type: "string",
            description: "Billing interval (default: monthly)",
          },
        })
        .run(({ flags }) => {
          return runPlanCreate(toDxFlags(flags), {
            slug: flags.slug as string,
            name: flags.name as string,
            type: flags.type as string,
            price: flags.price as number,
            billingInterval: flags.interval as string | undefined,
          })
        })
    )
}
