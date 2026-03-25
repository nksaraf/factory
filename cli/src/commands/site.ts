import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { readConfig, resolveFactoryUrl, resolveSiteUrl } from "../config.js";
import { exitWithError } from "../lib/cli-exit.js";
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
          product: { type: "string", description: "Filter by product" },
          status: { type: "string", description: "Filter by status" },
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
          jsonOut(flags, result);
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
          jsonOut(flags, result);
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
          jsonOut(flags, result);
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
          jsonOut(flags, result);
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
          jsonOut(flags, result);
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
          jsonOut(flags, result);
        })
    )

    // ---- Site-agent commands (site mode) ----

    .command("status", (c) =>
      c
        .meta({ description: "Show site agent status" })
        .run(async ({ flags }) => {
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/status`);
          if (!res.ok) exitWithError(toDxFlags(flags), `Site API error: ${res.status}`);
          const data = await res.json();
          jsonOut(flags, data.data);
        })
    )

    .command("reconcile", (c) =>
      c
        .meta({ description: "Force re-reconcile current manifest" })
        .run(async ({ flags }) => {
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/reconcile`, { method: "POST" });
          if (!res.ok) exitWithError(toDxFlags(flags), `Site API error: ${res.status}`);
          const data = await res.json();
          jsonOut(flags, data.data ?? data.error);
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
          const fs = await import("node:fs");
          const content = fs.readFileSync(args.file, "utf-8");
          const manifest = JSON.parse(content);
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/manifest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(manifest),
          });
          if (!res.ok) exitWithError(toDxFlags(flags), `Site API error: ${res.status}`);
          const data = await res.json();
          jsonOut(flags, data.data);
        })
    )

    .command("crds", (c) =>
      c
        .meta({ description: "List currently applied CRDs" })
        .run(async ({ flags }) => {
          const url = await getSiteApiUrl();
          const res = await fetch(`${url}/api/v1/site/crds`);
          if (!res.ok) exitWithError(toDxFlags(flags), `Site API error: ${res.status}`);
          const data = await res.json();
          jsonOut(flags, data.data);
        })
    );
}

async function getSiteApiUrl(): Promise<string> {
  const config = await readConfig();
  const siteUrl = resolveSiteUrl(config);
  return siteUrl || resolveFactoryUrl(config);
}
