import type { DxBase } from "../dx-root.js"
import {
  runBillableMetricList,
  runBillableMetricShow,
  runBillableMetricCreate,
} from "../handlers/billable-metric.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("billable-metric", [
  "$ dx billable-metric list                          List all billable metrics",
  "$ dx billable-metric list --json                   Output as JSON",
  "$ dx billable-metric show api-calls                Show metric details",
  '$ dx billable-metric create --slug api-calls --name "API Calls" --capability-id cap_123 --event-name api.call --aggregation count   Create a metric',
])

export function billableMetricCommand(app: DxBase) {
  return app
    .sub("billable-metric")
    .meta({ description: "Billable metrics" })
    .command("list", (c) =>
      c.meta({ description: "List billable metrics" }).run(({ flags }) => {
        return runBillableMetricList(toDxFlags(flags))
      })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show billable metric" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Billable metric slug",
          },
        ])
        .run(({ args, flags }) => {
          return runBillableMetricShow(toDxFlags(flags), args.slug)
        })
    )
    .command("create", (c) =>
      c
        .meta({ description: "Create billable metric" })
        .flags({
          slug: { type: "string", required: true, description: "Metric slug" },
          name: { type: "string", required: true, description: "Metric name" },
          "capability-id": {
            type: "string",
            required: true,
            description: "Capability ID",
          },
          "event-name": {
            type: "string",
            required: true,
            description: "Event name to track",
          },
          aggregation: {
            type: "string",
            required: true,
            description: "Aggregation type",
          },
        })
        .run(({ flags }) => {
          return runBillableMetricCreate(toDxFlags(flags), {
            slug: flags.slug,
            name: flags.name,
            capabilityId: flags["capability-id"],
            eventName: flags["event-name"],
            aggregation: flags.aggregation,
          })
        })
    )
}
