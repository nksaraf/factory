/**
 * CLI error handler plugin — catches CrustErrors and formats them properly.
 * Handles JSON mode, typo suggestions, and proper exit codes.
 */
import { CrustError } from "@crustjs/core"
import type { CrustPlugin } from "@crustjs/core"
import { ExitCodes } from "@smp/factory-shared/exit-codes"

const isJson = process.argv.includes("--json") || process.argv.includes("-j")

export function errorHandlerPlugin(): CrustPlugin {
  return {
    name: "error-handler",

    async middleware(_ctx, next) {
      try {
        await next()
      } catch (err) {
        if (!(err instanceof CrustError)) throw err

        if (err.is("COMMAND_NOT_FOUND")) {
          const { input, available } = err.details
          const suggestion = closestMatch(input, available)
          let msg = suggestion
            ? `Unknown command "${input}". Did you mean "${suggestion}"?`
            : `Unknown command "${input}".`

          if (isJson) {
            console.log(
              JSON.stringify({
                success: false,
                error: { message: msg },
                exitCode: ExitCodes.USAGE_ERROR,
              })
            )
          } else {
            console.error(msg)
            if (available.length > 0)
              console.error(`\nAvailable commands: ${available.join(", ")}`)
          }
          process.exit(ExitCodes.USAGE_ERROR)
        }

        if (err.is("VALIDATION")) {
          const msg = err.message
          if (isJson) {
            console.log(
              JSON.stringify({
                success: false,
                error: { message: msg },
                exitCode: ExitCodes.USAGE_ERROR,
              })
            )
          } else {
            console.error(msg)
            console.error("Run 'dx <command> --help' for usage.")
          }
          process.exit(ExitCodes.USAGE_ERROR)
        }

        // Re-throw other CrustErrors
        throw err
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Levenshtein-based typo suggestion
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const row = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const val = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost)
      row[j - 1] = prev
      prev = val
    }
    row[n] = prev
  }
  return row[n]
}

function closestMatch(input: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    if (c.startsWith(input) || input.startsWith(c)) return c
    const d = levenshtein(input, c)
    if (d <= 3 && d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}
