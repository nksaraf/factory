import { resolveEnvVars, formatResolvedEnv } from "@smp/factory-shared/env-resolution";
import { loadTierOverlay } from "@smp/factory-shared/tier-overlay-loader";

import type { DxBase } from "../dx-root.js";
import { ProjectContext } from "../lib/project.js";
import {
  writeConnectionContext,
  cleanupConnectionContext,
  writeEnvFile,
} from "../lib/connection-context-file.js";
import { parseConnectToFlag, parseConnectFlags, mergeConnectionSources } from "../lib/parse-connect-flags.js";
import { TunnelManager } from "../lib/tunnel-manager.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("connect", [
  "$ dx connect staging               Connect to staging",
  "$ dx connect status                Show connection status",
  "$ dx connect stop                  Disconnect",
]);

export function connectCommand(app: DxBase) {
  return app
    .sub("connect")
    .meta({ description: "Manage connection tunnels to remote targets" })
    .args([
      {
        name: "target",
        type: "string",
        description: "Deployment target to connect to",
      },
    ])
    .flags({
      connect: {
        type: "string",
        short: "c",
        description: "Selective connection: dep:target (repeatable)",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const target = args.target;

      if (!target) {
        console.error("Usage: dx connect <target>");
        process.exit(1);
      }

      try {
        const project = ProjectContext.fromCwd();
        const connectToOverrides = parseConnectToFlag(target, project.moduleConfig);

        // Parse selective --connect flags if present
        const selectiveFlags = flags.connect
          ? parseConnectFlags(
              Array.isArray(flags.connect) ? flags.connect : [flags.connect]
            )
          : undefined;

        const overrides = mergeConnectionSources(
          undefined,
          connectToOverrides,
          selectiveFlags
        );

        const tierOverlay = loadTierOverlay(project.rootDir, target);

        const ctx = resolveEnvVars({
          dxConfig: project.moduleConfig,
          tierOverlay: tierOverlay ?? undefined,
          connectionOverrides: overrides,
        });

        // Start tunnel backends
        const mgr = new TunnelManager(project.rootDir);
        await mgr.startAll(ctx.tunnels);

        // Write context and env files
        writeConnectionContext(project.rootDir, ctx);
        writeEnvFile(project.rootDir, target, ctx.envVars);

        // Print tunnel status
        const status = mgr.getStatus();
        if (status.length > 0) {
          console.log("Tunnels active:");
          for (const t of status) {
            const cs = t.connectionString ? ` (${t.connectionString})` : "";
            console.log(
              `  ${t.name.padEnd(12)} localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}  [${t.backend}]${cs}`
            );
          }
        }

        console.log(`\nEnv file written to .dx/.env.${target}`);
        console.log(`Source it: eval $(cat .dx/.env.${target})`);
        console.log("\nPress Ctrl+C to stop.");

        // Block until SIGINT
        await new Promise<void>((resolve) => {
          process.on("SIGINT", async () => {
            console.log("\nStopping tunnels...");
            await mgr.stopAll();
            cleanupConnectionContext(project.rootDir);
            resolve();
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    })
    .command("status", (c) =>
      c
        .meta({ description: "Show active tunnel status" })
        .run(() => {
          try {
            const project = ProjectContext.fromCwd();
            const mgr = new TunnelManager(project.rootDir);
            const status = mgr.getStatus();
            if (status.length === 0) {
              console.log("No active tunnels.");
              return;
            }
            console.log("Active tunnels:");
            for (const t of status) {
              console.log(
                `  ${t.name.padEnd(12)} localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}  [${t.backend}]  ${t.status}`
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        })
    )
    .command("stop", (c) =>
      c
        .meta({ description: "Stop all active tunnels" })
        .run(async () => {
          try {
            const project = ProjectContext.fromCwd();
            const mgr = new TunnelManager(project.rootDir);
            await mgr.stopAll();
            cleanupConnectionContext(project.rootDir);
            console.log("All tunnels stopped.");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
          }
        })
    );
}
