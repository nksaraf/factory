import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ExitCodes } from "@smp/factory-shared/exit-codes"

import { shutdownTelemetry, tracer } from "./telemetry.js"
import { createDxApp } from "./build-app.js"
import { fireWorkbenchPing } from "./handlers/install/workbench-ping.js"
import {
  isMachineJsonStdout,
  syncMachineJsonStdoutEnvFromArgv,
  writeStdoutJsonDocument,
} from "./lib/cli-output.js"
import { loadPackageScripts } from "./lib/dx-project-config.js"
import { DxError } from "./lib/dx-error.js"
import { styleMuted } from "./cli-style.js"

syncMachineJsonStdoutEnvFromArgv()

function readCliPackageVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const raw = readFileSync(join(dir, "../package.json"), "utf-8")
    const pkg = JSON.parse(raw) as { version?: string }
    return typeof pkg.version === "string" ? pkg.version : "0.0.0"
  } catch {
    return "0.0.0"
  }
}

// --version (long-only, -v stays for --verbose)
if (process.argv.includes("--version")) {
  const version = readCliPackageVersion()
  if (isMachineJsonStdout()) {
    writeStdoutJsonDocument({
      success: true,
      data: { name: "dx", version },
    })
  } else {
    console.log(`dx v${version}`)
  }
  process.exit(ExitCodes.SUCCESS)
}

// Rewrite `dx help [cmd...]` → `dx [cmd...] --help`
const args = process.argv.slice(2)
if (args[0] === "help") {
  const rest = args.slice(1)
  process.argv = [process.argv[0], process.argv[1], ...rest, "--help"]
}

const app = createDxApp()
const commandName = args.filter((a) => !a.startsWith("-")).join(" ") || "dx"
let exitCode: number = ExitCodes.SUCCESS

await tracer.startActiveSpan(`dx ${commandName}`, async (rootSpan) => {
  try {
    await app.execute()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Script pass-through: if no built-in command matched, try package.json scripts
    const scriptName = args.filter((a) => !a.startsWith("-"))[0]
    if (scriptName) {
      const scripts = loadPackageScripts(process.cwd())
      if (scripts[scriptName]) {
        const rest = args.slice(1).filter((a) => !a.startsWith("-"))
        const cmd = `${scripts[scriptName]}${rest.length ? " " + rest.join(" ") : ""}`
        const result = spawnSync("sh", ["-c", cmd], {
          stdio: "inherit",
          cwd: process.cwd(),
        })
        exitCode = result.status ?? 1
        rootSpan.end()
        await shutdownTelemetry()
        fireWorkbenchPing()
        process.exit(exitCode)
      }
    }

    const isVerbose =
      process.argv.includes("--verbose") ||
      process.argv.includes("-v") ||
      process.argv.includes("--debug")

    if (isMachineJsonStdout()) {
      const payload: Record<string, unknown> = {
        success: false,
        error: {
          message,
          ...(err instanceof DxError
            ? {
                code: err.context.code,
                operation: err.context.operation,
                metadata: err.context.metadata,
                suggestions: err.context.suggestions,
              }
            : {}),
          ...(isVerbose && err instanceof Error ? { stack: err.stack } : {}),
        },
        exitCode: ExitCodes.GENERAL_FAILURE,
      }
      writeStdoutJsonDocument(payload)
    } else {
      // Always show message
      console.error(message)

      // Show DxError context (operation, metadata, suggestions)
      if (err instanceof DxError) {
        const ctx = err.context
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
      }

      // Show stack + cause chain with --verbose
      if (isVerbose && err instanceof Error) {
        console.error(styleMuted(`\n${err.stack}`))
        let cause = err.cause as Error | undefined
        while (cause) {
          console.error(styleMuted(`\nCaused by: ${cause.message}`))
          if (cause.stack) console.error(styleMuted(cause.stack))
          cause = cause.cause as Error | undefined
        }
      }
    }
    exitCode = ExitCodes.GENERAL_FAILURE
    rootSpan.recordException(
      err instanceof Error ? err : new Error(String(err))
    )
  } finally {
    rootSpan.end()
  }
})

await shutdownTelemetry()

// Fire-and-forget workbench ping (non-blocking, no await)
fireWorkbenchPing()

process.exit(exitCode)
