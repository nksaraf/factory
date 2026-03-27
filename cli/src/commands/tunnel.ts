import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { openTunnel } from "../lib/tunnel-client.js";
import { printTable } from "../output.js";
import { toDxFlags } from "./dx-flags.js";
import {
  apiCall,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("tunnel", [
  "$ dx tunnel --port 3000            Expose port 3000",
  "$ dx tunnel list                   List active tunnels",
  "$ dx tunnel close                  Close all tunnels",
]);

export function tunnelCommand(app: DxBase) {
  return app
    .sub("tunnel")
    .meta({ description: "Expose local ports via tunnel" })

    // dx tunnel <port> — open a tunnel
    .args([
      {
        name: "port",
        type: "number",
        description: "Local port to expose",
      },
    ])
    .flags({
      subdomain: {
        type: "string",
        short: "s",
        description: "Request a specific subdomain",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const port = args.port;

      if (!port) {
        exitWithError(f, "Usage: dx tunnel <port>");
      }

      console.log(`Opening tunnel for localhost:${port}...`);

      const handle = await openTunnel(
        {
          port,
          subdomain: flags.subdomain as string | undefined,
        },
        {
          onRegistered(info) {
            if (f.json) {
              console.log(JSON.stringify({ success: true, data: info }, null, 2));
            } else {
              console.log(`\nTunnel active!`);
              console.log(`  URL:       ${info.url}`);
              console.log(`  Subdomain: ${info.subdomain}`);
              console.log(`  Tunnel ID: ${info.tunnelId}`);
              console.log(`  Forwarding to localhost:${port}`);
              console.log(`\nPress Ctrl+C to close the tunnel.`);
            }
          },
          onError(err) {
            console.error(`Tunnel error: ${err.message}`);
          },
          onClose() {
            console.log("Tunnel closed.");
            process.exit(0);
          },
        }
      );

      // Keep process alive, close tunnel on SIGINT
      process.on("SIGINT", () => {
        handle.close();
      });
      process.on("SIGTERM", () => {
        handle.close();
      });

      // Block forever (tunnel runs until interrupt)
      await new Promise(() => {});
    })

    // dx tunnel list — list active tunnels
    .command("list", (c) =>
      c
        .meta({ description: "List active tunnels" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const api = await getFactoryClient();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.tunnels.get()
          ) as Record<string, unknown> | undefined;
          const tunnels = ((result?.data ?? []) as Record<string, unknown>[]);
          if (f.json) {
            console.log(JSON.stringify({ success: true, data: tunnels }, null, 2));
            return;
          }
          if (tunnels.length === 0) {
            console.log("No active tunnels.");
            return;
          }
          const rows = tunnels.map((t) => [
            styleMuted(String(t.tunnelId)),
            styleBold(String(t.subdomain)),
            String(t.localAddr),
            colorStatus(String(t.status)),
          ]);
          console.log(printTable(["ID", "Subdomain", "Local", "Status"], rows));
        })
    )

    // dx tunnel close <id> — force-close a tunnel
    .command("close", (c) =>
      c
        .meta({ description: "Force-close a tunnel" })
        .args([
          {
            name: "id",
            type: "string",
            description: "Tunnel ID to close",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const id = args.id;
          if (!id) {
            exitWithError(f, "Usage: dx tunnel close <tunnelId>");
          }
          const api = await getFactoryClient();
          await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.tunnels({ id }).delete()
          );
          actionResult(flags, { closed: true, tunnelId: id }, styleSuccess(`Tunnel ${id} closed.`));
        })
    );
}
