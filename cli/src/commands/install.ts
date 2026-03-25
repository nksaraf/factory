import type { DxBase } from "../dx-root.js";
import { ExitCodes } from "@smp/factory-shared/exit-codes";
import type { InstallRole } from "@smp/factory-shared/install-types";
import { exitWithError } from "../lib/cli-exit.js";
import { dxConfigStore, configExists, readConfig, configPath } from "../config.js";
import { banner, phase, phaseSucceed, phaseFail, printPreflightLine, successLine, infoLine } from "../lib/cli-ui.js";
import { toDxFlags } from "./dx-flags.js";

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev";

export function installCommand(app: DxBase) {
  return app
    .sub("install")
    .meta({ description: "Install, upgrade, and manage the dx platform" })
    .flags({
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      role: { type: "string", description: "Installation role: workbench, site, or factory" },
      force: { type: "boolean", description: "Force install over existing installation" },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const totalStart = Date.now();

      try {
        banner(DX_VERSION);

        let config = await readConfig();
        const hasExistingConfig = configExists();

        if (hasExistingConfig && config.siteName) {
          console.log(`  Config found: ${config.role} (${config.context || config.siteName || new URL(config.factoryUrl).hostname})\n`);
        } else {
          // Light preflight before wizard
          console.log("  Checking system...");
          const { runPreflight } = await import("../handlers/install/preflight.js");
          const lightPreflight = runPreflight({
            role: (flags.role as InstallRole) || "workbench",
          });
          printPreflightLine(lightPreflight.checks);
          console.log();

          if (!lightPreflight.passed) {
            exitWithError(f, "System requirements not met.", ExitCodes.PREFLIGHT_FAILURE);
          }

          // Interactive wizard
          const { runWizard } = await import("../handlers/install/interactive-setup.js");
          const wizard = await runWizard(config);

          // Write wizard results to store
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
          });

          config = await readConfig();
        }

        const role: InstallRole = (flags.role as InstallRole) || (config.role as InstallRole);

        // Workbench flow
        if (role === "workbench") {
          const { runWorkbenchSetup } = await import("../handlers/install/workbench.js");
          const result = await runWorkbenchSetup({
            factoryUrl: config.factoryUrl,
            verbose: f.verbose,
          });

          // Update context in store if set
          if (result.context) {
            await dxConfigStore.update((prev) => ({ ...prev, context: result.context! }));
          }

          successLine(`Workbench ready — ${new URL(config.factoryUrl).hostname}`, Date.now() - totalStart);
          infoLine("dx dev       local dev server");
          infoLine("dx deploy    deploy to site");
          infoLine("dx status    check platform");
          console.log();

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          }
          return;
        }

        // Site/Factory — 6-phase cluster install
        console.log();
        const TOTAL = 6;

        // Phase 1: Full preflight
        let s = phase(1, TOTAL, "Preflight");
        let start = Date.now();
        const { runPreflight } = await import("../handlers/install/preflight.js");
        const preflight = runPreflight({
          role,
          domain: config.domain,
          installMode: config.installMode,
          force: flags.force as boolean | undefined,
        });
        if (!preflight.passed) {
          phaseFail(s, 1, TOTAL, "Preflight", "checks failed");
          printPreflightLine(preflight.checks.filter((c) => !c.passed));
          exitWithError(f, "Preflight checks failed.", ExitCodes.PREFLIGHT_FAILURE);
        }
        phaseSucceed(s, 1, TOTAL, "Preflight", start);

        // Phase 2: K3s
        s = phase(2, TOTAL, "K3s bootstrap");
        start = Date.now();
        const { bootstrapK3s } = await import("../handlers/install/k3s.js");
        await bootstrapK3s({
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 2, TOTAL, "K3s bootstrap", start);

        // Phase 3: Images
        s = phase(3, TOTAL, "Loading images");
        start = Date.now();
        const { loadImages } = await import("../handlers/install/images.js");
        loadImages({
          role,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 3, TOTAL, "Loading images", start);

        // Phase 4: Helm install
        s = phase(4, TOTAL, "Installing platform");
        start = Date.now();
        const { helmInstall } = await import("../handlers/install/helm.js");
        const chartVersion = await helmInstall({
          config,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        phaseSucceed(s, 4, TOTAL, "Installing platform", start);

        // Phase 5: Post-install
        s = phase(5, TOTAL, "Post-install");
        start = Date.now();
        const { runPostInstall } = await import("../handlers/install/post-install.js");
        const manifest = await runPostInstall({
          config,
          helmChartVersion: chartVersion,
          dxVersion: DX_VERSION,
          verbose: f.verbose,
        });
        phaseSucceed(s, 5, TOTAL, "Post-install", start);

        // Phase 6: Health
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

        // Success
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
                const config = await readConfig();
                role = config.role as InstallRole;
              }
            }

            const { runPreflight } = await import("../handlers/install/preflight.js");
            const result = runPreflight({ role });

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
            const { spawnSync } = await import("node:child_process");
            const proc = spawnSync("kubectl", [
              "get", "configmap", "dx-install-manifest",
              "-n", "dx-system",
              "--kubeconfig", "/etc/rancher/k3s/k3s.yaml",
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
