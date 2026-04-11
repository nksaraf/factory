import { ExitCodes } from "@smp/factory-shared/exit-codes"
import { styleMuted } from "../cli-style.js"
import type { DxFlags } from "../stub.js"
import { DxError } from "./dx-error.js"

/**
 * Exit with a plain message + optional suggestions.
 * Prefer `exitWithDxError` for errors that carry structured context.
 */
export function exitWithError(
  flags: DxFlags,
  message: string,
  code: number = ExitCodes.GENERAL_FAILURE,
  suggestions?: Array<{ action: string; description: string }>
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
        2
      )
    )
    process.exit(code)
  }
  console.error(message)
  if (suggestions) {
    for (const s of suggestions) {
      console.error(styleMuted(`  hint: ${s.action} — ${s.description}`))
    }
  }
  process.exit(code)
}

/**
 * Exit with a DxError, rendering its full context chain.
 * With --verbose, also prints stack traces and cause chain.
 */
export function exitWithDxError(
  flags: DxFlags,
  err: DxError,
  code: number = ExitCodes.GENERAL_FAILURE
): never {
  const isVerbose = flags.verbose || flags.debug
  const ctx = err.context

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            message: err.message,
            code: ctx.code,
            operation: ctx.operation,
            metadata: ctx.metadata,
            suggestions: ctx.suggestions,
            ...(isVerbose ? { stack: err.stack } : {}),
          },
          exitCode: code,
        },
        null,
        2
      )
    )
    process.exit(code)
  }

  console.error(err.message)
  console.error(styleMuted(`  operation: ${ctx.operation}`))
  if (ctx.metadata) {
    for (const [k, v] of Object.entries(ctx.metadata)) {
      const val = typeof v === "string" ? v : JSON.stringify(v)
      console.error(styleMuted(`  ${k}: ${val}`))
    }
  }
  if (ctx.suggestions) {
    for (const s of ctx.suggestions) {
      console.error(styleMuted(`  hint: ${s.action} — ${s.description}`))
    }
  }
  if (isVerbose) {
    console.error(styleMuted(`\n${err.stack}`))
    let cause = err.cause as Error | undefined
    while (cause) {
      console.error(styleMuted(`\nCaused by: ${cause.message}`))
      if (cause.stack) console.error(styleMuted(cause.stack))
      cause = cause.cause as Error | undefined
    }
  }
  process.exit(code)
}
