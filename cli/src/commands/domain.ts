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
  styleWarn,
} from "./list-helpers.js";

async function getGatewayApi() {
  return getFactoryClient();
}

export function domainCommand(app: DxBase) {
  return app
    .sub("domain")
    .meta({ description: "Custom domain management" })

    // dx domain add <fqdn> --site <name>
    .command("add", (c) =>
      c
        .meta({ description: "Register a custom domain" })
        .args([
          {
            name: "fqdn",
            type: "string",
            description: "Fully qualified domain name (e.g. app.acme.com)",
          },
        ])
        .flags({
          site: {
            type: "string",
            description: "Site to associate with the domain",
          },
          kind: {
            type: "string",
            description: "Domain kind (primary, alias, custom, wildcard)",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const fqdn = args.fqdn;
          if (!fqdn) {
            exitWithError(f, "Usage: dx domain add <fqdn> [--site <name>]");
          }

          const api = await getGatewayApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains.post({
              fqdn,
              siteId: flags.site as string | undefined,
              kind: (flags.kind as string) ?? "custom",
            })
          ) as Record<string, unknown> | undefined;

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          } else {
            console.log(styleSuccess(`Domain registered: ${fqdn}`));
            console.log(`\nTo verify ownership, add these DNS records:`);
            console.log(`  CNAME ${fqdn} → ${result?.siteId ?? "factory"}.sites.dx.dev`);
            console.log(`  TXT   _dx-verify.${fqdn} = ${result?.verificationToken}`);
            console.log(`\nThen run: dx domain verify ${fqdn}`);
          }
        })
    )

    // dx domain verify <fqdn>
    .command("verify", (c) =>
      c
        .meta({ description: "Verify domain DNS ownership" })
        .args([
          {
            name: "fqdn",
            type: "string",
            description: "Domain to verify",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const fqdn = args.fqdn;
          if (!fqdn) {
            exitWithError(f, "Usage: dx domain verify <fqdn>");
          }

          // First look up the domain by fqdn to get its ID
          const api = await getGatewayApi();
          const listRes = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains.get({ query: {} })
          ) as Record<string, unknown> | undefined;

          const domains = (listRes?.data ?? []) as Record<string, unknown>[];
          const dom = domains.find((d) => d.fqdn === fqdn);
          if (!dom) {
            exitWithError(f, `Domain ${fqdn} not found. Register it first with: dx domain add ${fqdn}`);
          }

          const result = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains({ id: dom.domainId as string }).verify.post()
          ) as Record<string, unknown> | undefined;

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: result }, null, 2));
          } else if (result?.verified) {
            console.log(styleSuccess(`Domain ${fqdn} verified successfully!`));
            if (result.route) {
              console.log(`Route created: https://${fqdn}`);
            }
          } else {
            console.log(`Verification failed for ${fqdn}`);
            if (result?.error) {
              console.log(`Reason: ${result.error}`);
            }
          }
        })
    )

    // dx domain list [--site <name>]
    .command("list", (c) =>
      c
        .meta({ description: "List domains" })
        .flags({
          site: { type: "string", description: "Filter by site" },
          sort: { type: "string", description: "Sort by: fqdn, kind, status (default: fqdn)" },
          limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const api = await getGatewayApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains.get({
              query: {
                siteId: flags.site as string | undefined,
              },
            })
          ) as Record<string, unknown> | undefined;

          const domains = (result?.data ?? []) as Record<string, unknown>[];
          if (f.json) {
            console.log(JSON.stringify({ success: true, data: domains }, null, 2));
            return;
          }
          if (domains.length === 0) {
            console.log("No domains registered.");
            return;
          }
          const rows = domains.map((d) => [
            styleBold(String(d.fqdn)),
            String(d.kind ?? ""),
            d.siteId ? String(d.siteId) : styleMuted("-"),
            d.dnsVerified ? styleSuccess("verified") : styleWarn("pending"),
            colorStatus(String(d.status ?? "")),
          ]);
          console.log(
            printTable(["FQDN", "Kind", "Site", "DNS", "Status"], rows)
          );
        })
    )

    // dx domain remove <fqdn>
    .command("remove", (c) =>
      c
        .meta({ description: "Remove a custom domain" })
        .args([
          {
            name: "fqdn",
            type: "string",
            description: "Domain to remove",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const fqdn = args.fqdn;
          if (!fqdn) {
            exitWithError(f, "Usage: dx domain remove <fqdn>");
          }

          const api = await getGatewayApi();
          // Look up domain by fqdn
          const listRes = await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains.get({ query: {} })
          ) as Record<string, unknown> | undefined;

          const domains = (listRes?.data ?? []) as Record<string, unknown>[];
          const dom = domains.find((d) => d.fqdn === fqdn);
          if (!dom) {
            exitWithError(f, `Domain ${fqdn} not found.`);
          }

          await apiCall(flags, () =>
            api.api.v1.factory.infra.gateway.domains({ id: dom.domainId as string }).delete()
          );

          actionResult(flags, { removed: true, fqdn }, styleSuccess(`Domain ${fqdn} removed.`));
        })
    );
}
