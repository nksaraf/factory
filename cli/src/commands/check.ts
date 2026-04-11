import type { DxBase } from "../dx-root.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { runCheckHandler } from "../handlers/check/index.js"
import type { CheckKind } from "../lib/quality/types.js"

setExamples("check", [
  "$ dx check                Run all quality checks",
  "$ dx check lint           Run linting only",
  "$ dx check typecheck      Run type checking only",
  "$ dx check test           Run tests only",
  "$ dx check format         Check formatting only",
  "$ dx check --fix          Auto-fix lint and format issues",
  "$ dx check --ci           CI mode (exit code from conventions)",
  "$ dx check -c api lint    Lint a specific component",
])

function makeCheckRunner(kind?: CheckKind) {
  return ({ flags }: { flags: Record<string, unknown> }) => {
    const f = toDxFlags(flags)
    return runCheckHandler({
      flags: f,
      kind,
      component: f.component as string | undefined,
      ci: f.ci as boolean | undefined,
      staged: f.staged as boolean | undefined,
      fix: f.fix as boolean | undefined,
      report: f.report as "summary" | "json" | undefined,
    })
  }
}

const checkFlags = {
  component: {
    type: "string" as const,
    short: "c",
    description: "Target specific component",
  },
  staged: {
    type: "boolean" as const,
    description: "Only check staged files (pre-commit mode)",
  },
  ci: {
    type: "boolean" as const,
    description: "CI mode: exit code based on block_pr conventions",
  },
  fix: {
    type: "boolean" as const,
    description: "Auto-fix where possible",
  },
  report: {
    type: "string" as const,
    description: "Output format: summary (default), json",
  },
}

export function checkCommand(app: DxBase) {
  return app
    .sub("check")
    .meta({ description: "Run quality checks (lint, typecheck, test, format)" })
    .flags(checkFlags)
    .run(makeCheckRunner())
    .command("lint", (c) =>
      c
        .meta({ description: "Run linting" })
        .flags(checkFlags)
        .run(makeCheckRunner("lint"))
    )
    .command("typecheck", (c) =>
      c
        .meta({ description: "Run type checking" })
        .flags(checkFlags)
        .run(makeCheckRunner("typecheck"))
    )
    .command("test", (c) =>
      c
        .meta({ description: "Run tests" })
        .flags(checkFlags)
        .run(makeCheckRunner("test"))
    )
    .command("format", (c) =>
      c
        .meta({ description: "Check formatting" })
        .flags(checkFlags)
        .run(makeCheckRunner("format"))
    )
}
