import { getFactoryClient } from "../client.js"
import {
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  tableOrJson,
  timeAgo,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

export async function runCustomerList(flags: DxFlags): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.customers.get()
  )
  tableOrJson(
    flags,
    data,
    ["NAME", "SLUG", "STATUS"],
    (c) => [
      String(c.name ?? ""),
      String(c.slug ?? "-"),
      colorStatus(String(c.status ?? "")),
    ],
    undefined,
    { emptyMessage: "No customers found." }
  )
}

export async function runCustomerShow(
  flags: DxFlags,
  id: string,
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.customers({ slugOrId: id }).get()
  )
  detailView(flags, data, [
    ["Name", (r) => styleBold(String(r.name ?? ""))],
    ["Slug", (r) => String(r.slug ?? "-")],
    ["ID", (r) => styleMuted(String(r.customerId ?? ""))],
    ["Status", (r) => colorStatus(String(r.status ?? ""))],
    ["Created", (r) => timeAgo(String(r.createdAt ?? ""))],
  ])
}
