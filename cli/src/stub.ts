import { ExitCodes } from "@smp/factory-shared/exit-codes"

import { styleWarn } from "./cli-style.js"

export type DxFlags = {
  json?: boolean
  verbose?: boolean
  quiet?: boolean
  debug?: boolean
}

export function emitStub(
  flags: DxFlags,
  message = "Not yet implemented"
): void {
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code: "NYI",
            message,
            suggestions: [
              {
                action: "watch",
                description:
                  "Track Software Factory implementation plans for this command",
              },
            ],
          },
          exitCode: ExitCodes.GENERAL_FAILURE,
        },
        null,
        2
      )
    )
    process.exit(ExitCodes.GENERAL_FAILURE)
    return
  }
  console.error(styleWarn(message))
}
