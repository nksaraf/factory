import { ExitCodes } from "@smp/factory-shared/exit-codes";
import { styleMuted } from "../cli-style.js";
import type { DxFlags } from "../stub.js";

export function exitWithError(
  flags: DxFlags,
  message: string,
  code: number = ExitCodes.GENERAL_FAILURE,
  suggestions?: Array<{ action: string; description: string }>,
): never {
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: { message, ...(suggestions ? { suggestions } : {}) },
          exitCode: code,
        },
        null,
        2,
      ),
    );
    process.exit(code);
  }
  console.error(message);
  if (suggestions) {
    for (const s of suggestions) {
      console.error(styleMuted(`  hint: ${s.action} — ${s.description}`));
    }
  }
  process.exit(code);
}
