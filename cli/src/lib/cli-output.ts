/**
 * Stdout/stderr contract when `dx` is run with `--json` / `-j`.
 *
 * **With `--json`:** stdout is **only** the command’s JSON result (so `| jq` and scripts stay valid).
 * Anything else (progress, tables, hints, errors that aren’t the JSON payload) goes to **stderr**,
 * or use `log.*` which already writes to stderr.
 *
 * **Without `--json`:** normal CLI behavior — tables and prose on stdout as today.
 *
 * Same rules whether you’re in a terminal or an agent: the flag picks JSON vs default output shape.
 *
 * Subprocesses can rely on `process.env.DX_MACHINE_JSON_STDOUT === "1"` (set from argv in `cli.ts`).
 * `dx --version --json` follows the same stdout = JSON rule.
 */

export const DX_MACHINE_JSON_STDOUT_ENV = "DX_MACHINE_JSON_STDOUT" as const

/** Call once at process startup (see `cli.ts`) so late-loaded code and children see JSON mode. */
export function syncMachineJsonStdoutEnvFromArgv(): void {
  if (process.argv.includes("--json") || process.argv.includes("-j")) {
    process.env[DX_MACHINE_JSON_STDOUT_ENV] = "1"
  }
}

export function isMachineJsonStdout(): boolean {
  return (
    process.env[DX_MACHINE_JSON_STDOUT_ENV] === "1" ||
    process.argv.includes("--json") ||
    process.argv.includes("-j")
  )
}

/** True when Crust set `flags.json` or the process is in machine-JSON mode (argv/env). */
export function wantsCliJson(flags: { json?: boolean }): boolean {
  return isMachineJsonStdout() || Boolean(flags.json)
}

/**
 * One line of default (non-JSON) CLI output. With `--json`, uses stderr so stdout stays
 * reserved for `writeStdoutJsonDocument`. Without `--json`, uses stdout like `console.log`.
 * Prefer this over raw `console.log` when the line is not part of the JSON result.
 */
export function cliLine(message: string): void {
  if (isMachineJsonStdout()) {
    console.error(message)
  } else {
    console.log(message)
  }
}

/**
 * Format a single JSON value for the CLI. Compact when stdout is piped; indented on a TTY.
 */
export function formatCliJsonDocument(value: unknown): string {
  const indent = process.stdout.isTTY ? 2 : undefined
  return JSON.stringify(value, null, indent as number | undefined)
}

/** Emit the command's JSON result document to stdout (only callable for the real result payload). */
export function writeStdoutJsonDocument(value: unknown): void {
  console.log(formatCliJsonDocument(value))
}
