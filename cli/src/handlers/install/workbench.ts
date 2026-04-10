/**
 * dx setup (workbench role) — full developer workbench setup.
 *
 * Phases:
 *   1. Identity — generate workbenchId, detect type
 *   2. Defaults — scan & apply machine-level configs (git, npm, ssh, etc.)
 *   3. Toolchain — parallel checks for required dev tools + corepack + docker
 *   4. Factory auth — check / prompt for dx factory login
 *   5. Pkg auth — check / prompt for registry credentials
 *   6. Save — persist .dx/workbench.json + global config
 *   7. Register — POST to factory if authenticated
 */
import { input, select } from "@crustjs/prompts"
import type { WorkbenchType } from "@smp/factory-shared/install-types"
import ora from "ora"

import { styleMuted, styleSuccess } from "../../cli-style.js"
import { getFactoryApiToken } from "../../client.js"
import { dxConfigStore } from "../../config.js"
import { printToolchainResults } from "../../lib/cli-ui.js"
import { run } from "../../lib/subprocess.js"
import { getAuthServiceToken } from "../../session-token.js"
import { registryAuthStore } from "../pkg/registry-auth-store.js"
import {
  displayApplyResult,
  displayCheckSummary,
  displayScan,
} from "./defaults/display.js"
import { applyDefaults, collectDefaults } from "./defaults/index.js"
import {
  ensureTool,
  getMissingToolInstallCommands,
  installTool,
  refreshPath,
  runToolchainChecks,
} from "./toolchain.js"
import {
  createWorkbenchConfig,
  readWorkbenchConfig,
  resolveWorkbenchRoot,
  writeWorkbenchConfig,
} from "./workbench-identity.js"

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev"

export interface WorkbenchSetupOpts {
  factoryUrl?: string
  dir?: string
  type?: string
  yes?: boolean
  verbose?: boolean
  registryKey?: string
  registryKeyFile?: string
  check?: boolean
  skipDefaults?: boolean
}

export interface WorkbenchResult {
  workbenchId: string
  type: WorkbenchType
  root: string
  factoryUrl?: string
  user?: string
  context?: string
  toolchainPassed: boolean
  dockerAvailable: boolean
  registered: boolean
  defaultsApplied: number
  defaultsPending: number
}

export async function runWorkbenchSetup(
  opts: WorkbenchSetupOpts
): Promise<WorkbenchResult> {
  const root = resolveWorkbenchRoot(opts.dir)
  const existing = readWorkbenchConfig(root)

  // --- Phase 1: Identity ---
  const config = existing
    ? {
        ...existing,
        lastInstallAt: new Date().toISOString(),
        dxVersion: DX_VERSION,
      }
    : createWorkbenchConfig({
        root,
        type: opts.type,
        dxVersion: DX_VERSION,
        factoryUrl: opts.factoryUrl,
      })

  // Override type if explicitly set
  if (opts.type) {
    const { detectWorkbenchType } = await import("./workbench-identity.js")
    config.type = detectWorkbenchType(opts.type)
  }

  if (opts.factoryUrl) {
    config.factoryUrl = opts.factoryUrl
  }

  console.log(
    `  ${styleMuted(`Workbench ${config.workbenchId} (${config.type})`)}`
  )
  console.log()

  // --- Pre-defaults: ensure git + curl are available ---
  // These are needed by the defaults phase (git config, curlrc).
  // Install them silently before scanning defaults.
  if (!opts.check) {
    for (const prereq of ["git", "curl"] as const) {
      try {
        await ensureTool(prereq)
      } catch {
        // Not fatal — defaults will gracefully skip what they can't apply
      }
    }
  }

  // --- Phase 2: Configure Defaults ---
  let defaultsApplied = 0
  let defaultsPending = 0

  if (!opts.skipDefaults) {
    const scan = await collectDefaults("workbench")
    defaultsPending = scan.pending.length

    if (opts.check) {
      displayCheckSummary(scan)
      console.log()
    } else {
      displayScan(scan)
      if (scan.pending.length > 0) {
        const result = await applyDefaults(scan.pending)
        displayApplyResult(result)
        defaultsApplied = result.applied.length
      }
      console.log()
    }
  }

  // In --check mode, stop after showing defaults status
  if (opts.check) {
    return {
      workbenchId: config.workbenchId,
      type: config.type,
      root,
      factoryUrl: config.factoryUrl,
      toolchainPassed: false,
      dockerAvailable: false,
      registered: false,
      defaultsApplied,
      defaultsPending,
    }
  }

  // --- Phase 3: Toolchain ---
  const toolSpinner = ora({
    text: "Checking toolchain...",
    prefixText: " ",
  }).start()
  let toolchain = await runToolchainChecks()
  toolSpinner.stop()

  printToolchainResults(toolchain.checks)
  console.log()

  // Record discovered versions
  for (const check of toolchain.checks) {
    if (check.version) {
      config.toolchainVersions[check.name] = check.version
    }
  }

  if (!toolchain.passed) {
    const missingInstalls = getMissingToolInstallCommands(toolchain.checks)

    if (!opts.yes && missingInstalls.length > 0) {
      console.log(`  ${styleMuted("Missing tools can be auto-installed:")}`)
      for (const m of missingInstalls) {
        console.log(`    ${m.name}: ${styleMuted(m.command)}`)
      }
      console.log()

      const action = await select({
        message: "How would you like to proceed?",
        choices: [
          { value: "install", label: "Install missing tools now" },
          { value: "continue", label: "Continue without installing" },
          { value: "abort", label: "Abort" },
        ],
        default: "install",
      })

      if (action === "abort") {
        throw new Error(
          "Workbench setup aborted — install missing tools and retry."
        )
      }

      if (action === "install") {
        for (const m of missingInstalls) {
          const installSpinner = ora({
            text: `Installing ${m.name}...`,
            prefixText: " ",
          }).start()
          const ok = await installTool(m.name)
          if (ok) {
            installSpinner.succeed(`Installed ${m.name}`)
          } else {
            installSpinner.fail(
              `Failed to install ${m.name} — run manually: ${m.command}`
            )
          }
        }
        // Re-check toolchain after installs
        console.log()
        await refreshPath()
        const recheck = ora({
          text: "Re-checking toolchain...",
          prefixText: " ",
        }).start()
        const recheckResult = await runToolchainChecks()
        recheck.stop()
        printToolchainResults(recheckResult.checks)
        console.log()
        // Update versions from recheck
        for (const check of recheckResult.checks) {
          if (check.version) {
            config.toolchainVersions[check.name] = check.version
          }
        }
        toolchain = recheckResult
      }
    } else if (opts.yes) {
      // In --yes mode, auto-install what we can
      if (missingInstalls.length > 0) {
        for (const m of missingInstalls) {
          const installSpinner = ora({
            text: `Installing ${m.name}...`,
            prefixText: " ",
          }).start()
          const ok = await installTool(m.name)
          if (ok) {
            installSpinner.succeed(`Installed ${m.name}`)
          } else {
            installSpinner.warn(
              `${m.name} — install manually: ${styleMuted(m.command)}`
            )
          }
        }
        // Re-check toolchain after installs
        console.log()
        await refreshPath()
        const recheck = ora({
          text: "Re-checking toolchain...",
          prefixText: " ",
        }).start()
        const recheckResult = await runToolchainChecks()
        recheck.stop()
        printToolchainResults(recheckResult.checks)
        console.log()
        for (const check of recheckResult.checks) {
          if (check.version) {
            config.toolchainVersions[check.name] = check.version
          }
        }
        toolchain = recheckResult
      }
    }
  }

  // Corepack enable (part of toolchain phase)
  if (config.toolchainVersions.corepack) {
    const corepackResult = run("corepack", ["enable"])
    if (corepackResult.status === 0) {
      console.log(`  ${styleSuccess("✔")} corepack enabled`)
    }
  }

  // Docker check (part of toolchain phase)
  let dockerAvailable = false
  const dockerResult = run("docker", ["info", "--format", "{{.ServerVersion}}"])
  if (dockerResult.status === 0) {
    const dockerVersion = dockerResult.stdout.trim()
    const composeResult = run("docker", ["compose", "version", "--short"])
    const composeVersion =
      composeResult.status === 0 ? composeResult.stdout.trim() : "not found"
    console.log(
      `  ${styleSuccess("✔")} Docker ${dockerVersion}  Compose ${composeVersion}`
    )
    dockerAvailable = true
  } else {
    console.log(
      `  ${styleMuted("Docker not running — optional, needed for dx dev")}`
    )
  }

  // --- Phase 4: Factory connection + auth ---
  if (!config.factoryUrl && !opts.yes) {
    const factoryMode = await select({
      message: "How would you like to use dx?",
      choices: [
        {
          value: "local",
          label: "Local factory (default) — runs a local API on this machine",
        },
        {
          value: "cloud",
          label: "Cloud factory — connect to factory.lepton.software",
        },
        {
          value: "custom",
          label: "Other factory — enter a custom factory URL",
        },
      ],
      default: "local",
    })

    if (factoryMode === "local") {
      config.factoryUrl = "http://localhost:4100"
      config.installMode = "local"
      const dockerCheck = run("docker", [
        "info",
        "--format",
        "{{.ServerVersion}}",
      ])
      if (dockerCheck.status !== 0) {
        console.log(
          `  ${styleMuted("Docker is required for local clusters. Install and start Docker, then run: dx cluster create --local")}`
        )
      } else {
        console.log(
          `  ${styleSuccess("✔")} Docker available — run ${styleMuted("dx cluster create --local")} to create a local k3d cluster`
        )
      }
    } else if (factoryMode === "cloud") {
      config.factoryUrl = "https://factory.lepton.software"
    } else {
      const url = await input({
        message: "Factory URL:",
        validate: (v) => {
          try {
            new URL(v)
            return true
          } catch {
            return "Enter a valid URL"
          }
        },
      })
      config.factoryUrl = url.replace(/\/$/, "")
    }
  } else if (!config.factoryUrl && opts.yes) {
    config.factoryUrl = "http://localhost:4100"
    config.installMode = "local"
  }

  let authenticated = false
  const isLocalMode = config.factoryUrl === "http://localhost:4100"

  if (isLocalMode) {
    console.log(
      `  ${styleSuccess("✔")} Factory: local mode — no authentication required`
    )
    authenticated = true
  } else {
    const factoryHost = new URL(config.factoryUrl!).hostname
    const authSpinner = ora({
      text: `Connecting to ${factoryHost}...`,
      prefixText: " ",
    }).start()
    try {
      const token = await getAuthServiceToken()
      if (token) {
        // Validate the token is actually alive by hitting the Factory health endpoint
        let userEmail: string | undefined
        try {
          const { createFactoryAuthClient } =
            await import("../../auth-factory.js")
          const client = await createFactoryAuthClient({})
          const { data } = await client.getSession()
          userEmail = data?.user?.email
        } catch {
          // Session validation failed — token may be stale
        }
        if (userEmail) {
          authSpinner.succeed(`Factory: ${factoryHost} — ${userEmail}`)
          authenticated = true
        } else {
          authSpinner.warn(`Factory: ${factoryHost} — session expired`)
        }
      } else {
        authSpinner.warn("Not authenticated")
        if (!opts.yes) {
          const doAuth = await select({
            message: "Set up factory authentication?",
            choices: [
              { value: true, label: "Yes, run dx factory login" },
              { value: false, label: "Skip (can run dx factory login later)" },
            ],
            default: true,
          })
          if (doAuth) {
            try {
              const { runAuthLogin } = await import("../auth-login.js")
              await runAuthLogin(
                { json: false, verbose: opts.verbose, debug: false },
                {}
              )
              const postToken = await getAuthServiceToken()
              authenticated = !!postToken
            } catch {
              console.log(
                `  ${styleMuted("Auth setup failed — run dx factory login later")}`
              )
            }
          }
        }
      }
    } catch {
      authSpinner.warn("Auth check failed — run dx factory login later")
    }
  }

  // --- Phase 5: Pkg auth ---
  const pkgSpinner = ora({
    text: "Checking registry credentials...",
    prefixText: " ",
  }).start()
  try {
    const { localSecretGet } = await import("../secret-local-store.js")
    const stored = await registryAuthStore.read()
    const localCred = localSecretGet("GOOGLE_APPLICATION_CREDENTIALS_BASE64")
    const hasKey =
      !!localCred ||
      stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64.length > 0 ||
      stored.GCP_NPM_SA_JSON_BASE64.length > 0

    if (hasKey) {
      pkgSpinner.succeed("Registry credentials configured")
      try {
        await runPkgAuthInline(stored, root)
      } catch {
        // Non-fatal — credentials are stored, auth refresh failed
      }
    } else {
      // Try auto-fetching from Factory API (org-level secret)
      // Skip in local mode — local Factory typically won't have org secrets,
      // and hitting a non-running localhost hangs for 10s.
      if (authenticated && !isLocalMode) {
        pkgSpinner.text = "Fetching registry credentials from Factory..."
        const { tryFetchRegistryCredentialsFromFactory } =
          await import("../pkg/registry-auto-fetch.js")
        const autoResult = await tryFetchRegistryCredentialsFromFactory()
        if (autoResult.fetched) {
          pkgSpinner.succeed(
            `Registry credentials configured from Factory (${autoResult.email})`
          )
          try {
            // Re-read the store now that auto-fetch populated it
            const refreshed = await registryAuthStore.read()
            await runPkgAuthInline(refreshed, root)
          } catch {
            // Non-fatal — credentials are stored, auth refresh failed
          }
        }
        // If auto-fetch didn't work, fall through to manual paths below
        if (!autoResult.fetched) {
          await manualPkgAuth(pkgSpinner, root, opts)
        }
      } else {
        await manualPkgAuth(pkgSpinner, root, opts)
      }
    }
  } catch {
    pkgSpinner.warn("Registry credential check failed")
  }

  // --- Phase 6: Save ---
  writeWorkbenchConfig(root, config)

  if (config.factoryUrl) {
    await dxConfigStore.update((prev) => ({
      ...prev,
      factoryUrl: config.factoryUrl!,
      installMode: isLocalMode ? "local" : prev.installMode,
    }))
  }

  // --- Phase 7: Factory registration ---
  let registered = config.factoryRegistered
  if (authenticated && config.factoryUrl) {
    try {
      const token = await getFactoryApiToken()
      if (token) {
        const url = `${config.factoryUrl.replace(/\/$/, "")}/api/v1/factory/fleet/workbenches`
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workbenchId: config.workbenchId,
            type: config.type,
            hostname: config.hostname,
            ips: config.ips,
            os: config.os,
            arch: config.arch,
            dxVersion: DX_VERSION,
          }),
        })
        if (res.ok) {
          config.factoryRegistered = true
          config.registeredAt = new Date().toISOString()
          writeWorkbenchConfig(root, config)
          registered = true
        }
      }
    } catch {
      // Registration is best-effort
    }
  }

  return {
    workbenchId: config.workbenchId,
    type: config.type,
    root,
    factoryUrl: config.factoryUrl,
    user: authenticated ? "authenticated" : undefined,
    toolchainPassed: toolchain.passed,
    dockerAvailable,
    registered,
    defaultsApplied,
    defaultsPending,
  }
}

/**
 * Manual pkg auth fallback — env vars, flags, or interactive prompts.
 */
async function manualPkgAuth(
  pkgSpinner: ReturnType<typeof ora>,
  root: string,
  opts: WorkbenchSetupOpts
): Promise<void> {
  const registryKeyB64 =
    opts.registryKey ||
    process.env.DX_REGISTRY_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  const registryKeyFile =
    opts.registryKeyFile ||
    process.env.DX_REGISTRY_KEY_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS

  if (registryKeyB64 || registryKeyFile) {
    pkgSpinner.text = "Configuring registry credentials..."
    try {
      const { pkgAuth } = await import("../pkg/auth.js")
      if (registryKeyFile) {
        await pkgAuth(root, { keyFile: registryKeyFile })
      } else {
        await pkgAuth(root, { key: registryKeyB64 })
      }
      pkgSpinner.succeed("Registry credentials configured")
    } catch (err) {
      pkgSpinner.fail(
        `Registry auth failed: ${err instanceof Error ? err.message : err}`
      )
    }
  } else if (!opts.yes) {
    pkgSpinner.warn("No registry credentials")
    const doPkgAuth = await select({
      message: "Set up package registry authentication?",
      choices: [
        { value: true, label: "Yes, configure now" },
        { value: false, label: "Skip (can run dx pkg auth later)" },
      ],
      default: true,
    })
    if (doPkgAuth) {
      const keySource = await select({
        message: "How would you like to provide the GCP service account key?",
        choices: [
          { value: "file", label: "Path to JSON key file" },
          { value: "base64", label: "Base64-encoded key" },
        ],
      })
      try {
        const { pkgAuth } = await import("../pkg/auth.js")
        if (keySource === "file") {
          const { existsSync } = await import("node:fs")
          const keyFilePath = await input({
            message: "Path to key file:",
            validate: (v) => {
              if (!v.trim()) return "Path is required"
              if (!existsSync(v.trim())) return `File not found: ${v}`
              return true
            },
          })
          await pkgAuth(root, { keyFile: keyFilePath.trim() })
        } else {
          const keyB64 = await input({
            message: "Base64-encoded key:",
            validate: (v) => (v.trim() ? true : "Key is required"),
          })
          await pkgAuth(root, { key: keyB64.trim() })
        }
      } catch (err) {
        console.log(
          `  ${styleMuted(`Registry auth failed: ${err instanceof Error ? err.message : err}`)}`
        )
        console.log(
          `  ${styleMuted("Run dx pkg auth --key-file <path> later to retry")}`
        )
      }
    }
  } else {
    pkgSpinner.warn(
      "No registry credentials (pass --registry-key or --registry-key-file, or set DX_REGISTRY_KEY env var)"
    )
  }
}

/**
 * Run pkg auth inline using stored credentials.
 * For npm, we need a temp directory with an .npmrc pointing to the Artifact Registry
 * since there's no project context during workbench install.
 */
async function runPkgAuthInline(
  stored: Awaited<ReturnType<typeof registryAuthStore.read>>,
  _root: string
): Promise<void> {
  const {
    decodeSaBase64,
    configureMavenAuth,
    configureNpmAuth,
    configureDockerAuth,
    gcloudAvailable,
    REGISTRIES,
  } = await import("../pkg/registry.js")

  const b64 =
    stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    stored.GCP_NPM_SA_JSON_BASE64 ||
    stored.GCP_MAVEN_SA_JSON_BASE64

  if (!b64) return

  const saJson = decodeSaBase64(b64)
  if (!saJson) return

  // Maven auth
  configureMavenAuth(saJson)

  // npm auth — needs a temp dir with .npmrc pointing to the registry
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { tmpdir } = await import("node:os")
  const tmpDir = mkdtempSync(join(tmpdir(), "dx-npm-auth-"))
  try {
    const npmrcContent = [
      `@lepton:registry=https://${REGISTRIES.npm.url}`,
      `@rio.js:registry=https://${REGISTRIES.npm.url}`,
      `registry=https://registry.npmjs.org`,
      `//${REGISTRIES.npm.url}:always-auth=true`,
    ].join("\n")
    writeFileSync(join(tmpDir, ".npmrc"), npmrcContent)
    configureNpmAuth(saJson, tmpDir)
  } finally {
    try {
      rmSync(tmpDir, { recursive: true })
    } catch {}
  }

  // Docker auth — requires gcloud
  if (gcloudAvailable()) {
    configureDockerAuth(saJson)
  }
}
