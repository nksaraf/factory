import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { ProjectContext } from "../lib/project.js";
import { DevController } from "../lib/dev-controller.js";
import {
  PortManager,
  catalogToPortRequests,
  portEnvVars,
  printPortTable,
} from "../lib/port-manager.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("dev", [
  "$ dx dev                           Start all component dev servers",
  "$ dx dev factory-api               Start specific components",
  "$ dx dev stop                      Stop all dev servers",
  "$ dx dev ps                        Show running dev servers",
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
        description: "Component names to start (all if omitted)",
      },
    ])
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);

      try {
        const project = ProjectContext.fromCwd();
        const ctrl = new DevController(
          project.rootDir,
          project.catalog,
          project.composeFiles,
        );

        // Resolve all ports (for both dev servers and infra) and write ports.env
        const portManager = new PortManager(join(project.rootDir, ".dx"));
        const portRequests = catalogToPortRequests(project.catalog);
        const resolved = await portManager.resolveMulti(portRequests);

        const allEnvVars: Record<string, string> = {};
        for (const [service, ports] of Object.entries(resolved)) {
          Object.assign(allEnvVars, portEnvVars(service, ports));
        }
        const envPath = join(project.rootDir, ".dx", "ports.env");
        portManager.writeEnvFile(allEnvVars, envPath);

        // Only start components that declare a dev command or have a detectable runtime
        const devableComponents = Object.entries(project.catalog.components)
          .filter(([_, comp]) => comp.spec.dev?.command != null)
          .map(([name]) => name);

        const targets = args.components?.length ? args.components : devableComponents;

        if (targets.length === 0) {
          console.log("No dev-able components found. Add dx.dev.command labels to your docker-compose services.");
          return;
        }

        for (const component of targets) {
          try {
            const result = await ctrl.start(component);

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
            console.error(`Error starting ${component}: ${msg}`);
          }
        }

        // Print clickable port table
        if (!f.quiet) {
          printPortTable(resolved, f.verbose as boolean);
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
