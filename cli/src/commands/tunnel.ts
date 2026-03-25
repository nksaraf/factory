import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { openTunnel } from "../lib/tunnel-client.js";
import { printTable } from "../output.js";
import { toDxFlags } from "./dx-flags.js";

function jsonOut(flags: Record<string, unknown>, data: unknown) {
  const f = toDxFlags(flags);
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

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

      const handle = openTunnel(
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
          try {
            const api = await getFactoryClient();
            const res = await (api as any).api.v1.gateway.tunnels.get();
            if (res.error) {
              exitWithError(f, `API error: ${JSON.stringify(res.error)}`);
            }
            const tunnels = res.data?.data ?? [];
            if (f.json) {
              jsonOut(flags, tunnels);
              return;
            }
            if (tunnels.length === 0) {
              console.log("No active tunnels.");
              return;
            }
            const rows = tunnels.map((t: any) => [
              t.tunnelId,
              t.subdomain,
              t.localAddr,
              t.status,
            ]);
            console.log(printTable(["ID", "Subdomain", "Local", "Status"], rows));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
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
          try {
            const api = await getFactoryClient();
            const res = await (api as any).api.v1.gateway.tunnels[id].delete();
            if (res.error) {
              exitWithError(f, `API error: ${JSON.stringify(res.error)}`);
            }
            if (f.json) {
              jsonOut(flags, { closed: true, tunnelId: id });
            } else {
              console.log(`Tunnel ${id} closed.`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    );
}
