import { styleSuccess } from "../cli-style.js"
import { getFactoryClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

export async function runBundleGenerate(
  flags: DxFlags,
  opts: { customerId: string; siteId: string; expiresAt: string; gracePeriodDays?: number }
): Promise<void> {
  try {
    const api = await getFactoryClient()
    const res = await api.api.v1.commerce.bundles.post({
      customerId: opts.customerId,
      siteId: opts.siteId,
      expiresAt: opts.expiresAt,
      gracePeriodDays: opts.gracePeriodDays,
    })
    if (flags.json) {
      console.log(JSON.stringify(res.data, null, 2))
      return
    }
    const body = res.data as { data: { bundleId: string; encoded: string } }
    console.log(styleSuccess(`Bundle generated: ${body.data.bundleId}`))
    console.log(body.data.encoded)
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err))
  }
}
