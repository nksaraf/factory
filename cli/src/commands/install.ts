import type { DxBase } from "../dx-root.js";
import { ExitCodes } from "@smp/factory-shared/exit-codes";
import type { InstallManifest, InstallRole } from "@smp/factory-shared/install-types";
import { exitWithError } from "../lib/cli-exit.js";
import { dxConfigStore, configExists, readConfig, configPath } from "../config.js";
import {
  banner,
  phase,
  phaseSucceed,
  phaseFail,
  phaseSkipped,
  printPreflightLine,
  successLine,
  infoLine,
} from "../lib/cli-ui.js";
import { toDxFlags } from "./dx-flags.js";

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev";

/** Load kubeconfig from persisted config into the runtime setter. */
async function hydrateKubeconfig(): Promise<void> {
  const config = await readConfig();
  if (config.kubeconfig) {
    const { setKubeconfig } = await import("../handlers/install/k3s.js");
    setKubeconfig(config.kubeconfig);
  }
}

export function installCommand(app: DxBase) {
  return app
    .sub("install")
    .meta({ description: "Install, upgrade, and manage the dx platform" })
    .flags({
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      role: { type: "string", description: "Installation role: workbench (default), site, or factory" },
      force: { type: "boolean", description: "Force install over existing installation" },
      fresh: {
        type: "boolean",
        description: "Ignore saved install progress and start from phase 1 (still need --force if k3s exists)",
      },
      kubeconfig: {
        type: "string",
        short: "k",
        description: "Path to kubeconfig for a remote k3s/k8s cluster (skips local k3s bootstrap and image loading)",
      },
      yes: { type: "boolean", short: "y", description: "Skip interactive prompts (workbench only)" },
      dir: { type: "string", description: "Workbench root directory (default: cwd)" },
      type: {
        type: "string",
        short: "t",
        description: "Workbench type: developer, ci, agent, sandbox, build, testbed",
      },
      "registry-key": { type: "string", description: "Base64-encoded GCP service account key for registry auth" },
      "registry-key-file": { type: "string", description: "Path to GCP service account key file for registry auth" },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const totalStart = Date.now();

      try {
        banner(DX_VERSION);

        let config = await readConfig();
        const hasExistingConfig = configExists();

        // Determine role: explicit flag > existing config > default to workbench
        const roleOverride = flags.role as InstallRole | undefined;
        let role: InstallRole;

        if (roleOverride) {
          role = roleOverride;
          if (!hasExistingConfig || config.role !== roleOverride) {
            await dxConfigStore.update((prev) => ({ ...prev, role: roleOverride }));
            config = await readConfig();
          }
        } else if (hasExistingConfig && (config.role === "site" || config.role === "factory")) {
          // Existing site/factory config — use that role
          role = config.role as InstallRole;
          console.log(`  Config found: ${config.role} (${config.context || config.siteName || new URL(config.factoryUrl).hostname})\n`);
        } else if (roleOverride === "site" || roleOverride === "factory") {
          // Site/Factory needs the wizard
          role = roleOverride;
          const { runWizard } = await import("../handlers/install/interactive-setup.js");
          const wizard = await runWizard(config);
          await dxConfigStore.write({
            role: wizard.role,
            factoryUrl: wizard.factoryUrl,
            siteUrl: wizard.siteUrl,
            context: config.context,
            authBasePath: config.authBasePath,
            siteName: wizard.siteName,
            domain: wizard.domain,
            adminEmail: wizard.adminEmail,
            tlsMode: wizard.tlsMode,
            tlsCertPath: wizard.tlsCertPath,
            tlsKeyPath: wizard.tlsKeyPath,
            databaseMode: wizard.databaseMode,
            databaseUrl: wizard.databaseUrl,
            registryMode: wizard.registryMode,
            registryUrl: wizard.registryUrl,
            resourceProfile: wizard.resourceProfile,
            networkPodCidr: config.networkPodCidr,
            networkServiceCidr: config.networkServiceCidr,
            installMode: config.installMode,
            installLastCompletedPhase: config.installLastCompletedPhase,
            kubeconfig: config.kubeconfig,
          });
          config = await readConfig();
        } else {
          // Default to workbench
          role = "workbench";
        }

        const remoteKubeconfig = flags.kubeconfig as string | undefined;

        // Set kubeconfig for remote cluster mode
        if (remoteKubeconfig) {
          const { resolve } = await import("node:path");
          const { existsSync } = await import("node:fs");
          const absKubeconfig = resolve(remoteKubeconfig);
          if (!existsSync(absKubeconfig)) {
            exitWithError(f, `Kubeconfig not found: ${absKubeconfig}`, ExitCodes.PREFLIGHT_FAILURE);
          }
          const { setKubeconfig } = await import("../handlers/install/k3s.js");
          setKubeconfig(absKubeconfig);
          await dxConfigStore.update((prev) => ({ ...prev, kubeconfig: absKubeconfig }));
          infoLine(`Using remote cluster kubeconfig: ${absKubeconfig}`);
        }

        // Workbench flow
        if (role === "workbench") {
          const { runWorkbenchSetup } = await import("../handlers/install/workbench.js");
          const result = await runWorkbenchSetup({
            factoryUrl: config.factoryUrl,
            dir: flags.dir as string | undefined,
            type: flags.type as string | undefined,
            yes: flags.yes as boolean | undefined,
            verbose: f.verbose,
            registryKey: flags["registry-key"] as string | undefined,
            registryKeyFile: flags["registry-key-file"] as string | undefined,
          });

          // Update global config
          await dxConfigStore.update((prev) => ({
            ...prev,
            role: "workbench",
            factoryUrl: result.factoryUrl || prev.factoryUrl,
            context: result.context || prev.context,
          }));

          successLine(`Workbench ready — ${result.workbenchId}`, Date.now() - totalStart);
          infoLine("dx dev       local dev server");
          infoLine("dx doctor    check workbench health");
          infoLine("dx deploy    deploy to site");
          console.log();

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          }
          return;
        }

        // Site/Factory — 6-phase cluster install
        console.log();
        const TOTAL = 6;

        if (flags.fresh as boolean | undefined) {
          await dxConfigStore.update((prev) => ({ ...prev, installLastCompletedPhase: "0" }));
          config = await readConfig();
        }

        const parseSavedPhase = (raw: string) => {
          const n = parseInt(raw || "0", 10);
          if (Number.isNaN(n) || n < 0 || n > 5) return 0;
          return n;
        };
        const lastPhase = parseSavedPhase(config.installLastCompletedPhase);

        if (lastPhase > 0) {
          infoLine(
            `Resuming after phase ${lastPhase} (saved in ${configPath()}). Use --fresh to restart phase tracking, or dx install reset-progress to clear only the checkpoint.`
          );
          console.log();
        }

        const persistInstallPhase = async (n: number) => {
          await dxConfigStore.update((prev) => ({ ...prev, installLastCompletedPhase: String(n) }));
        };

        let s = phase(1, TOTAL, "Preflight");
        let start = Date.now();
        const { runPreflight } = await import("../handlers/install/preflight.js");
        const preflight = runPreflight({
          role,
          domain: config.domain,
          installMode: config.installMode,
          force: flags.force as boolean | undefined,
          resumeClusterInstall: lastPhase >= 2,
          remoteCluster: !!remoteKubeconfig,
          verbose: f.verbose,
        });
        if (!preflight.passed) {
          phaseFail(s, 1, TOTAL, "Preflight", "checks failed");
          printPreflightLine(preflight.checks.filter((c) => !c.passed));
          exitWithError(f, "Preflight checks failed.", ExitCodes.PREFLIGHT_FAILURE);
        }
        phaseSucceed(s, 1, TOTAL, "Preflight", start);
        if (lastPhase < 1) await persistInstallPhase(1);

        if (remoteKubeconfig) {
          // Remote cluster: skip k3s bootstrap, just verify connectivity
          s = phase(2, TOTAL, "K3s bootstrap");
          start = Date.now();
          const { getKubeconfig } = await import("../handlers/install/k3s.js");
          const connResult = (await import("../lib/subprocess.js")).run("kubectl", [
            "get", "nodes", "--kubeconfig", getKubeconfig(),
          ]);
          if (connResult.status !== 0) {
            phaseFail(s, 2, TOTAL, "K3s bootstrap", "cannot reach remote cluster");
            exitWithError(f, `Cannot connect to remote cluster via ${remoteKubeconfig}`, ExitCodes.INSTALL_PHASE_FAILURE);
          }
          phaseSucceed(s, 2, TOTAL, "Remote cluster connected", start);
        } else if (lastPhase < 2) {
          s = phase(2, TOTAL, "K3s bootstrap");
          start = Date.now();
          const { bootstrapK3s } = await import("../handlers/install/k3s.js");
          await bootstrapK3s({
            bundlePath: flags.bundle as string | undefined,
            verbose: f.verbose,
          });
          phaseSucceed(s, 2, TOTAL, "K3s bootstrap", start);
          const { K3S_KUBECONFIG } = await import("../handlers/install/k3s.js");
          await dxConfigStore.update((prev) => ({ ...prev, kubeconfig: K3S_KUBECONFIG }));
        } else {
          phaseSkipped(2, TOTAL, "K3s bootstrap");
          const { bootstrapK3s } = await import("../handlers/install/k3s.js");
          await bootstrapK3s({
            bundlePath: flags.bundle as string | undefined,
            verbose: f.verbose,
            skipInstall: true,
          });
        }
        await persistInstallPhase(2);

        let chartVersion = "";
        if (remoteKubeconfig) {
          // Remote cluster: skip local image loading — k8s will pull images during helm install
          phaseSkipped(3, TOTAL, "Loading images (remote cluster)");
        } else if (lastPhase < 3) {
          s = phase(3, TOTAL, "Loading images");
          start = Date.now();
          const { loadImages } = await import("../handlers/install/images.js");
          loadImages({
            role,
            bundlePath: flags.bundle as string | undefined,
            verbose: f.verbose,
          });
          phaseSucceed(s, 3, TOTAL, "Loading images", start);
          await persistInstallPhase(3);
        } else {
          phaseSkipped(3, TOTAL, "Loading images");
        }

        if (lastPhase < 4) {
          s = phase(4, TOTAL, "Installing platform");
          start = Date.now();
          const { helmInstall } = await import("../handlers/install/helm.js");
          chartVersion = await helmInstall({
            config,
            bundlePath: flags.bundle as string | undefined,
            verbose: f.verbose,
          });
          phaseSucceed(s, 4, TOTAL, "Installing platform", start);
          await persistInstallPhase(4);
        } else {
          phaseSkipped(4, TOTAL, "Installing platform");
          const { getInstalledDxPlatformChartVersion } = await import("../handlers/install/helm.js");
          chartVersion = getInstalledDxPlatformChartVersion(f.verbose);
        }

        let manifest: InstallManifest;
        if (lastPhase < 5) {
          s = phase(5, TOTAL, "Post-install");
          start = Date.now();
          const { runPostInstall } = await import("../handlers/install/post-install.js");
          manifest = await runPostInstall({
            config,
            helmChartVersion: chartVersion,
            dxVersion: DX_VERSION,
            verbose: f.verbose,
          });
          phaseSucceed(s, 5, TOTAL, "Post-install", start);
          await persistInstallPhase(5);
        } else {
          phaseSkipped(5, TOTAL, "Post-install");
          const { spawnSync } = await import("node:child_process");
          const { getKubeconfig } = await import("../handlers/install/k3s.js");
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
          );
          if (proc.status !== 0) {
            exitWithError(
              f,
              "Post-install was skipped on resume but install manifest ConfigMap is missing.",
              ExitCodes.INSTALL_PHASE_FAILURE
            );
          }
          manifest = JSON.parse(proc.stdout) as typeof manifest;
        }

        s = phase(6, TOTAL, "Health check");
        start = Date.now();
        const { verifyHealth } = await import("../handlers/install/health.js");
        const healthy = await verifyHealth({
          role,
          domain: config.domain,
          verbose: f.verbose,
        });
        if (!healthy) {
          phaseFail(s, 6, TOTAL, "Health check", "verification failed");
          exitWithError(f, "Health verification failed.", ExitCodes.INSTALL_PHASE_FAILURE);
        }
        phaseSucceed(s, 6, TOTAL, "Health check", start);

        await dxConfigStore.update((prev) => ({ ...prev, installLastCompletedPhase: "0" }));

        const label = role === "factory" ? "Factory" : "Site";
        successLine(`${label} ready — https://${config.domain}`, Date.now() - totalStart);
        infoLine(`Config: ${configPath()}`);
        console.log();

        if (f.json) {
          console.log(JSON.stringify({ success: true, data: manifest }, null, 2));
        }
      } catch (err) {
        // Ctrl+C from @inquirer/prompts
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ExitPromptError") {
          console.log("\n  Install cancelled.");
          process.exit(1);
        }
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg, ExitCodes.INSTALL_PHASE_FAILURE);
      }
    })

    // --- Subcommands ---

    .command("reset-progress", (c) =>
      c
        .meta({
          description: "Clear saved cluster install checkpoint (installLastCompletedPhase); does not remove k3s or Helm",
        })
        .run(async () => {
          await dxConfigStore.update((prev) => ({ ...prev, installLastCompletedPhase: "0" }));
          console.log(`Install checkpoint cleared (${configPath()}).`);
        })
    )

    .command("preflight", (c) =>
      c
        .meta({ description: "Run preflight checks only (dry run)" })
        .flags({
          role: { type: "string", description: "Installation role: workbench, site, or factory" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            let role: InstallRole = (flags.role as InstallRole) || "workbench";
            let installConfig = await readConfig();
            if (!flags.role) {
              if (!configExists()) {
                const { select } = await import("@inquirer/prompts");
                role = await select<InstallRole>({
                  message: "Role",
                  choices: [
                    { value: "workbench", name: "Workbench" },
                    { value: "site", name: "Site" },
                    { value: "factory", name: "Factory" },
                  ],
                });
              } else {
                installConfig = await readConfig();
                role = installConfig.role as InstallRole;
              }
            }

            const saved = parseInt(installConfig.installLastCompletedPhase || "0", 10);
            const resumeCluster = !Number.isNaN(saved) && saved >= 2;

            const { runPreflight } = await import("../handlers/install/preflight.js");
            const result = runPreflight({
              role,
              domain: installConfig.domain,
              installMode: installConfig.installMode,
              resumeClusterInstall: resumeCluster,
            });

            printPreflightLine(result.checks);

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: result }, null, 2));
            }

            if (!result.passed) process.exit(ExitCodes.PREFLIGHT_FAILURE);
          } catch (err) {
            if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ExitPromptError") {
              console.log("\n  Cancelled.");
              process.exit(1);
            }
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.PREFLIGHT_FAILURE);
          }
        })
    )

    .command("upgrade", (c) =>
      c
        .meta({ description: "Upgrade an existing dx platform installation" })
        .flags({
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
          version: { type: "string", description: "Target version" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            await hydrateKubeconfig();
            const { runUpgrade } = await import("../handlers/install/upgrade.js");
            await runUpgrade({
              bundlePath: flags.bundle as string | undefined,
              version: flags.version as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.UPGRADE_FAILURE);
          }
        })
    )

    .command("join", (c) =>
      c
        .meta({ description: "Join this node to an existing dx cluster" })
        .flags({
          server: { type: "string", required: true, description: "Server URL" },
          token: { type: "string", required: true, description: "Join token" },
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { runJoin } = await import("../handlers/install/join.js");
            await runJoin({
              server: flags.server as string,
              token: flags.token as string,
              bundlePath: flags.bundle as string | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.JOIN_FAILURE);
          }
        })
    )

    .command("status", (c) =>
      c
        .meta({ description: "Show install manifest and status" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            await hydrateKubeconfig();
            const { spawnSync } = await import("node:child_process");
            const { getKubeconfig } = await import("../handlers/install/k3s.js");
            const proc = spawnSync("kubectl", [
              "get", "configmap", "dx-install-manifest",
              "-n", "dx-system",
              "--kubeconfig", getKubeconfig(),
              "-o", "jsonpath={.data.manifest\\.json}",
            ], { encoding: "utf8" });

            if (proc.status !== 0) {
              exitWithError(f, "No install manifest found. Is dx-platform installed?", ExitCodes.NOT_FOUND);
            }

            const manifest = JSON.parse(proc.stdout);
            const { printKeyValue, printTable } = await import("../output.js");

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: manifest }, null, 2));
            } else {
              console.log(printKeyValue({
                "Site": manifest.siteName,
                "Domain": manifest.domain,
                "Role": manifest.role,
                "Version": manifest.dxVersion,
                "Mode": manifest.installMode,
                "Installed": manifest.installedAt,
              }));

              if (manifest.nodes?.length > 0) {
                console.log("\nNodes:");
                console.log(printTable(
                  ["Name", "Role", "IP", "Joined"],
                  manifest.nodes.map((n: { name: string; role: string; ip: string; joinedAt: string }) => [
                    n.name, n.role, n.ip, n.joinedAt,
                  ])
                ));
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    )

    .command("uninstall", (c) =>
      c
        .meta({ description: "Tear down dx platform" })
        .flags({
          keepK3s: { type: "boolean", description: "Keep k3s installed (only remove dx-platform)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            await hydrateKubeconfig();
            const { runUninstall } = await import("../handlers/install/uninstall.js");
            await runUninstall({
              keepK3s: flags.keepK3s as boolean | undefined,
              verbose: f.verbose,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    );
}
