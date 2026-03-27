import { getFactoryClient } from "../client.js"
import {
  apiCall,
  colorStatus,
  actionResult,
  styleSuccess,
  tableOrJson,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

export async function runEntitlementList(
  flags: DxFlags,
  opts?: { customerId?: string },
): Promise<void> {
  const api = await getFactoryClient()
  const query = opts?.customerId ? { customerId: opts.customerId } : {}
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.entitlements.get({ query })
  )
  tableOrJson(
    flags,
    data,
    ["CUSTOMER", "MODULE", "STATUS"],
    (e) => [
      String(e.customerName ?? e.customerId ?? ""),
      String(e.moduleName ?? e.moduleId ?? ""),
      colorStatus(String(e.status ?? "")),
    ],
    undefined,
    { emptyMessage: "No entitlements found." },
  )
}

export async function runEntitlementGrant(
  flags: DxFlags,
  opts: { customerId: string; moduleId: string },
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.commerce.entitlements.post({
      customerId: opts.customerId,
      moduleId: opts.moduleId,
    })
  )
  actionResult(flags, data, styleSuccess(`Entitlement granted.`))
}

export async function runEntitlementRevoke(
  flags: DxFlags,
  id: string,
): Promise<void> {
  const api = await getFactoryClient()
  const data = await apiCall(flags, () =>
    (api.api.v1.factory.commerce.entitlements.delete as (opts: { query: { id: string } }) => Promise<{ data: unknown; error: unknown }>)({ query: { id } })
  )
  actionResult(flags, data, styleSuccess(`Entitlement ${id} revoked.`))
}
