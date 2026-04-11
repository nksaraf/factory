import type { QualityConventions } from "@smp/factory-shared/conventions-schema"
import { resolveComponentQuality } from "@smp/factory-shared/conventions-schema"

import type {
  CheckReport,
  CheckResult,
  ComponentReport,
} from "../../lib/quality/types.js"

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusLabel(r: CheckResult): string {
  if (r.skipped) return "\x1b[2mSKIP\x1b[0m"
  return r.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"
}

/**
 * Print a human-readable summary table to stdout.
 */
export function printSummary(report: CheckReport, verbose: boolean): void {
  let totalChecks = 0
  let passedChecks = 0
  let failedBlocking = 0
  let failedAdvisory = 0

  for (const comp of report.components) {
    const compQuality = resolveComponentQuality(
      report.quality,
      comp.component.name
    )
    console.log(
      `\n  \x1b[1m${comp.component.name}\x1b[0m \x1b[2m(${comp.component.runtime})\x1b[0m`
    )

    for (const r of comp.results) {
      if (r.skipped) continue
      totalChecks++
      const status = statusLabel(r)
      const duration = formatDuration(r.duration)
      const coverageInfo = r.coverage
        ? `  (coverage: ${r.coverage.line}% line, ${r.coverage.branch}% branch)`
        : ""
      console.log(
        `    ${r.kind.padEnd(10)} ${r.tool.padEnd(10)} ${status}   ${duration}${coverageInfo}`
      )

      if (r.passed) {
        passedChecks++
      } else {
        const checkConfig = compQuality[r.kind]
        if (checkConfig.block_pr) {
          failedBlocking++
        } else {
          failedAdvisory++
        }
      }

      if (!r.passed || verbose) {
        // Show first few lines of output for failures
        const lines = r.output.trim().split("\n").slice(0, 10)
        for (const line of lines) {
          console.log(`      ${line}`)
        }
        if (r.output.trim().split("\n").length > 10) {
          console.log(`      ... (truncated, use --verbose for full output)`)
        }
      }
    }
  }

  const total = passedChecks + failedBlocking + failedAdvisory
  console.log(
    `\n  Summary: ${passedChecks}/${total} passed` +
      (failedBlocking > 0
        ? `, \x1b[31m${failedBlocking} blocking failure(s)\x1b[0m`
        : "") +
      (failedAdvisory > 0 ? `, ${failedAdvisory} advisory failure(s)` : "")
  )

  if (failedBlocking + failedAdvisory > 0) {
    console.log("  Run \x1b[1mdx check --fix\x1b[0m to auto-fix where possible")
  }
}

/**
 * Build a structured JSON report.
 */
export function buildJsonReport(report: CheckReport): object {
  return {
    success: report.components.every((c) =>
      c.results.every((r) => r.passed || r.skipped)
    ),
    components: report.components.map((c) => ({
      name: c.component.name,
      runtime: c.component.runtime,
      dir: c.component.dir,
      checks: c.results
        .filter((r) => !r.skipped)
        .map((r) => ({
          kind: r.kind,
          tool: r.tool,
          passed: r.passed,
          duration: Math.round(r.duration),
          ...(r.coverage ? { coverage: r.coverage } : {}),
          ...(r.passed ? {} : { output: r.output.trim() }),
        })),
    })),
  }
}

/**
 * Determine exit code based on conventions enforcement.
 * In CI mode, only blocking checks cause non-zero exit.
 */
export function computeExitCode(report: CheckReport, ciMode: boolean): number {
  for (const comp of report.components) {
    const compQuality = resolveComponentQuality(
      report.quality,
      comp.component.name
    )
    for (const r of comp.results) {
      if (r.skipped || r.passed) continue
      const checkConfig = compQuality[r.kind]
      if (ciMode) {
        if (checkConfig.block_pr) return 1
      } else {
        return 1
      }
    }
  }
  return 0
}
