import { getFactoryClient } from "../client.js"
import {
  apiCall,
  actionResult,
  styleSuccess,
  styleBold,
  styleMuted,
  tableOrJson,
  detailView,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

export async function runBillableMetricList(flags: DxFlags): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce["billable-metrics"].get()
  )
  tableOrJson(
    flags,
    data,
    ["SLUG", "NAME", "EVENT", "AGGREGATION"],
    (m) => {
      const spec = (m.spec ?? {}) as Record<string, unknown>
      return [
        String(m.slug ?? "-"),
        String(m.name ?? ""),
        String(spec.eventName ?? "-"),
        String(spec.aggregation ?? "-"),
      ]
    },
    undefined,
    { emptyMessage: "No billable metrics found." }
  )
}

export async function runBillableMetricShow(
  flags: DxFlags,
  slug: string
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce["billable-metrics"]({ slugOrId: slug }).get()
  )
  detailView(flags, data, [
    ["Name", (r) => styleBold(String(r.name ?? ""))],
    ["Slug", (r) => String(r.slug ?? "-")],
    ["ID", (r) => styleMuted(String(r.billableMetricId ?? ""))],
    ["Capability ID", (r) => String(r.capabilityId ?? "-")],
    [
      "Event Name",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.eventName ?? "-")
      },
    ],
    [
      "Aggregation",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.aggregation ?? "-")
      },
    ],
  ])
}

export async function runBillableMetricCreate(
  flags: DxFlags,
  opts: {
    slug: string
    name: string
    capabilityId: string
    eventName: string
    aggregation: string
  }
): Promise<void> {
  const api = await getFactoryClient()
  const result = await apiCall(flags, () =>
    api.api.v1.factory.commerce["billable-metrics"].post({
      slug: opts.slug,
      name: opts.name,
      capabilityId: opts.capabilityId,
      spec: {
        eventName: opts.eventName,
        aggregation: opts.aggregation,
      },
    })
  )
  actionResult(
    flags,
    result,
    styleSuccess(`Billable metric ${styleBold(opts.slug)} created.`)
  )
}
