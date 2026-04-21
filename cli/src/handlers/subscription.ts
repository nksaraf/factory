import { getFactoryClient, getFactoryRestClient } from "../client.js"
import {
  apiCall,
  colorStatus,
  detailView,
  actionResult,
  styleSuccess,
  styleBold,
  styleMuted,
  tableOrJson,
  timeAgo,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

export async function runSubscriptionList(
  flags: DxFlags,
  opts?: { customerId?: string; status?: string }
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.subscriptions.get({ query: { ...opts } })
  )
  tableOrJson(
    flags,
    data,
    ["ID", "CUSTOMER", "PLAN", "STATUS", "PERIOD END"],
    (s) => [
      String(s.subscriptionId ?? s.id ?? ""),
      String(s.customerId ?? "-"),
      String(s.planId ?? "-"),
      colorStatus(String(s.status ?? "")),
      s.currentPeriodEnd ? timeAgo(String(s.currentPeriodEnd)) : "-",
    ],
    undefined,
    { emptyMessage: "No subscriptions found." }
  )
}

export async function runSubscriptionShow(
  flags: DxFlags,
  id: string
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.subscriptions({ slugOrId: id }).get()
  )
  detailView(flags, data, [
    ["ID", (r) => styleMuted(String(r.subscriptionId ?? r.id ?? ""))],
    ["Customer", (r) => styleBold(String(r.customerId ?? "-"))],
    ["Plan", (r) => String(r.planId ?? "-")],
    ["Status", (r) => colorStatus(String(r.status ?? ""))],
    [
      "Period Start",
      (r) =>
        r.currentPeriodStart ? timeAgo(String(r.currentPeriodStart)) : "-",
    ],
    [
      "Period End",
      (r) => (r.currentPeriodEnd ? timeAgo(String(r.currentPeriodEnd)) : "-"),
    ],
    ["Created", (r) => timeAgo(String(r.createdAt ?? ""))],
  ])
}

export async function runSubscriptionCreate(
  flags: DxFlags,
  opts: { customerId: string; planId: string }
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.subscriptions.post({
      customerId: opts.customerId,
      planId: opts.planId,
      spec: {
        status: "trialing",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
  )
  actionResult(
    flags,
    data,
    `${styleSuccess("Subscription created")} for customer ${styleBold(opts.customerId)}`
  )
}

export async function runSubscriptionAction(
  flags: DxFlags,
  id: string,
  action: string,
  body?: Record<string, unknown>
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await apiCall(flags, async () => {
    const res = await rest.entityAction(
      "commerce",
      "subscriptions",
      id,
      action,
      body
    )
    return { data: res.data, error: undefined }
  })
  actionResult(
    flags,
    data,
    `${styleSuccess(`Subscription ${action}ed`)} ${styleMuted(id)}`
  )
}
