import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
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

async function apiCall(
  flags: Record<string, unknown>,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<unknown> {
  const f = toDxFlags(flags);
  try {
    const res = await fn();
    if (res.error) {
      exitWithError(f, `API error: ${JSON.stringify(res.error)}`);
    }
    return res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithError(f, msg);
  }
}

async function getGatewayApi(): Promise<any> {
  return getFactoryClient();
}

export function routeCommand(app: DxBase) {
  return app
    .sub("route")
    .meta({ description: "Gateway route management" })

    // dx route list [--kind sandbox] [--site my-site]
    .command("list", (c) =>
      c
        .meta({ description: "List routes" })
        .flags({
          kind: { type: "string", description: "Filter by kind (sandbox, tunnel, preview, ingress, custom_domain)" },
          site: { type: "string", description: "Filter by site ID" },
          status: { type: "string", description: "Filter by status" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const api = await getGatewayApi();
          const result = await apiCall(flags, () =>
            api.api.v1.gateway.routes.get({
              query: {
                kind: flags.kind as string | undefined,
                siteId: flags.site as string | undefined,
                status: flags.status as string | undefined,
              },
            })
          ) as any;

          const routes = result?.data ?? [];
          if (f.json) {
            jsonOut(flags, routes);
            return;
          }
          if (routes.length === 0) {
            console.log("No routes found.");
            return;
          }
          const rows = routes.map((r: any) => [
            r.routeId,
            r.kind,
            r.domain,
            r.targetService,
            String(r.targetPort ?? "-"),
            r.status,
          ]);
          console.log(
            printTable(["ID", "Kind", "Domain", "Target", "Port", "Status"], rows)
          );
        })
    )

    // dx route create --domain app.example.com --target my-svc --port 8080
    .command("create", (c) =>
      c
        .meta({ description: "Create a route" })
        .flags({
          domain: { type: "string", description: "Route domain", required: true },
          target: { type: "string", description: "Target service name", required: true },
          port: { type: "number", description: "Target port" },
          kind: { type: "string", description: "Route kind (ingress, sandbox, etc.)" },
          site: { type: "string", description: "Site ID" },
          path: { type: "string", description: "Path prefix" },
          protocol: { type: "string", description: "Protocol (http, grpc, tcp)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          if (!flags.domain || !flags.target) {
            exitWithError(f, "Usage: dx route create --domain <domain> --target <service> [--port <port>]");
          }

          const api = await getGatewayApi();
          const result = await apiCall(flags, () =>
            api.api.v1.gateway.routes.post({
              kind: (flags.kind as string) ?? "ingress",
              domain: flags.domain as string,
              targetService: flags.target as string,
              targetPort: flags.port as number | undefined,
              siteId: flags.site as string | undefined,
              pathPrefix: flags.path as string | undefined,
              protocol: flags.protocol as string | undefined,
            })
          ) as any;

          if (f.json) {
            jsonOut(flags, result);
          } else {
            console.log(`Route created: ${result?.routeId}`);
            console.log(`  Domain: ${result?.domain}`);
            console.log(`  Target: ${result?.targetService}:${result?.targetPort ?? 80}`);
          }
        })
    )

    // dx route delete <routeId>
    .command("delete", (c) =>
      c
        .meta({ description: "Delete a route" })
        .args([
          {
            name: "id",
            type: "string",
            description: "Route ID to delete",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const id = args.id;
          if (!id) {
            exitWithError(f, "Usage: dx route delete <routeId>");
          }

          const api = await getGatewayApi();
          await apiCall(flags, () =>
            api.api.v1.gateway.routes[id].delete()
          );

          if (f.json) {
            jsonOut(flags, { deleted: true, routeId: id });
          } else {
            console.log(`Route ${id} deleted.`);
          }
        })
    );
}
