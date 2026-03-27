import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
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

setExamples("route", [
  "$ dx route list                    List all routes",
  "$ dx route create --domain api.example.com --target my-svc --port 8080",
  "$ dx route delete <id>             Remove a route",
]);

async function getGatewayApi() {
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
          status: { type: "string", alias: "s", description: "Filter by status" },
          sort: { type: "string", description: "Sort by: domain, kind, status (default: domain)" },
          limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const api = await getGatewayApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.routes.get({
              query: {
                kind: flags.kind as string | undefined,
                siteId: flags.site as string | undefined,
                status: flags.status as string | undefined,
              },
            })
          ) as Record<string, unknown> | undefined;

          const routes = (result?.data ?? []) as Record<string, unknown>[];
          if (f.json) {
            console.log(JSON.stringify({ success: true, data: routes }, null, 2));
            return;
          }
          if (routes.length === 0) {
            console.log("No routes found.");
            return;
          }
          const rows = routes.map((r) => [
            styleMuted(String(r.routeId)),
            String(r.kind ?? ""),
            styleBold(String(r.domain)),
            String(r.targetService ?? ""),
            String(r.targetPort ?? "-"),
            colorStatus(String(r.status ?? "")),
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
            api.api.v1.factory.infra.gateway.routes.post({
              kind: (flags.kind as string) ?? "ingress",
              domain: flags.domain as string,
              targetService: flags.target as string,
              targetPort: flags.port as number | undefined,
              siteId: flags.site as string | undefined,
              pathPrefix: flags.path as string | undefined,
              protocol: flags.protocol as string | undefined,
            })
          ) as Record<string, unknown> | undefined;

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          } else {
            console.log(styleSuccess(`Route created: ${result?.routeId}`));
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
            api.api.v1.factory.infra.gateway.routes({ id }).delete()
          );

          actionResult(flags, { deleted: true, routeId: id }, styleSuccess(`Route ${id} deleted.`));
        })
    );
}
