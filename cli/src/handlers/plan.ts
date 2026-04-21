import { getFactoryClient } from "../client.js"
import {
  actionResult,
  apiCall,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
  timeAgo,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

export async function runPlanList(flags: DxFlags): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.plans.get()
  )
  tableOrJson(
    flags,
    data,
    ["SLUG", "NAME", "TYPE", "PRICE", "INTERVAL"],
    (p) => {
      const spec = (p.spec ?? {}) as Record<string, unknown>
      return [
        String(p.slug ?? "-"),
        String(p.name ?? ""),
        String(spec.type ?? p.type ?? "-"),
        String(spec.price ?? "-"),
        String(spec.billingInterval ?? "monthly"),
      ]
    },
    undefined,
    { emptyMessage: "No plans found." }
  )
}

export async function runPlanShow(flags: DxFlags, slug: string): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.plans({ slugOrId: slug }).get()
  )
  detailView(flags, data, [
    ["Name", (r) => styleBold(String(r.name ?? ""))],
    ["Slug", (r) => String(r.slug ?? "-")],
    [
      "Type",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.type ?? r.type ?? "-")
      },
    ],
    [
      "Price",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.price ?? "-")
      },
    ],
    [
      "Interval",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.billingInterval ?? "monthly")
      },
    ],
    [
      "Trial Days",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.trialDays ?? "0")
      },
    ],
    [
      "Public",
      (r) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return String(spec.isPublic ?? false)
      },
    ],
    ["Created", (r) => timeAgo(String(r.createdAt ?? ""))],
  ])
}

export async function runPlanCreate(
  flags: DxFlags,
  opts: {
    slug: string
    name: string
    type: string
    price: number
    billingInterval?: string
  }
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.plans.post({
      slug: opts.slug,
      name: opts.name,
      type: opts.type,
      spec: {
        price: opts.price,
        billingInterval: opts.billingInterval ?? "monthly",
      },
    })
  )
  actionResult(flags, data, styleSuccess(`Plan "${opts.slug}" created.`))
}
