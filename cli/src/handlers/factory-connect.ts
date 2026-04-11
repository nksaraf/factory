import { ExitCodes } from "@smp/factory-shared/exit-codes"

import {
  styleError,
  styleInfo,
  styleMuted,
  styleSuccess,
} from "../cli-style.js"
import {
  LOCAL_FACTORY_URL,
  dxConfigStore,
  readConfig,
  resolveFactoryMode,
  resolveFactoryUrl,
} from "../config.js"
import { exitWithError } from "../lib/cli-exit.js"
import type { DxFlags } from "../stub.js"

type HealthBody = { status?: string; service?: string }

export async function runFactoryConnect(
  flags: DxFlags,
  args: { url?: string }
): Promise<void> {
  let targetUrl = args.url?.replace(/\/$/, "")

  if (!targetUrl) {
    // Show current connection
    const config = await readConfig()
    const modeInfo = resolveFactoryMode(config)

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              factoryUrl: modeInfo.url,
              factoryMode: modeInfo.mode,
              envOverride: modeInfo.envOverride,
              role: config.role,
            },
          },
          null,
          2
        )
      )
      return
    }
    console.log(`Connected to: ${styleInfo(modeInfo.url)}`)
    console.log(
      `Mode:         ${modeInfo.mode === "local" ? styleSuccess(modeInfo.label) : modeInfo.label}`
    )
    console.log(`Role:         ${config.role}`)
    return
  }

  // Handle "local" sentinel — switch to embedded mode and ensure daemon is running
  if (targetUrl === "local") {
    await dxConfigStore.update((prev) => ({ ...prev, factoryUrl: "local" }))

    // Start the local daemon (k3d cluster + PGlite + API)
    if (!flags.json) {
      console.log(styleMuted("Starting local factory daemon..."))
    }

    try {
      const { ensureLocalDaemon } = await import("../local-daemon/lifecycle.js")
      await ensureLocalDaemon()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      exitWithError(
        flags,
        `Failed to start local daemon: ${detail}`,
        ExitCodes.CONNECTION_FAILURE
      )
    }

    // Verify health
    let apiData: HealthBody | undefined
    try {
      const res = await fetch(`${LOCAL_FACTORY_URL}/health`)
      apiData = res.ok
        ? ((await res.json()) as HealthBody | undefined)
        : undefined
    } catch {
      /* health check failed — daemon may still be starting */
    }

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              factoryUrl: LOCAL_FACTORY_URL,
              factoryMode: "local",
              api: apiData
                ? { status: apiData.status, service: apiData.service }
                : undefined,
            },
          },
          null,
          2
        )
      )
      return
    }

    console.log(styleSuccess("Connected to Local (embedded) factory"))
    console.log(styleMuted(`  API:      ${LOCAL_FACTORY_URL}`))
    console.log(styleMuted(`  Database: PGlite (embedded)`))
    console.log(styleMuted(`  Cluster:  k3d (auto-managed)`))
    if (apiData?.status) {
      console.log(
        styleMuted(
          `  Health:   ${apiData.status} (${apiData.service ?? "factory-api"})`
        )
      )
    }
    console.log()
    console.log(
      styleMuted(
        `  Tip: if workbench creation fails with "No cluster registered",`
      )
    )
    console.log(styleMuted(`  run: dx setup --role factory --mode local`))
    return
  }

  // Normalize URL
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = `https://${targetUrl}`
  }

  // Verify connectivity
  try {
    const res = await fetch(`${targetUrl}/health`)
    const data = res.ok
      ? ((await res.json()) as HealthBody | undefined)
      : undefined

    if (!data?.status) {
      const detail = !res.ok ? `HTTP ${res.status}` : "No health response"
      exitWithError(
        flags,
        `Cannot reach factory at ${targetUrl}: ${detail}`,
        ExitCodes.CONNECTION_FAILURE
      )
    }

    // Save to config
    await dxConfigStore.update((prev) => ({ ...prev, factoryUrl: targetUrl! }))

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              factoryUrl: targetUrl,
              api: { status: data.status, service: data.service },
            },
          },
          null,
          2
        )
      )
      return
    }

    console.log(styleSuccess(`Connected to ${targetUrl}`))
    console.log(`API: ${data.status} (${data.service ?? "factory-api"})`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    exitWithError(
      flags,
      `Cannot reach factory at ${targetUrl}: ${detail}`,
      ExitCodes.CONNECTION_FAILURE
    )
  }
}
