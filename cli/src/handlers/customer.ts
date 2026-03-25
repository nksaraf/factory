import { styleSuccess, styleMuted } from "../cli-style.js"
import { getFactoryClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

export async function runCustomerList(flags: DxFlags): Promise<void> {
  try {
    const api = await getFactoryClient()
    const res = await api.api.v1.commerce.customers.get()
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as {
      data: { customerId: string; name: string; status: string }[]
    }
    if (!body.data.length) {
      console.log(styleMuted("No customers found."))
      return
    }
    for (const c of body.data) {
      console.log(styleSuccess(`${c.customerId}  ${c.name}  [${c.status}]`))
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}

export async function runCustomerShow(
  flags: DxFlags,
  id: string
): Promise<void> {
  try {
    const api = await getFactoryClient()
    const res = await api.api.v1.commerce.customers({ id }).get()
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as {
      data: { customerId: string; name: string; status: string } | null
    }
    if (!body?.data) {
      console.log(styleMuted("Customer not found."))
      return
    }
    console.log(
      styleSuccess(
        `${body.data.customerId}  ${body.data.name}  [${body.data.status}]`
      )
    )
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
