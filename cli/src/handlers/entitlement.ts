import { styleSuccess, styleMuted } from "../cli-style.js"
import { getFactoryClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

export async function runEntitlementList(
  flags: DxFlags,
  opts?: { customerId?: string }
): Promise<void> {
  try {
    const api = await getFactoryClient()
    const query = opts?.customerId ? { customerId: opts.customerId } : {}
    const res = await api.api.v1.factory.commerce.entitlements.get({ query })
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as {
      data: {
        entitlementId: string
        customerId: string
        moduleId: string
        status: string
      }[]
    }
    if (!body.data.length) {
      console.log(styleMuted("No entitlements found."))
      return
    }
    for (const e of body.data) {
      console.log(
        styleSuccess(
          `${e.entitlementId}  customer=${e.customerId}  module=${e.moduleId}  [${e.status}]`
        )
      )
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}

export async function runEntitlementGrant(
  flags: DxFlags,
  opts: { customerId: string; moduleId: string }
): Promise<void> {
  try {
    const api = await getFactoryClient()
    const res = await api.api.v1.factory.commerce.entitlements.post({
      customerId: opts.customerId,
      moduleId: opts.moduleId,
    })
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as { data: { entitlementId: string } }
    console.log(styleSuccess(`Granted: ${body.data.entitlementId}`))
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}

export async function runEntitlementRevoke(
  flags: DxFlags,
  id: string
): Promise<void> {
  try {
    const api = await getFactoryClient()
    await (api.api.v1.factory.commerce.entitlements.delete as (opts: { query: { id: string } }) => Promise<unknown>)({ query: { id } })
    if (flags.json) {
      console.log(JSON.stringify({ success: true, id }, null, 2))
      return
    }
    console.log(styleSuccess(`Revoked: ${id}`))
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
