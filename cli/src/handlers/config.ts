import { ExitCodes } from "@smp/factory-shared/exit-codes"

import {
  styleBold,
  styleError,
  styleInfo,
  styleMuted,
  styleSuccess,
} from "../cli-style.js"
import {
  configPath,
  DX_CONFIG_FIELDS,
  dxConfigStore,
  readConfig,
} from "../config.js"
import type { DxFlags } from "../stub.js"

/** All valid config keys. */
const VALID_KEYS = Object.keys(
  DX_CONFIG_FIELDS
) as (keyof typeof DX_CONFIG_FIELDS)[]

/** `dx config show` — display the merged config. */
export async function runConfigShow(flags: DxFlags): Promise<void> {
  const config = await readConfig()

  if (flags.json) {
    console.log(
      JSON.stringify(
        { success: true, data: config, exitCode: ExitCodes.SUCCESS },
        null,
        2
      )
    )
    return
  }

  console.log(styleBold("DX Configuration (merged)"))
  console.log(styleMuted(`global: ${configPath()}`))
  console.log()

  for (const [key, value] of Object.entries(config)) {
    const display =
      typeof value === "string" && value.length === 0
        ? styleMuted("(not set)")
        : String(value)
    console.log(`  ${styleInfo(key)}: ${display}`)
  }
}

/** `dx config get <key>` — print a single config value. */
export async function runConfigGet(flags: DxFlags, key: string): Promise<void> {
  if (!VALID_KEYS.includes(key as keyof typeof DX_CONFIG_FIELDS)) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "INVALID_KEY",
              message: `Unknown config key: ${key}`,
              suggestions: [
                {
                  action: "run",
                  description: `Valid keys: ${VALID_KEYS.join(", ")}`,
                },
              ],
            },
            exitCode: ExitCodes.GENERAL_FAILURE,
          },
          null,
          2
        )
      )
    } else {
      console.error(styleError(`Unknown config key: ${key}`))
      console.error(styleMuted(`Valid keys: ${VALID_KEYS.join(", ")}`))
    }
    process.exit(ExitCodes.GENERAL_FAILURE)
  }

  const config = await readConfig()
  const value = (config as Record<string, string>)[key]

  if (flags.json) {
    console.log(
      JSON.stringify(
        { success: true, data: { key, value }, exitCode: ExitCodes.SUCCESS },
        null,
        2
      )
    )
    return
  }

  console.log(value)
}

/** `dx config set <key> <value>` — write a value to the global config. */
export async function runConfigSet(
  flags: DxFlags,
  key: string,
  value: string
): Promise<void> {
  if (!VALID_KEYS.includes(key as keyof typeof DX_CONFIG_FIELDS)) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "INVALID_KEY",
              message: `Unknown config key: ${key}`,
              suggestions: [
                {
                  action: "run",
                  description: `Valid keys: ${VALID_KEYS.join(", ")}`,
                },
              ],
            },
            exitCode: ExitCodes.GENERAL_FAILURE,
          },
          null,
          2
        )
      )
    } else {
      console.error(styleError(`Unknown config key: ${key}`))
      console.error(styleMuted(`Valid keys: ${VALID_KEYS.join(", ")}`))
    }
    process.exit(ExitCodes.GENERAL_FAILURE)
  }

  await dxConfigStore.update((prev) => ({
    ...prev,
    [key]: value,
  }))

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: { key, value },
          exitCode: ExitCodes.SUCCESS,
        },
        null,
        2
      )
    )
    return
  }

  console.log(styleSuccess(`${key} = ${value}`))
}

/** `dx config path` — print the config file path. */
export async function runConfigPath(flags: DxFlags): Promise<void> {
  const p = configPath()

  if (flags.json) {
    console.log(
      JSON.stringify(
        { success: true, data: { path: p }, exitCode: ExitCodes.SUCCESS },
        null,
        2
      )
    )
    return
  }

  console.log(p)
}

/** `dx config reset <key>` — reset a key to its default value. */
export async function runConfigReset(
  flags: DxFlags,
  key: string
): Promise<void> {
  if (!VALID_KEYS.includes(key as keyof typeof DX_CONFIG_FIELDS)) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "INVALID_KEY",
              message: `Unknown config key: ${key}`,
            },
            exitCode: ExitCodes.GENERAL_FAILURE,
          },
          null,
          2
        )
      )
    } else {
      console.error(styleError(`Unknown config key: ${key}`))
      console.error(styleMuted(`Valid keys: ${VALID_KEYS.join(", ")}`))
    }
    process.exit(ExitCodes.GENERAL_FAILURE)
  }

  const defaultValue =
    DX_CONFIG_FIELDS[key as keyof typeof DX_CONFIG_FIELDS].default

  await dxConfigStore.update((prev) => ({
    ...prev,
    [key]: defaultValue,
  }))

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: { key, value: defaultValue },
          exitCode: ExitCodes.SUCCESS,
        },
        null,
        2
      )
    )
    return
  }

  console.log(
    styleSuccess(`${key} reset to default: ${defaultValue || "(empty)"}`)
  )
}
