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
    const resRaw = res.data
    const resData = (resRaw && typeof resRaw === "object" ? resRaw : undefined) as Record<string, unknown> | undefined
    const plansRaw = (resData && "data" in resData ? resData.data : resData)
    const plans = (Array.isArray(plansRaw) ? plansRaw : undefined) as Array<{ planId: string; name: string; includedModules: string[] }> | undefined
    if (!plans?.length) {
      console.log(styleMuted("No plans found."))
      return
    }
    for (const p of plans) {
      console.log(styleSuccess(`${p.planId}  ${p.name}  modules=${(p.includedModules ?? []).join(",")}`))
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
