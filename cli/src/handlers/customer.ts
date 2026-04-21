import { getFactoryClient, getFactoryRestClient } from "../client.js"
import {
  actionResult,
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
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
  id: string
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

export async function runCustomerCreate(
  flags: DxFlags,
  opts: { slug: string; name: string; type?: string; billingEmail?: string }
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.customers.post({
      slug: opts.slug,
      name: opts.name,
      spec: { type: opts.type ?? "direct", billingEmail: opts.billingEmail },
    })
  )
  actionResult(flags, data, styleSuccess(`Customer "${opts.slug}" created.`))
}

export async function runCustomerAction(
  flags: DxFlags,
  slug: string,
  action: string
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await apiCall(flags, async () => {
    const res = await rest.entityAction("commerce", "customers", slug, action)
    return { data: res.data, error: undefined }
  })
  actionResult(flags, data, styleSuccess(`Customer "${slug}" ${action}d.`))
}
