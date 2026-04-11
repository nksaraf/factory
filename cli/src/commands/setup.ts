import { ExitCodes } from "@smp/factory-shared/exit-codes"
import type {
  InstallManifest,
  InstallRole,
} from "@smp/factory-shared/install-types"

import {
  configExists,
  configPath,
  dxConfigStore,
  readConfig,
} from "../config.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import {
  banner,
  infoLine,
  phase,
  phaseFail,
  phaseSkipped,
  phaseSucceed,
  printPreflightLine,
  successLine,
} from "../lib/cli-ui.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("setup", [
  "$ dx setup                                   Interactive machine setup",
  "$ dx setup --check                           Dry-run: show what would change",
  "$ dx setup --yes                             Non-interactive setup",
  "$ dx setup --skip-defaults                   Skip machine defaults configuration",
  "$ dx setup --role factory --mode local       Local factory (k3d + embedded daemon)",
  "$ dx setup --role factory --mode dev         Dev factory (k3d + Docker Compose)",
  "$ dx setup --role factory --mode prod        Production factory (k3s + Helm)",
  "$ dx setup --role site                       Set up as site node",
  "$ dx setup restore                           Restore config files from backups",
  "$ dx setup preflight                         Run preflight checks",
  "$ dx setup upgrade                           Upgrade platform",
])

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev"

/** Load kubeconfig from persisted config into the runtime setter. */
async function hydrateKubeconfig(): Promise<void> {
  const config = await readConfig()
  if (config.kubeconfig) {
    const { setKubeconfig } = await import("../handlers/install/k3s.js")
    setKubeconfig(config.kubeconfig)
  }
}

export function setupCommand(app: DxBase) {
  return (
    app
      .sub("setup")
      .meta({ description: "Set up, configure, and manage the dx platform" })
      .flags({
        bundle: {
          type: "string",
          short: "b",
          description: "Path to offline bundle directory",
        },
        role: {
          type: "string",
          description:
            "Installation role: workbench (default), site, or factory",
        },
        mode: {
          type: "string",
          short: "m",
          description:
            "Factory mode: local, dev, or prod (required with --role factory)",
        },
        force: {
          type: "boolean",
          description: "Force install over existing installation",
        },
        fresh: {
          type: "boolean",
          description:
            "Ignore saved install progress and start from phase 1 (still need --force if k3s exists)",
        },
        kubeconfig: {
          type: "string",
          short: "k",
          description:
            "Path to kubeconfig for a remote Kubernetes cluster (k3s or other; skips local k3s bootstrap and image loading)",
        },
        yes: {
          type: "boolean",
          short: "y",
          description: "Skip interactive prompts (workbench only)",
        },
        dir: {
          type: "string",
          description: "Workbench root directory (default: cwd)",
        },
        type: {
          type: "string",
          short: "t",
          description:
            "Workbench type: developer, ci, agent, sandbox, build, testbed",
        },
        "registry-key": {
          type: "string",
          description:
            "Base64-encoded GCP service account key for registry auth",
        },
        "registry-key-file": {
          type: "string",
          description: "Path to GCP service account key file for registry auth",
        },
        check: {
          type: "boolean",
          description:
            "Dry-run: show what would change without applying (exits 1 if pending, 0 if configured)",
        },
        "skip-defaults": {
          type: "boolean",
          description: "Skip the configure-defaults phase",
        },
      })
      .run(async ({ flags }) => {
        const f = toDxFlags(flags)
        const totalStart = Date.now()

        try {
          banner(DX_VERSION)

          let config = await readConfig()
          const hasExistingConfig = configExists()

          // Determine role: explicit flag > existing config > default to workbench
          const roleOverride = flags.role as InstallRole | undefined
          let role: InstallRole

          if (roleOverride) {
            role = roleOverride
            if (!hasExistingConfig || config.role !== roleOverride) {
              await dxConfigStore.update((prev) => ({
                ...prev,
                role: roleOverride,
              }))
              config = await readConfig()
            }
            if (role === "site" || role === "factory") {
              // Show existing config context for explicit site/factory role
              if (hasExistingConfig && config.role === role) {
                console.log(
                  `  Config found: ${config.role} (${config.context || config.siteName || new URL(config.factoryUrl).hostname})\n`
                )
              }
            }
          } else {
            // Default to workbench — require explicit --role for site/factory
            role = "workbench"
          }

          const remoteKubeconfig = flags.kubeconfig as string | undefined

          // Set kubeconfig for remote cluster mode
          if (remoteKubeconfig) {
            const { resolve } = await import("node:path")
            const { existsSync } = await import("node:fs")
            const absKubeconfig = resolve(remoteKubeconfig)
            if (!existsSync(absKubeconfig)) {
              exitWithError(
                f,
                `Kubeconfig not found: ${absKubeconfig}`,
                ExitCodes.PREFLIGHT_FAILURE
              )
            }
            const { setKubeconfig } = await import("../handlers/install/k3s.js")
            setKubeconfig(absKubeconfig)
            await dxConfigStore.update((prev) => ({
              ...prev,
              kubeconfig: absKubeconfig,
            }))
            infoLine(`Using remote cluster kubeconfig: ${absKubeconfig}`)
          }

          let resolvedFactoryMode = flags.mode as
            | "local"
            | "dev"
            | "prod"
            | undefined

          // Validate --mode flag
          if (
            role === "factory" &&
            resolvedFactoryMode &&
            !["local", "dev", "prod"].includes(resolvedFactoryMode)
          ) {
            exitWithError(
              f,
              `Invalid factory mode: ${resolvedFactoryMode}. Must be one of: local, dev, prod`
            )
          }

          // Interactive mode picker for factory role (before any work starts)
          if (role === "factory" && !resolvedFactoryMode) {
            if (flags.yes) {
              exitWithError(
                f,
                "Factory mode is required in non-interactive mode. Use --mode local, --mode dev, or --mode prod"
              )
            }
            const { select } = await import("@crustjs/prompts")
            resolvedFactoryMode = await select<"local" | "dev" | "prod">({
              message: "Factory mode",
              choices: [
                {
                  value: "local",
                  label: "Local — k3d + embedded daemon (runs from anywhere)",
                },
                {
                  value: "dev",
                  label: "Dev — k3d + Docker Compose (requires factory repo)",
                },
                {
                  value: "prod",
                  label: "Production — Kubernetes (k3s) + Helm (requires factory repo)",
                },
              ],
            })
          }

          // Workbench flow (also runs as first step for factory role)
          if (role === "workbench" || role === "factory") {
            const { runWorkbenchSetup } =
              await import("../handlers/install/workbench.js")
            const result = await runWorkbenchSetup({
              factoryUrl: config.factoryUrl,
              dir: flags.dir as string | undefined,
              type: flags.type as string | undefined,
              yes: flags.yes as boolean | undefined,
              verbose: f.verbose,
              registryKey: flags["registry-key"] as string | undefined,
              registryKeyFile: flags["registry-key-file"] as string | undefined,
              check: flags.check as boolean | undefined,
              skipDefaults: flags["skip-defaults"] as boolean | undefined,
            })

            if (flags.check) {
              // --check mode: just show status and exit
              if (f.json) {
                console.log(
                  JSON.stringify({ success: true, data: result }, null, 2)
                )
              }
              process.exit(result.defaultsPending > 0 ? 1 : 0)
            }

            // Update global config
            await dxConfigStore.update((prev) => ({
              ...prev,
              role,
              factoryUrl: result.factoryUrl || prev.factoryUrl,
              context: result.context || prev.context,
            }))

            if (role === "workbench") {
              successLine(
                `Workbench ready — ${result.workbenchId}`,
                Date.now() - totalStart
              )
              if (result.defaultsApplied > 0) {
                infoLine(`${result.defaultsApplied} defaults applied`)
              }
              infoLine("dx dev       local dev server")
              infoLine("dx doctor    check workbench health")
              infoLine("dx deploy    deploy to site")
              console.log()

              if (f.json) {
                console.log(
                  JSON.stringify({ success: true, data: result }, null, 2)
                )
              }
              return
            }

            // Factory role continues below...
            successLine(
              `Workbench configured — ${result.workbenchId}`,
              Date.now() - totalStart
            )
            console.log()
          }

          // ── Cross-mode cleanup ──────────────────────────────────────
          // When switching factory modes (e.g. local→dev or dev→local),
          // tear down artifacts from the previous mode to avoid conflicts
          // (port 4100, k3d clusters with overlapping node-ports, etc.).
          if (role === "factory" && resolvedFactoryMode) {
            const prevMode = (await readConfig()).factoryMode
            if (prevMode && prevMode !== resolvedFactoryMode) {
              const items: string[] = []
              if (prevMode === "local") {
                items.push("local daemon (port 4100)", "k3d cluster dx-local")
              } else if (prevMode === "dev") {
                items.push(
                  "Docker Compose stack (port 4100)",
                  "k3d cluster dx-dev"
                )
              }
              if (items.length > 0) {
                let proceed = !!flags.yes
                if (!proceed) {
                  const { confirm } = await import("@crustjs/prompts")
                  proceed = await confirm({
                    message: `Switching from ${prevMode} → ${resolvedFactoryMode}. Clean up old artifacts?\n  ${items.join(", ")}`,
                    initial: true,
                  })
                }
                if (proceed) {
                  infoLine(`Cleaning up previous ${prevMode} mode artifacts...`)
                  if (prevMode === "local") {
                    const { stopLocalDaemon } =
                      await import("../local-daemon/lifecycle.js")
                    await stopLocalDaemon()
                    try {
                      const { deleteK3dCluster } =
                        await import("../handlers/cluster/k3d.js")
                      await deleteK3dCluster("dx-local")
                    } catch {}
                  } else if (prevMode === "dev") {
                    try {
                      const { resolveDxContext } =
                        await import("../lib/dx-context.js")
                      const ctx = await resolveDxContext({ need: "project" })
                      const { Compose } = await import("../lib/docker.js")
                      const { basename } = await import("node:path")
                      new Compose(
                        ctx.project.composeFiles,
                        basename(ctx.project.rootDir)
                      ).down({ volumes: true })
                    } catch {}
                    try {
                      const { deleteK3dCluster } =
                        await import("../handlers/cluster/k3d.js")
                      await deleteK3dCluster("dx-dev")
                    } catch {}
                  }
                  infoLine("Previous artifacts cleaned up.")
                  console.log()
                }
              }
            }
          }

          // Factory --mode local: k3d + embedded daemon + cluster registration
          if (role === "factory" && resolvedFactoryMode === "local") {
            infoLine("Factory mode: local (k3d + embedded daemon)")
            console.log()

            const { ensureLocalDaemon } =
              await import("../local-daemon/lifecycle.js")
            const { getK3dKubeconfig } =
              await import("../handlers/cluster/k3d.js")
            const { seedLocalInfra } =
              await import("../handlers/cluster/register.js")

            // 1. Start embedded daemon (also ensures k3d cluster internally)
            let s = phase(1, 2, "Factory daemon + cluster")
            let start = Date.now()
            await dxConfigStore.update((prev) => ({
              ...prev,
              factoryUrl: "local",
              factoryMode: "local",
            }))
            await ensureLocalDaemon()
            phaseSucceed(
              s,
              1,
              2,
              "Embedded daemon + k3d cluster dx-local",
              start
            )

            // 2. Register cluster with factory API (using inline kubeconfig YAML)
            s = phase(2, 2, "Cluster registration")
            start = Date.now()
            const kubeconfigPath = await getK3dKubeconfig("dx-local")
            await seedLocalInfra("dx-local", kubeconfigPath)
            phaseSucceed(s, 2, 2, "Cluster registered", start)

            console.log()
            successLine("Factory ready (local mode)", Date.now() - totalStart)
            infoLine("dx workbench create <name>   create a workbench")
            infoLine("dx factory status            check factory health")
            console.log()

            if (f.json) {
              console.log(
                JSON.stringify(
                  {
                    success: true,
                    data: { mode: "local", cluster: "dx-local" },
                  },
                  null,
                  2
                )
              )
            }
            return
          }

          // Factory --mode dev: k3d + Docker Compose + cluster registration
          if (role === "factory" && resolvedFactoryMode === "dev") {
            infoLine("Factory mode: dev (k3d + Docker Compose)")
            console.log()

            const { resolveDxContext } = await import("../lib/dx-context.js")
            let project: import("../lib/dx-context.js").ProjectContextData
            try {
              const ctx = await resolveDxContext({ need: "project" })
              project = ctx.project
            } catch {
              exitWithError(
                f,
                "Factory --mode dev must be run from inside a factory project directory (needs a Docker Compose file such as docker-compose.yaml)."
              )
              return
            }

            const { ensureLocalCluster } =
              await import("../local-daemon/ensure-cluster.js")
            const { readFileSync } = await import("node:fs")

            // Stop local daemon if running (shares port 4100 with Factory on Docker Compose)
            const { stopLocalDaemon } =
              await import("../local-daemon/lifecycle.js")
            await stopLocalDaemon()

            // 1. Ensure k3d cluster (separate from local mode)
            let s = phase(1, 4, "Cluster")
            let start = Date.now()
            const kubeconfigPath = await ensureLocalCluster("dx-dev", {
              apiPort: 6551,
              httpPort: 8081,
              httpsPort: 8444,
              nodePortLo: 30300,
              nodePortHi: 30500,
            })
            phaseSucceed(s, 1, 4, "k3d cluster dx-dev", start)

            // 2. Start Docker Compose stack
            s = phase(2, 4, "Docker Compose stack")
            start = Date.now()
            const { basename } = await import("node:path")
            const { Compose } = await import("../lib/docker.js")
            const allProfiles = [...new Set(project.allProfiles)] as string[]
            new Compose(project.composeFiles, basename(project.rootDir)).up({
              profiles: allProfiles.length > 0 ? allProfiles : undefined,
              detach: true,
              build: !process.env.DX_NO_BUILD,
              noBuild: !!process.env.DX_NO_BUILD,
            })
            phaseSucceed(s, 2, 4, "Docker Compose stack", start)

            // 3. Wait for factory API health
            s = phase(3, 4, "Factory API health")
            start = Date.now()
            const factoryUrl =
              process.env.DX_FACTORY_URL ?? "http://localhost:4100"
            let healthy = false
            for (let i = 0; i < 45; i++) {
              try {
                const res = await fetch(`${factoryUrl}/health`)
                if (res.ok) {
                  healthy = true
                  break
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 2000))
            }
            if (!healthy) {
              phaseFail(s, 3, 4, "Factory API health", "not healthy after 90s")
              exitWithError(
                f,
                `Factory API at ${factoryUrl} not healthy after 90s`
              )
              return
            }
            phaseSucceed(s, 3, 4, "Factory API healthy", start)

            // 4. Register cluster with Factory API (Docker Compose stack)
            s = phase(4, 4, "Cluster registration")
            start = Date.now()
            // Rewrite kubeconfig for Docker access: localhost → host.docker.internal
            const rawKubeconfig = readFileSync(kubeconfigPath, "utf-8")
            const dockerKubeconfig = rawKubeconfig.replace(
              /server:\s*https?:\/\/(0\.0\.0\.0|127\.0\.0\.1|localhost)/g,
              (match, host) => match.replace(host, "host.docker.internal")
            )
            // Set factoryUrl + factoryMode BEFORE registration so the REST client targets Factory on Docker Compose
            await dxConfigStore.update((prev) => ({
              ...prev,
              factoryUrl,
              factoryMode: "dev",
            }))

            // Register via factory REST API
            const { seedLocalInfra } =
              await import("../handlers/cluster/register.js")
            // Pass inline kubeconfig content (not file path) — seedLocalInfra reads content if it's a file
            await seedLocalInfra("dx-dev", dockerKubeconfig)
            phaseSucceed(
              s,
              4,
              4,
              "Cluster registered with Factory (Docker Compose)",
              start
            )

            console.log()
            successLine("Factory ready (dev mode)", Date.now() - totalStart)
            infoLine(`Factory API: ${factoryUrl}`)
            infoLine("dx workbench create <name>   create a workbench")
            infoLine("dx down --volumes            tear down stack")
            console.log()

            if (f.json) {
              console.log(
                JSON.stringify(
                  {
                    success: true,
                    data: { mode: "dev", cluster: "dx-dev", factoryUrl },
                  },
                  null,
                  2
                )
              )
            }
            return
          }

          // Factory --mode prod requires project context
          if (role === "factory" && resolvedFactoryMode === "prod") {
            const { resolveDxContext } = await import("../lib/dx-context.js")
            try {
              await resolveDxContext({ need: "project" })
            } catch {
              exitWithError(
                f,
                "Factory --mode prod must be run from inside a factory project directory."
              )
              return
            }
          }

          // Site/Factory --mode prod — 6-phase cluster install
          console.log()
          const TOTAL = 6

          if (flags.fresh as boolean | undefined) {
            await dxConfigStore.update((prev) => ({
              ...prev,
              installLastCompletedPhase: "0",
            }))
            config = await readConfig()
          }

          const parseSavedPhase = (raw: string) => {
            const n = parseInt(raw || "0", 10)
            if (Number.isNaN(n) || n < 0 || n > 5) return 0
            return n
          }
          const lastPhase = parseSavedPhase(config.installLastCompletedPhase)

          if (lastPhase > 0) {
            infoLine(
              `Resuming after phase ${lastPhase} (saved in ${configPath()}). Use --fresh to restart phase tracking, or dx setup reset-progress to clear only the checkpoint.`
            )
            console.log()
          }

          const persistInstallPhase = async (n: number) => {
            await dxConfigStore.update((prev) => ({
              ...prev,
              installLastCompletedPhase: String(n),
            }))
          }

          let s = phase(1, TOTAL, "Preflight")
          let start = Date.now()
          const { runPreflight } =
            await import("../handlers/install/preflight.js")
          const preflight = runPreflight({
            role,
            domain: config.domain,
            installMode: config.installMode,
            force: flags.force as boolean | undefined,
            resumeClusterInstall: lastPhase >= 2,
            remoteCluster: !!remoteKubeconfig,
            verbose: f.verbose,
          })
          if (!preflight.passed) {
            phaseFail(s, 1, TOTAL, "Preflight", "checks failed")
            printPreflightLine(preflight.checks.filter((c) => !c.passed))
            exitWithError(
              f,
              "Preflight checks failed.",
              ExitCodes.PREFLIGHT_FAILURE
            )
          }
          phaseSucceed(s, 1, TOTAL, "Preflight", start)
          if (lastPhase < 1) await persistInstallPhase(1)

          if (remoteKubeconfig) {
            // Remote cluster: skip k3s bootstrap, just verify connectivity
            s = phase(2, TOTAL, "K3s bootstrap")
            start = Date.now()
            const { getKubeconfig } = await import("../handlers/install/k3s.js")
            const connResult = (await import("../lib/subprocess.js")).run(
              "kubectl",
              ["get", "nodes", "--kubeconfig", getKubeconfig()]
            )
            if (connResult.status !== 0) {
              phaseFail(
                s,
                2,
                TOTAL,
                "K3s bootstrap",
                "cannot reach remote cluster"
              )
              exitWithError(
                f,
                `Cannot connect to remote cluster via ${remoteKubeconfig}`,
                ExitCodes.INSTALL_PHASE_FAILURE
              )
            }
            phaseSucceed(s, 2, TOTAL, "Remote cluster connected", start)
          } else if (lastPhase < 2) {
            s = phase(2, TOTAL, "K3s bootstrap")
            start = Date.now()
            const { bootstrapK3s } = await import("../handlers/install/k3s.js")
            await bootstrapK3s({
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
            })
            phaseSucceed(s, 2, TOTAL, "K3s bootstrap", start)
            const { K3S_KUBECONFIG } =
              await import("../handlers/install/k3s.js")
            await dxConfigStore.update((prev) => ({
              ...prev,
              kubeconfig: K3S_KUBECONFIG,
            }))
          } else {
            phaseSkipped(2, TOTAL, "K3s bootstrap")
            const { bootstrapK3s } = await import("../handlers/install/k3s.js")
            await bootstrapK3s({
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
              skipInstall: true,
            })
          }
          await persistInstallPhase(2)

          let chartVersion = ""
          if (remoteKubeconfig) {
            // Remote cluster: skip local image loading — Kubernetes will pull images during Helm install
            phaseSkipped(3, TOTAL, "Loading images (remote cluster)")
          } else if (lastPhase < 3) {
            s = phase(3, TOTAL, "Loading images")
            start = Date.now()
            const { loadImages } = await import("../handlers/install/images.js")
            loadImages({
              role,
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
            })
            phaseSucceed(s, 3, TOTAL, "Loading images", start)
            await persistInstallPhase(3)
          } else {
            phaseSkipped(3, TOTAL, "Loading images")
          }

          if (lastPhase < 4) {
            s = phase(4, TOTAL, "Installing platform")
            start = Date.now()
            const { helmInstall } = await import("../handlers/install/helm.js")
            chartVersion = await helmInstall({
              config,
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
            })
            phaseSucceed(s, 4, TOTAL, "Installing platform", start)
            await persistInstallPhase(4)
          } else {
            phaseSkipped(4, TOTAL, "Installing platform")
            const { getInstalledDxPlatformChartVersion } =
              await import("../handlers/install/helm.js")
            chartVersion = getInstalledDxPlatformChartVersion(f.verbose)
          }

          let manifest: InstallManifest
          if (lastPhase < 5) {
            s = phase(5, TOTAL, "Post-install")
            start = Date.now()
            const { runPostInstall } =
              await import("../handlers/install/post-install.js")
            manifest = await runPostInstall({
              config,
              helmChartVersion: chartVersion,
              dxVersion: DX_VERSION,
              verbose: f.verbose,
            })
            phaseSucceed(s, 5, TOTAL, "Post-install", start)
            await persistInstallPhase(5)
          } else {
            phaseSkipped(5, TOTAL, "Post-install")
            const { spawnSync } = await import("node:child_process")
            const { getKubeconfig } = await import("../handlers/install/k3s.js")
            const proc = spawnSync(
              "kubectl",
              [
                "get",
                "configmap",
                "dx-install-manifest",
                "-n",
                "dx-system",
                "--kubeconfig",
                getKubeconfig(),
                "-o",
                "jsonpath={.data.manifest\\.json}",
              ],
              { encoding: "utf8" }
            )
            if (proc.status !== 0) {
              exitWithError(
                f,
                "Post-install was skipped on resume but install manifest ConfigMap is missing.",
                ExitCodes.INSTALL_PHASE_FAILURE
              )
            }
            manifest = JSON.parse(proc.stdout) as typeof manifest
          }

          s = phase(6, TOTAL, "Health check")
          start = Date.now()
          const { verifyHealth } = await import("../handlers/install/health.js")
          const healthy = await verifyHealth({
            role,
            domain: config.domain,
            verbose: f.verbose,
          })
          if (!healthy) {
            phaseFail(s, 6, TOTAL, "Health check", "verification failed")
            exitWithError(
              f,
              "Health verification failed.",
              ExitCodes.INSTALL_PHASE_FAILURE
            )
          }
          phaseSucceed(s, 6, TOTAL, "Health check", start)

          await dxConfigStore.update((prev) => ({
            ...prev,
            installLastCompletedPhase: "0",
          }))

          const label = role === "factory" ? "Factory" : "Site"
          successLine(
            `${label} ready — https://${config.domain}`,
            Date.now() - totalStart
          )
          infoLine(`Config: ${configPath()}`)
          console.log()

          if (f.json) {
            console.log(
              JSON.stringify({ success: true, data: manifest }, null, 2)
            )
          }
        } catch (err) {
          // Ctrl+C from prompts
          if (
            err &&
            typeof err === "object" &&
            "name" in err &&
            (err as { name: string }).name === "CancelledError"
          ) {
            console.log("\n  Install cancelled.")
            process.exit(1)
          }
          const msg = err instanceof Error ? err.message : String(err)
          exitWithError(f, msg, ExitCodes.INSTALL_PHASE_FAILURE)
        }
      })

      // --- Subcommands ---

      .command("reset-progress", (c) =>
        c
          .meta({
            description:
              "Clear saved cluster install checkpoint (installLastCompletedPhase); does not remove k3s or Helm",
          })
          .run(async () => {
            await dxConfigStore.update((prev) => ({
              ...prev,
              installLastCompletedPhase: "0",
            }))
            console.log(`Install checkpoint cleared (${configPath()}).`)
          })
      )

      .command("preflight", (c) =>
        c
          .meta({ description: "Run preflight checks only (dry run)" })
          .flags({
            role: {
              type: "string",
              description: "Installation role: workbench, site, or factory",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              let role: InstallRole = (flags.role as InstallRole) || "workbench"
              let installConfig = await readConfig()
              if (!flags.role) {
                if (!configExists()) {
                  const { select } = await import("@crustjs/prompts")
                  role = await select<InstallRole>({
                    message: "Role",
                    choices: [
                      { value: "workbench", label: "Workbench" },
                      { value: "site", label: "Site" },
                      { value: "factory", label: "Factory" },
                    ],
                  })
                } else {
                  installConfig = await readConfig()
                  role = installConfig.role as InstallRole
                }
              }

              const saved = parseInt(
                installConfig.installLastCompletedPhase || "0",
                10
              )
              const resumeCluster = !Number.isNaN(saved) && saved >= 2

              const { runPreflight } =
                await import("../handlers/install/preflight.js")
              const result = runPreflight({
                role,
                domain: installConfig.domain,
                installMode: installConfig.installMode,
                resumeClusterInstall: resumeCluster,
              })

              printPreflightLine(result.checks)

              if (f.json) {
                console.log(
                  JSON.stringify({ success: true, data: result }, null, 2)
                )
              }

              if (!result.passed) process.exit(ExitCodes.PREFLIGHT_FAILURE)
            } catch (err) {
              if (
                err &&
                typeof err === "object" &&
                "name" in err &&
                (err as { name: string }).name === "CancelledError"
              ) {
                console.log("\n  Cancelled.")
                process.exit(1)
              }
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg, ExitCodes.PREFLIGHT_FAILURE)
            }
          })
      )

      .command("upgrade", (c) =>
        c
          .meta({ description: "Upgrade an existing dx platform installation" })
          .flags({
            bundle: {
              type: "string",
              short: "b",
              description: "Path to offline bundle directory",
            },
            version: { type: "string", description: "Target version" },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              await hydrateKubeconfig()
              const { runUpgrade } =
                await import("../handlers/install/upgrade.js")
              await runUpgrade({
                bundlePath: flags.bundle as string | undefined,
                version: flags.version as string | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg, ExitCodes.UPGRADE_FAILURE)
            }
          })
      )

      .command("join", (c) =>
        c
          .meta({ description: "Join this node to an existing dx cluster" })
          .flags({
            server: {
              type: "string",
              required: true,
              description: "Server URL",
            },
            token: {
              type: "string",
              required: true,
              description: "Join token",
            },
            bundle: {
              type: "string",
              short: "b",
              description: "Path to offline bundle directory",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { runJoin } = await import("../handlers/install/join.js")
              await runJoin({
                server: flags.server as string,
                token: flags.token as string,
                bundlePath: flags.bundle as string | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg, ExitCodes.JOIN_FAILURE)
            }
          })
      )

      .command("status", (c) =>
        c
          .meta({ description: "Show install manifest and status" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              await hydrateKubeconfig()
              const { spawnSync } = await import("node:child_process")
              const { getKubeconfig } =
                await import("../handlers/install/k3s.js")
              const proc = spawnSync(
                "kubectl",
                [
                  "get",
                  "configmap",
                  "dx-install-manifest",
                  "-n",
                  "dx-system",
                  "--kubeconfig",
                  getKubeconfig(),
                  "-o",
                  "jsonpath={.data.manifest\\.json}",
                ],
                { encoding: "utf8" }
              )

              if (proc.status !== 0) {
                exitWithError(
                  f,
                  "No install manifest found. Is dx-platform installed?",
                  ExitCodes.NOT_FOUND
                )
              }

              const manifest = JSON.parse(proc.stdout)
              const { printKeyValue, printTable } = await import("../output.js")

              if (f.json) {
                console.log(
                  JSON.stringify({ success: true, data: manifest }, null, 2)
                )
              } else {
                console.log(
                  printKeyValue({
                    Site: manifest.siteName,
                    Domain: manifest.domain,
                    Role: manifest.role,
                    Version: manifest.dxVersion,
                    Mode: manifest.installMode,
                    Installed: manifest.installedAt,
                  })
                )

                if (manifest.nodes?.length > 0) {
                  console.log("\nNodes:")
                  console.log(
                    printTable(
                      ["Name", "Role", "IP", "Joined"],
                      manifest.nodes.map(
                        (n: {
                          name: string
                          role: string
                          ip: string
                          joinedAt: string
                        }) => [n.name, n.role, n.ip, n.joinedAt]
                      )
                    )
                  )
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg)
            }
          })
      )

      .command("restore", (c) =>
        c
          .meta({
            description:
              "Restore config files from backups made during dx setup",
          })
          .args([
            {
              name: "category",
              type: "string",
              description:
                "Filter by filename prefix (e.g. '.npmrc', '.gitconfig') or 'all'",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const { listBackups, restoreBackup, getBackupDir } =
                await import("../handlers/install/defaults/backup.js")
              const filter = args.category as string | undefined
              const prefix = filter && filter !== "all" ? filter : undefined
              const backups = listBackups(prefix)

              if (backups.length === 0) {
                console.log(
                  `  No backups found${prefix ? ` matching "${prefix}"` : ""} in ${getBackupDir()}`
                )
                return
              }

              // Group by original file — only show the most recent backup per file
              const latestByFile = new Map<string, (typeof backups)[0]>()
              for (const b of backups) {
                if (!b.originalPath) continue
                if (!latestByFile.has(b.originalPath)) {
                  latestByFile.set(b.originalPath, b)
                }
              }

              if (latestByFile.size === 0) {
                console.log(
                  `  Found ${backups.length} backup(s) but none have recorded original paths.`
                )
                console.log(`  Backups in ${getBackupDir()}:`)
                for (const b of backups.slice(0, 10)) {
                  console.log(`    ${b.name}  ${b.mtime.toLocaleString()}`)
                }
                return
              }

              console.log(`  Restorable files (most recent backup each):\n`)
              const entries = [...latestByFile.entries()]
              for (const [origPath, b] of entries) {
                console.log(
                  `    ${origPath}  ← ${b.name}  (${b.mtime.toLocaleString()})`
                )
              }
              console.log()

              const { select: selectPrompt, multiselect } =
                await import("@crustjs/prompts")
              const action = await selectPrompt({
                message: `Restore ${entries.length} file(s) to their original locations?`,
                choices: [
                  {
                    value: "all",
                    label: `Restore all ${entries.length} files`,
                  },
                  { value: "pick", label: "Pick which to restore" },
                  { value: "cancel", label: "Cancel" },
                ],
                default: "all",
              })

              if (action === "cancel") return

              let toRestore = entries
              if (action === "pick") {
                const picked = await multiselect({
                  message: "Select files to restore:",
                  choices: entries.map(([origPath, b]) => ({
                    value: origPath,
                    label: `${origPath} (from ${b.mtime.toLocaleString()})`,
                  })),
                })
                toRestore = entries.filter(([p]) => picked.includes(p))
              }

              let restored = 0
              for (const [origPath, b] of toRestore) {
                const ok = restoreBackup(b.path, origPath)
                if (ok) {
                  console.log(`  ${origPath} restored`)
                  restored++
                } else {
                  console.log(`  ${origPath} — restore failed`)
                }
              }

              console.log(
                `\n  Restored ${restored}/${toRestore.length} file(s)`
              )
            } catch (err) {
              if (
                err &&
                typeof err === "object" &&
                "name" in err &&
                (err as { name: string }).name === "CancelledError"
              ) {
                console.log("\n  Cancelled.")
                process.exit(1)
              }
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg)
            }
          })
      )

      .command("uninstall", (c) =>
        c
          .meta({ description: "Tear down dx platform" })
          .flags({
            keepK3s: {
              type: "boolean",
              description: "Keep k3s installed (only remove dx-platform)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              await hydrateKubeconfig()
              const { runUninstall } =
                await import("../handlers/install/uninstall.js")
              await runUninstall({
                keepK3s: flags.keepK3s as boolean | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg)
            }
          })
      )
  )
}
