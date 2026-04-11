import ora, { type Ora } from "ora"
import {
  styleSuccess,
  styleError,
  styleWarn,
  styleMuted,
} from "../cli-style.js"
import type { ToolchainCheck } from "@smp/factory-shared/install-types"

/** Print the dx setup welcome banner. */
export function banner(version: string): void {
  console.log(`\n  dx platform setup v${version}\n`)
}

/** Format a single preflight check result for one-line output. */
export function preflightMark(
  label: string,
  passed: boolean,
  required: boolean
): string {
  if (passed) return styleSuccess(`✔ ${label}`)
  if (required) return styleError(`✖ ${label}`)
  return styleWarn(`⚠ ${label}`)
}

/** Print preflight results as a single compact line. */
export function printPreflightLine(
  checks: Array<{
    name: string
    passed: boolean
    message: string
    required: boolean
  }>
): void {
  const marks = checks.map((c) =>
    preflightMark(c.message, c.passed, c.required)
  )
  console.log(`  ${marks.join("  ")}`)
}

/** Create a phase spinner: [n/total] label... */
export function phase(n: number, total: number, label: string): Ora {
  return ora({
    text: `[${n}/${total}] ${label}`,
    prefixText: " ",
    spinner: "dots",
  }).start()
}

/** Mark a phase spinner as succeeded with elapsed time. */
export function phaseSucceed(
  spinner: Ora,
  n: number,
  total: number,
  label: string,
  startMs: number
): void {
  const elapsed = formatElapsed(Date.now() - startMs)
  spinner.succeed(`[${n}/${total}] ${label} ${styleMuted(elapsed)}`)
}

/** Mark a phase spinner as failed. */
export function phaseFail(
  spinner: Ora,
  n: number,
  total: number,
  label: string,
  error: string
): void {
  spinner.fail(`[${n}/${total}] ${label} — ${error}`)
}

/** Phase was already completed in a previous run; no spinner. */
export function phaseSkipped(n: number, total: number, label: string): void {
  console.log(
    `  ${styleSuccess("✔")} [${n}/${total}] ${label} ${styleMuted("(skipped — resume)")}`
  )
}

/** Format milliseconds as human-readable elapsed time. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remainder = s % 60
  return `${m}m ${Math.round(remainder)}s`
}

/** Print the final success line. */
export function successLine(message: string, totalMs: number): void {
  console.log(
    `\n  ${styleSuccess("✔")} ${message} ${styleMuted(`(${formatElapsed(totalMs)})`)}`
  )
}

/** Print indented info lines. */
export function infoLine(text: string): void {
  console.log(`    ${text}`)
}

/** Print toolchain check results, one line per tool. */
export function printToolchainResults(checks: ToolchainCheck[]): void {
  for (const c of checks) {
    const versionSuffix = c.minVersion
      ? ` ${styleMuted(`(>= ${c.minVersion})`)}`
      : ""
    if (c.passed) {
      console.log(`  ${styleSuccess("✔")} ${c.message}${versionSuffix}`)
    } else if (c.required) {
      console.log(`  ${styleError("✖")} ${c.message}`)
    } else {
      console.log(`  ${styleWarn("⚠")} ${c.message}`)
    }
  }
}
