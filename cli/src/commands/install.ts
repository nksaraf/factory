import type { DxBase } from "../dx-root.js";

import { ExitCodes } from "@smp/factory-shared/exit-codes";
import type { InstallRole } from "@smp/factory-shared/install-types";
import { exitWithError } from "../lib/cli-exit.js";
import { loadSiteConfig } from "../lib/site-config.js";
import { toDxFlags } from "./dx-flags.js";
import { printTable, printKeyValue } from "../output.js";

export function installCommand(app: DxBase) {
  return app
    .sub("install")
    .meta({ description: "Install, upgrade, and manage the dx platform on a site or factory" })
    .flags({
      config: { type: "string", short: "c", description: "Path to config.yaml" },
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      role: { type: "string", description: "Installation role: site (default) or factory" },
      force: { type: "boolean", description: "Force install over existing installation" },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      try {
        const config = loadSiteConfig(flags.config as string | undefined);
        // CLI --role flag overrides config.yaml
        if (flags.role) {
          (config as { role: string }).role = flags.role as string;
        }
        const role: InstallRole = config.role;

        console.log(`dx install — role: ${role}, mode: ${config.install.mode}`);
        console.log(`Site: ${config.site.name} (${config.site.domain})\n`);

        // Phase 1: Preflight
        console.log("=== Phase 1: Preflight ===");
        const { runPreflight } = await import("../handlers/install/preflight.js");
        const preflight = runPreflight({
          role,
          domain: config.site.domain,
          installMode: config.install.mode,
          force: flags.force as boolean | undefined,
        });

        const preflightTable = printTable(
          ["Check", "Status", "Message"],
          preflight.checks.map((c) => [
            c.name,
            c.passed ? "PASS" : c.required ? "FAIL" : "WARN",
            c.message,
          ])
        );
        console.log(preflightTable + "\n");

        if (!preflight.passed) {
          exitWithError(f, "Preflight checks failed. Fix the issues above and retry.", ExitCodes.PREFLIGHT_FAILURE);
        }

        // Phase 2: K3s Bootstrap
        console.log("=== Phase 2: K3s Bootstrap ===");
        const { bootstrapK3s } = await import("../handlers/install/k3s.js");
        const { joinToken } = await bootstrapK3s({
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        console.log(`Join token: ${joinToken.substring(0, 10)}...\n`);

        // Phase 3: Image Load
        console.log("=== Phase 3: Image Load ===");
        const { loadImages } = await import("../handlers/install/images.js");
        loadImages({
          role,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        console.log();

        // Phase 4: Platform Install
        console.log("=== Phase 4: Platform Install ===");
        const { helmInstall } = await import("../handlers/install/helm.js");
        const chartVersion = await helmInstall({
          config,
          bundlePath: flags.bundle as string | undefined,
          verbose: f.verbose,
        });
        console.log();

        // Phase 5: Post-Install
        console.log("=== Phase 5: Post-Install ===");
        const { runPostInstall } = await import("../handlers/install/post-install.js");
        const dxVersion = process.env.DX_VERSION ?? "0.0.0-dev";
        const manifest = await runPostInstall({
          config,
          helmChartVersion: chartVersion,
          dxVersion,
          verbose: f.verbose,
        });
        console.log();

        // Phase 6: Health Verification
        console.log("=== Phase 6: Health Verification ===");
        const { verifyHealth } = await import("../handlers/install/health.js");
        const healthy = await verifyHealth({
          role,
          domain: config.site.domain,
          verbose: f.verbose,
        });

        if (!healthy) {
          exitWithError(f, "Health verification failed.", ExitCodes.INSTALL_PHASE_FAILURE);
        }

        // Summary
        console.log("\n" + printKeyValue({
          "Site": config.site.name,
          "Domain": config.site.domain,
          "Role": role,
          "Mode": config.install.mode,
          "Version": dxVersion,
          "Planes": manifest.enabledPlanes.join(", "),
        }));

        console.log("\nInstallation complete.");

        if (f.json) {
          console.log(JSON.stringify({ success: true, data: manifest }, null, 2));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg, ExitCodes.INSTALL_PHASE_FAILURE);
      }
    })

    // --- Subcommands ---

    .command("preflight", (c) =>
      c
        .meta({ description: "Run preflight checks only (dry run)" })
        .flags({
          config: { type: "string", short: "c", description: "Path to config.yaml" },
          role: { type: "string", description: "Installation role: site (default) or factory" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const config = loadSiteConfig(flags.config as string | undefined);
            if (flags.role) (config as { role: string }).role = flags.role as string;

            const { runPreflight } = await import("../handlers/install/preflight.js");
            const result = runPreflight({
              role: config.role,
              domain: config.site.domain,
              installMode: config.install.mode,
            });

            const table = printTable(
              ["Check", "Status", "Message"],
              result.checks.map((c) => [
                c.name,
                c.passed ? "PASS" : c.required ? "FAIL" : "WARN",
                c.message,
              ])
            );
            console.log(table);

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: result }, null, 2));
            }

            if (!result.passed) {
              process.exit(ExitCodes.PREFLIGHT_FAILURE);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg, ExitCodes.PREFLIGHT_FAILURE);
          }
        })
    )

    .command("upgrade", (c) =>
      c
        .meta({ description: "Upgrade an existing dx platform installation" })
        .flags({
          config: { type: "string", short: "c", description: "Path to config.yaml" },
          bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
          version: { type: "string", description: "Target version" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { runUpgrade } = await import("../handlers/install/upgrade.js");
            await runUpgrade({
              bundlePath: flags.bundle as string | undefined,
              configPath: flags.config as string | undefined,
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
          server: { type: "string", required: true, description: "Server URL (e.g. https://10.0.0.1:6443)" },
          token: { type: "string", required: true, description: "Join token from server node" },
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
                "k3s": manifest.k3sVersion,
                "Chart": manifest.helmChartVersion,
                "Planes": manifest.enabledPlanes?.join(", "),
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

              if (manifest.upgrades?.length > 0) {
                console.log("\nUpgrade history:");
                console.log(printTable(
                  ["From", "To", "Date"],
                  manifest.upgrades.map((u: { fromVersion: string; toVersion: string; upgradedAt: string }) => [
                    u.fromVersion, u.toVersion, u.upgradedAt,
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
