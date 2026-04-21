import type { DxBase } from "../dx-root.js"
import {
  runSubscriptionList,
  runSubscriptionShow,
  runSubscriptionCreate,
  runSubscriptionAction,
} from "../handlers/subscription.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("subscription", [
  "$ dx subscription list                          List all subscriptions",
  "$ dx subscription list --customer-id cust_123   Filter by customer",
  "$ dx subscription list --status active           Filter by status",
  "$ dx subscription show csub_abc                  Show subscription details",
  "$ dx subscription create --customer-id cust_123 --plan-id pln_456",
  "$ dx subscription cancel csub_abc --reason 'No longer needed'",
  "$ dx subscription pause csub_abc                 Pause subscription",
  "$ dx subscription resume csub_abc                Resume subscription",
])

export function subscriptionCommand(app: DxBase) {
  return app
    .sub("subscription")
    .meta({ description: "Subscriptions" })
    .command("list", (c) =>
      c
        .meta({ description: "List subscriptions" })
        .flags({
          "customer-id": {
            type: "string",
            description: "Filter by customer ID",
          },
          status: {
            type: "string",
            description: "Filter by status",
          },
        })
        .run(({ flags }) => {
          return runSubscriptionList(toDxFlags(flags), {
            customerId: flags["customer-id"] as string | undefined,
            status: flags.status as string | undefined,
          })
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show subscription" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Subscription ID",
          },
        ])
        .run(({ args, flags }) => {
          return runSubscriptionShow(toDxFlags(flags), args.id)
        })
    )
    .command("create", (c) =>
      c
        .meta({ description: "Create subscription" })
        .flags({
          "customer-id": {
            type: "string",
            required: true,
            description: "Customer ID",
          },
          "plan-id": {
            type: "string",
            required: true,
            description: "Plan ID",
          },
        })
        .run(({ flags }) => {
          return runSubscriptionCreate(toDxFlags(flags), {
            customerId: flags["customer-id"] as string,
            planId: flags["plan-id"] as string,
          })
        })
    )
    .command("cancel", (c) =>
      c
        .meta({ description: "Cancel subscription" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Subscription ID",
          },
        ])
        .flags({
          reason: {
            type: "string",
            description: "Cancellation reason",
          },
        })
        .run(({ args, flags }) => {
          return runSubscriptionAction(toDxFlags(flags), args.id, "cancel", {
            reason: flags.reason as string | undefined,
          })
        })
    )
    .command("pause", (c) =>
      c
        .meta({ description: "Pause subscription" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Subscription ID",
          },
        ])
        .run(({ args, flags }) => {
          return runSubscriptionAction(toDxFlags(flags), args.id, "pause")
        })
    )
    .command("resume", (c) =>
      c
        .meta({ description: "Resume subscription" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Subscription ID",
          },
        ])
        .run(({ args, flags }) => {
          return runSubscriptionAction(toDxFlags(flags), args.id, "resume")
        })
    )
}
