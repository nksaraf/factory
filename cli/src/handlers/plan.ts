import { styleSuccess, styleMuted } from "../cli-style.js"
import { getFactoryClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

export async function runPlanList(flags: DxFlags): Promise<void> {
  try {
    const api = await getFactoryClient()
    const res = await api.api.v1.factory.commerce.plans.get()
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as {
      data: { planId: string; name: string; includedModules: string[] }[]
    }
    if (!body.data.length) {
      console.log(styleMuted("No plans found."))
      return
    }
    for (const p of body.data) {
      console.log(styleSuccess(`${p.planId}  ${p.name}  modules=${(p.includedModules ?? []).join(",")}`))
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
