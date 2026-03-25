import { ExitCodes } from "@smp/factory-shared/exit-codes";

import type { DxFlags } from "../stub.js";

export function exitWithError(
  flags: DxFlags,
  message: string,
  code: number = ExitCodes.GENERAL_FAILURE
): never {
  if (flags.json) {
    console.log(
      JSON.stringify({
        success: false,
        error: { message },
        exitCode: code,
      })
    );
    process.exit(code);
  }
  console.error(message);
  process.exit(code);
}
