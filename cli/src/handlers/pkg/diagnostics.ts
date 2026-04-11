/**
 * Diagnostic framework for dx pkg doctor.
 *
 * Each check function returns DiagnosticIssue[]. Results are collected into
 * a DiagnosticReport and printed as a table (human) or JSON.
 */

import { printTable } from "../../output.js"
import {
  styleError,
  styleSuccess,
  styleWarn,
  styleMuted,
} from "../../cli-style.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info"

export interface DiagnosticIssue {
  check: string
  severity: Severity
  package?: string
  message: string
  /** Optional auto-fix function (called when --fix is passed). */
  fix?: () => void | Promise<void>
}

export interface DiagnosticReport {
  issues: DiagnosticIssue[]
  checksRun: string[]
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function severityIcon(s: Severity): string {
  if (s === "error") return styleError("✗")
  if (s === "warning") return styleWarn("!")
  return styleMuted("i")
}

function severityStyle(s: Severity): (t: string) => string {
  if (s === "error") return styleError
  if (s === "warning") return styleWarn
  return styleMuted
}

export function formatReport(report: DiagnosticReport, json?: boolean): string {
  if (json) {
    return JSON.stringify(
      {
        success:
          report.issues.filter((i) => i.severity === "error").length === 0,
        checksRun: report.checksRun,
        issues: report.issues.map((i) => ({
          check: i.check,
          severity: i.severity,
          package: i.package,
          message: i.message,
          fixable: !!i.fix,
        })),
        summary: {
          errors: report.issues.filter((i) => i.severity === "error").length,
          warnings: report.issues.filter((i) => i.severity === "warning")
            .length,
          info: report.issues.filter((i) => i.severity === "info").length,
        },
      },
      null,
      2
    )
  }

  if (report.issues.length === 0) {
    return styleSuccess("All checks passed ✓")
  }

  const rows = report.issues.map((i) => [
    severityIcon(i.severity),
    i.check,
    i.package ?? "",
    i.message,
  ])

  const table = printTable(["", "Check", "Package", "Message"], rows, [
    {},
    {},
    {},
    { style: (s) => s },
  ])

  const errors = report.issues.filter((i) => i.severity === "error").length
  const warnings = report.issues.filter((i) => i.severity === "warning").length

  const parts: string[] = []
  if (errors > 0) parts.push(styleError(`${errors} error(s)`))
  if (warnings > 0) parts.push(styleWarn(`${warnings} warning(s)`))

  const summary = parts.length > 0 ? `\n${parts.join(", ")}` : ""
  const fixable = report.issues.filter((i) => i.fix).length
  const fixHint =
    fixable > 0
      ? styleMuted(`\n${fixable} issue(s) auto-fixable with --fix`)
      : ""

  return `${table}${summary}${fixHint}`
}
