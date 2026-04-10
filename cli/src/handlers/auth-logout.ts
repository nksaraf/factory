import { ExitCodes } from "@smp/factory-shared/exit-codes"

import { createFactoryAuthClient } from "../auth-factory.js"
import { styleMuted, styleSuccess } from "../cli-style.js"
import { clearAuthSession, getAuthServiceToken } from "../session-token.js"
import type { DxFlags } from "../stub.js"

export async function runAuthLogout(flags: DxFlags): Promise<void> {
  const hadToken = Boolean(await getAuthServiceToken())
  if (hadToken) {
    const client = await createFactoryAuthClient(flags)
    await client.signOut().catch(() => {
      /* still clear local session */
    })
  }
  await clearAuthSession()

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: { signedOut: hadToken },
          exitCode: ExitCodes.SUCCESS,
        },
        null,
        2
      )
    )
    return
  }

  console.log(
    hadToken
      ? styleSuccess("Signed out. Local session removed.")
      : styleMuted("No local session was stored.")
  )
}
