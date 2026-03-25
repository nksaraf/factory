import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { readConfig, resolveFactoryUrl, resolveSiteUrl } from "../config.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  apiCall,
  tableOrJson,
  detailView,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFleetApi(): Promise<any> {
  return getFactoryClient();
}

export function siteCommand(app: DxBase) {
  return app
    .sub("site")
    .meta({ description: "Site management" })

    .command("list", (c) =>
      c
        .meta({ description: "List sites" })
        .flags({
          product: { type: "string", alias: "p", description: "Filter by product" },
          status: { type: "string", alias: "s", description: "Filter by status" },
          sort: { type: "string", description: "Sort by: name, product, status (default: name)" },
          limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
        })
        .run(async ({ flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.sites.get({
              query: {
                product: flags.product as string | undefined,
                status: flags.status as string | undefined,
              },
            })
          );
          tableOrJson(
            flags,
            result,
            ["ID", "Name", "Product", "Cluster", "Status", "Last Check-in"],
            (r) => [
              styleMuted(String(r.siteId ?? "")),
              styleBold(String(r.name ?? "")),
              String(r.product ?? ""),
              String(r.clusterId ?? "-"),
              colorStatus(String(r.status ?? "")),
              timeAgo(r.lastCheckinAt as string),
            ],
            undefined,
            { emptyMessage: "No sites found." },
          );
        })
    )

    .command("show", (c) =>
      c
        .meta({ description: "Show site details" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Site name",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.sites({ name: args.name }).get()
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.siteId ?? ""))],
            ["Name", (r) => styleBold(String(r.name ?? ""))],
            ["Product", (r) => String(r.product ?? "")],
            ["Cluster", (r) => String(r.clusterId ?? "")],
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["Release", (r) => String(r.assignedRelease ?? "")],
            ["Last Check-in", (r) => timeAgo(r.lastCheckinAt as string)],
            ["Created", (r) => timeAgo(r.createdAt as string)],
          ]);
        })
    )

    .command("create", (c) =>
      c
        .meta({ description: "Create a site" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Site name",
          },
        ])
        .flags({
          product: {
            type: "string",
            required: true,
            description: "Product identifier",
          },
          cluster: {
            type: "string",
            description: "Cluster ID",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.sites.post({
              name: args.name,
              product: flags.product as string,
              clusterId: flags.cluster as string | undefined,
            })
          );
          actionResult(flags, result, styleSuccess(`Site "${args.name}" created.`));
        })
    )

    .command("delete", (c) =>
      c
        .meta({ description: "Decommission a site" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Site name",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.sites.delete({
              query: { name: args.name },
            })
          );
          actionResult(flags, result, styleSuccess(`Site "${args.name}" deleted.`));
        })
    )

    .command("assign-release", (c) =>
      c
        .meta({ description: "Assign a release to a site" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Site name",
          },
          {
            name: "release-version",
            type: "string",
            required: true,
            description: "Release version",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet
              .sites({ name: args.name })
              ["assign-release"].post({
                releaseVersion: args["release-version"],
              })
          );
          actionResult(flags, result, styleSuccess(`Release ${args["release-version"]} assigned to site "${args.name}".`));
        })
    )

    .command("checkin", (c) =>
      c
        .meta({ description: "Perform site check-in" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Site name",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet
              .sites({ name: args.name })
              .checkin.post({
                healthSnapshot: {
                  status: "healthy",
                  timestamp: new Date().toISOString(),
                },
                lastAppliedManifestVersion: 0,
              })
          );
          actionResult(flags, result, styleSuccess(`Site "${args.name}" checked in.`));
        })
    )

    // ---- Site-agent commands (site mode) ----

    .command("status", (c) =>
      c
        .meta({ description: "Show site agent status" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/status`);
          if (!res.ok) exitWithError(f, `Site API error: ${res.status}`);
          const data = await res.json();
          detailView(flags, data.data, [
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["Site", (r) => String(r.siteName ?? r.siteId ?? "")],
            ["Version", (r) => String(r.version ?? "")],
            ["Uptime", (r) => String(r.uptime ?? "")],
          ]);
        })
    )

    .command("reconcile", (c) =>
      c
        .meta({ description: "Force re-reconcile current manifest" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/reconcile`, { method: "POST" });
          if (!res.ok) exitWithError(f, `Site API error: ${res.status}`);
          const data = await res.json();
          actionResult(flags, data.data ?? data.error, styleSuccess("Reconciliation triggered."));
        })
    )

    .command("push-manifest", (c) =>
      c
        .meta({ description: "Push a manifest to the site agent (air-gapped)" })
        .args([
          {
            name: "file",
            type: "string",
            required: true,
            description: "Path to manifest JSON file",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const fs = await import("node:fs");
          const content = fs.readFileSync(args.file, "utf-8");
          const manifest = JSON.parse(content);
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/manifest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(manifest),
          });
          if (!res.ok) exitWithError(f, `Site API error: ${res.status}`);
          const data = await res.json();
          actionResult(flags, data.data, styleSuccess(`Manifest pushed from ${args.file}.`));
        })
    )

    .command("crds", (c) =>
      c
        .meta({ description: "List currently applied CRDs" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/crds`);
          if (!res.ok) exitWithError(f, `Site API error: ${res.status}`);
          const data = await res.json();
          tableOrJson(flags, data, ["Name", "Group", "Version", "Kind"], (r) => [
            styleBold(String(r.name ?? "")),
            String(r.group ?? ""),
            String(r.version ?? ""),
            String(r.kind ?? ""),
          ], undefined, { emptyMessage: "No CRDs applied." });
        })
    );
}

async function getSiteApiUrl(): Promise<string> {
  const config = await readConfig();
  const siteUrl = resolveSiteUrl(config);
  return siteUrl || resolveFactoryUrl(config);
}
