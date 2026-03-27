import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

import { resolveEnvVars } from "@smp/factory-shared/env-resolution";
import { ExitCodes } from "@smp/factory-shared/exit-codes";
import { loadTierOverlay } from "@smp/factory-shared/tier-overlay-loader";
import { loadNormalizedProfile } from "@smp/factory-shared/connection-profile-loader";
import { checkConnectionPolicy } from "@smp/factory-shared/conventions";

import type { DxBase } from "../dx-root.js";
import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { composeUp, isDockerRunning } from "../lib/docker.js";
import { ProjectContext } from "../lib/project.js";
import {
  parseConnectToFlag,
  parseConnectFlags,
  parseEnvFlags,
  mergeConnectionSources,
} from "../lib/parse-connect-flags.js";
import { TunnelManager } from "../lib/tunnel-manager.js";
import {
  writeConnectionContext,
  cleanupConnectionContext,
} from "../lib/connection-context-file.js";
import { DevController } from "../lib/dev-controller.js";
import { PortManager } from "../lib/port-manager.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("dev", [
  "$ dx dev                           Start local development",
  "$ dx dev --connect-to staging      Connect to staging",
  "$ dx dev stop                      Stop local development",
  "$ dx dev ps                        Show running services",
]);

export function devCommand(app: DxBase) {
  return app
    .sub("dev")
    .meta({ description: "Local development" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description: "Optional component names to include",
      },
    ])
    .flags({
      "connect-to": {
        type: "string",
        description: "Connect all deps to a deployment target",
      },
      connect: {
        type: "string",
        short: "c",
        description: "Selective connection: dep:target (repeatable)",
      },
      profile: {
        type: "string",
        short: "p",
        description: "Connection profile name",
      },
      env: {
        type: "string",
        short: "e",
        description: "Env var override: KEY=VALUE (repeatable)",
      },
      readonly: {
        type: "boolean",
        description: "Force read-only connections (required for production)",
      },
      remote: {
        type: "boolean",
        description: "Remote dev mode (not yet implemented)",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);

      // Remote mode stub
      if (flags.remote) {
        exitWithError(
          f,
          "Remote dev mode (--remote) is not yet implemented. Run code locally with --connect-to instead.",
          ExitCodes.GENERAL_FAILURE
        );
      }

      try {
        if (!isDockerRunning()) {
          exitWithError(
            f,
            "Docker does not appear to be running.",
            ExitCodes.CONNECTION_FAILURE
          );
        }

        const project = ProjectContext.fromCwd();

        // Determine if we're doing hybrid dev (any connection flags present)
        const hasConnectionFlags =
          flags["connect-to"] || flags.connect || flags.profile;

        let connectionContext;
        let tunnelManager: TunnelManager | undefined;

        if (hasConnectionFlags) {
          // Build connection overrides from flags
          const profileOverrides = flags.profile
            ? loadNormalizedProfile(
                project.rootDir,
                flags.profile as string
              ) ?? undefined
            : undefined;

          const connectToOverrides = flags["connect-to"]
            ? parseConnectToFlag(
                flags["connect-to"] as string,
                project.catalog
              )
            : undefined;

          const connectFlags = flags.connect
            ? parseConnectFlags(
                Array.isArray(flags.connect)
                  ? flags.connect
                  : [flags.connect as string]
              )
            : undefined;

          const overrides = mergeConnectionSources(
            profileOverrides,
            connectToOverrides,
            connectFlags
          );

          // Apply --readonly flag to all overrides
          if (flags.readonly) {
            for (const key of Object.keys(overrides)) {
              overrides[key].readonly = true;
            }
          }

          // Check connection policies for each unique target kind
          const targets = new Set(
            Object.values(overrides).map((o) => o.target)
          );
          for (const target of targets) {
            // Infer kind from target name heuristics
            const kind = inferTargetKind(target);
            const policy = checkConnectionPolicy(
              kind,
              flags.readonly as boolean ?? false,
              project.conventions
            );
            if (!policy.allowed) {
              exitWithError(
                f,
                `Connection policy violation: ${policy.violations.join("; ")}`,
                ExitCodes.GENERAL_FAILURE
              );
            }
            if (
              policy.requireReason &&
              (kind === "production" || kind === "prod")
            ) {
              if (!f.json) {
                console.log(
                  "⚠  PRODUCTION CONNECTION — provide a reason with --env REASON=..."
                );
              }
            }
          }

          // Parse --env flags
          const envFlags = flags.env
            ? parseEnvFlags(
                Array.isArray(flags.env)
                  ? flags.env
                  : [flags.env as string]
              )
            : undefined;

          // Determine tier for overlay
          const tier =
            (flags["connect-to"] as string | undefined) ??
            (profileOverrides
              ? Object.values(profileOverrides)[0]?.target
              : undefined);
          const tierOverlay = tier
            ? loadTierOverlay(project.rootDir, tier) ?? undefined
            : undefined;

          // Resolve env vars
          connectionContext = resolveEnvVars({
            catalog: project.catalog,
            tierOverlay,
            connectionOverrides: overrides,
            cliEnvFlags: envFlags,
          });

          // Start tunnel backends
          tunnelManager = new TunnelManager(project.rootDir);
          await tunnelManager.startAll(connectionContext.tunnels);

          // Write context file
          writeConnectionContext(project.rootDir, connectionContext);

          if (f.verbose) {
            const status = tunnelManager.getStatus();
            if (status.length > 0) {
              console.log("Connection tunnels:");
              for (const t of status) {
                console.log(
                  `  ${t.name.padEnd(12)} ${t.backend.padEnd(8)} ${t.status}`
                );
              }
            }
            console.log(
              `Remote deps: ${connectionContext.remoteDeps.join(", ") || "none"}`
            );
            console.log(
              `Local deps: ${connectionContext.localDeps.join(", ") || "none"}`
            );
          }
        }

        // Record audit event for staging/production connections
        let auditEventId: string | undefined;
        if (hasConnectionFlags && connectionContext) {
          const connectToTarget = flags["connect-to"] as string | undefined;
          const primaryTarget = connectToTarget ?? connectionContext.tunnels[0]?.name;
          const targetKind = primaryTarget ? inferTargetKind(primaryTarget) : undefined;
          const hasAuditableTarget = targetKind === "production" || targetKind === "staging";

          if (hasAuditableTarget && primaryTarget) {
            try {
              const client = await getFactoryClient();
              const res = await client.api.v1.factory.fleet["connection-audit"].post({
                principalId: "cli-user",
                deploymentTargetId: primaryTarget,
                connectedResources: {
                  remoteDeps: connectionContext.remoteDeps,
                  tunnels: connectionContext.tunnels.map((t) => ({
                    name: t.name,
                    backend: t.backend,
                  })),
                },
                readonly: flags.readonly as boolean ?? false,
              });
              if (res.data && typeof res.data === "object" && "id" in res.data) {
                auditEventId = (res.data as { id: string }).id;
              }
              if (f.verbose) {
                console.log(`Audit event recorded: ${auditEventId ?? "unknown"}`);
              }
            } catch {
              // Non-fatal: audit recording failure should not block dev workflow
              if (f.verbose) {
                console.log("Warning: Could not record connection audit event");
              }
            }
          }
        }

        // Use the real compose files directly — no generation needed
        const composePath = project.composeFiles[0];
        if (!composePath) {
          exitWithError(f, "No docker-compose file found");
        }
        composeUp(composePath, {
          build: true,
          detach: true,
          projectName: basename(project.rootDir),
        });
        if (!f.json) {
          console.log(`Started stack from ${composePath}`);
        }

        // Set up cleanup handler for connection mode
        if (tunnelManager) {
          process.on("SIGINT", async () => {
            if (f.verbose) console.log("\nCleaning up connections...");

            // End audit event
            if (auditEventId) {
              try {
                const client = await getFactoryClient();
                await client.api.v1.factory.fleet["connection-audit"]({ id: auditEventId }).patch({});
              } catch {
                // Non-fatal
              }
            }

            await tunnelManager!.stopAll();
            cleanupConnectionContext(project.rootDir);
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    })
    .command("start", (c) =>
      c
        .meta({ description: "Start a native dev server for a component" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name to start",
          },
        ])
        .flags({
          port: {
            type: "number" as const,
            description: "Override the port",
          },
        })
        .run(async ({ args, flags }) => {
          try {
            const project = ProjectContext.fromCwd();
            const ctrl = new DevController(
              project.rootDir,
              project.catalog,
              project.composeFiles,
            );

            const component = args.component;
            if (!component) {
              console.error("Usage: dx dev start <component>");
              process.exit(1);
            }

            const result = await ctrl.start(component, {
              port: flags.port as number | undefined,
            });

            if (result.alreadyRunning) {
              console.log(
                `${result.name} already running on :${result.port} (PID ${result.pid})`,
              );
            } else {
              if (result.stoppedDocker) {
                console.log(`Stopped Docker container for ${result.name}`);
              }
              console.log(
                `Started ${result.name} on :${result.port} (PID ${result.pid})`,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        }),
    )
    .command("stop", (c) =>
      c
        .meta({ description: "Stop native dev server(s)" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name (stops all if omitted)",
          },
        ])
        .run(({ args }) => {
          try {
            const project = ProjectContext.fromCwd();
            const ctrl = new DevController(
              project.rootDir,
              project.catalog,
              project.composeFiles,
            );

            const stopped = ctrl.stop(args.component || undefined);
            if (stopped.length === 0) {
              console.log("No dev servers running.");
            } else {
              for (const s of stopped) {
                console.log(`Stopped ${s.name} (PID ${s.pid})`);
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        }),
    )
    .command("restart", (c) =>
      c
        .meta({ description: "Restart a native dev server" })
        .args([
          {
            name: "component",
            type: "string" as const,
            required: true,
            description: "Component name to restart",
          },
        ])
        .run(async ({ args }) => {
          try {
            const project = ProjectContext.fromCwd();
            const ctrl = new DevController(
              project.rootDir,
              project.catalog,
              project.composeFiles,
            );

            const result = await ctrl.restart(args.component);
            console.log(
              `Restarted ${result.name} on :${result.port} (PID ${result.pid})`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        }),
    )
    .command("ps", (c) =>
      c.meta({ description: "List running dev servers" }).run(() => {
        try {
          const project = ProjectContext.fromCwd();
          const ctrl = new DevController(
            project.rootDir,
            project.catalog,
            project.composeFiles,
          );

          const servers = ctrl.ps();
          if (servers.length === 0) {
            console.log("No dev servers tracked.");
            return;
          }
          for (const s of servers) {
            const status = s.running ? "running" : "stopped";
            console.log(
              `  ${s.name.padEnd(20)} :${String(s.port ?? "?").padEnd(6)} PID ${String(s.pid ?? "-").padEnd(8)} ${status}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
          process.exit(1);
        }
      }),
    )
    .command("logs", (c) =>
      c
        .meta({ description: "Show dev server logs" })
        .args([
          {
            name: "component",
            type: "string" as const,
            required: true,
            description: "Component name",
          },
        ])
        .flags({
          follow: {
            type: "boolean" as const,
            short: "f",
            description: "Follow the log output",
          },
        })
        .run(({ args, flags }) => {
          try {
            const project = ProjectContext.fromCwd();
            const ctrl = new DevController(
              project.rootDir,
              project.catalog,
              project.composeFiles,
            );

            const logPath = ctrl.logs(args.component);
            if (flags.follow) {
              spawnSync("tail", ["-f", logPath], { stdio: "inherit" });
            } else {
              console.log(logPath);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        }),
    );
}

/** Heuristic: infer deployment target kind from its name. */
function inferTargetKind(target: string): string {
  const t = target.toLowerCase();
  if (t.includes("prod")) return "production";
  if (t.includes("staging") || t === "staging") return "staging";
  if (t.includes("sandbox") || t.startsWith("sandbox-")) return "sandbox";
  if (t.includes("dev-") || t.startsWith("dev-")) return "dev";
  return "staging"; // default assumption
}
