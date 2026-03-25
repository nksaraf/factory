import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
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

export function releaseCommand(app: DxBase) {
  return app
    .sub("release")
    .meta({ description: "Release management" })

    .command("list", (c) =>
      c
        .meta({ description: "List releases" })
        .flags({
          status: {
            type: "string",
            alias: "s",
            description: "Filter by status (draft|staging|production)",
          },
          sort: {
            type: "string",
            description: "Sort by: version, status, created (default: created)",
          },
          limit: {
            type: "number",
            alias: "n",
            description: "Limit results (default: 50)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.fleet.releases.get({
              query: { status: flags.status as string | undefined },
            })
          );
          tableOrJson(
            flags,
            result,
            ["ID", "Version", "Status", "Created By", "Created"],
            (r) => [
              styleMuted(String(r.releaseId ?? "")),
              styleBold(String(r.version ?? "")),
              colorStatus(String(r.status ?? "")),
              String(r.createdBy ?? ""),
              timeAgo(r.createdAt as string),
            ],
            undefined,
            { emptyMessage: "No releases found." },
          );
        })
    )

    .command("create", (c) =>
      c
        .meta({ description: "Create a release" })
        .args([
          {
            name: "version",
            type: "string",
            required: true,
            description: "Release version (e.g. 1.0.0)",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.fleet.releases.post({ version: args.version })
          );
          actionResult(flags, result, styleSuccess(`Release "${args.version}" created.`));
        })
    )

    .command("status", (c) =>
      c
        .meta({ description: "Get release status" })
        .args([
          {
            name: "version",
            type: "string",
            required: true,
            description: "Release version",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.fleet.releases({ version: args.version }).get()
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.releaseId ?? ""))],
            ["Version", (r) => styleBold(String(r.version ?? ""))],
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["Created By", (r) => String(r.createdBy ?? "")],
            ["Created", (r) => timeAgo(r.createdAt as string)],
          ]);
        })
    )

    .command("promote", (c) =>
      c
        .meta({ description: "Promote a release" })
        .args([
          {
            name: "version",
            type: "string",
            required: true,
            description: "Release version",
          },
        ])
        .flags({
          target: {
            type: "string",
            short: "t",
            description: "Promotion target (staging|production)",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.fleet
              .releases({ version: args.version })
              .promote.post({
                target: (flags.target as string) ?? "staging",
              })
          );
          actionResult(flags, result, styleSuccess(`Release "${args.version}" promoted to ${(flags.target as string) ?? "staging"}.`));
        })
    )

    .command("bundle", (c) =>
      c
        .meta({ description: "Manage release bundles" })
        .command("create", (sc) =>
          sc
            .meta({ description: "Create an offline bundle for a release (Factory-only)" })
            .args([
              {
                name: "version",
                type: "string",
                required: true,
                description: "Release version to bundle",
              },
            ])
            .flags({
              role: {
                type: "string",
                description: "Bundle role: site (default), factory, or both",
              },
              arch: {
                type: "string",
                description: "Target architecture: amd64 (default) or arm64",
              },
              dxVersion: {
                type: "string",
                description: "dx CLI version to include",
              },
              k3sVersion: {
                type: "string",
                description: "k3s version to include",
              },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags);
              const api = await getFleetApi();

              const roles = (flags.role as string) === "both"
                ? ["site", "factory"]
                : [(flags.role as string) ?? "site"];

              for (const role of roles) {
                console.log(`Creating ${role} bundle for release ${args.version}...`);

                const release = await apiCall(flags, () =>
                  api.api.v1.factory.fleet.releases({ version: args.version }).get()
                );

                if (!release) {
                  const { exitWithError } = await import("../lib/cli-exit.js");
                  exitWithError(f, `Release ${args.version} not found`);
                }

                const releaseData = release as Record<string, unknown>;
                const bundle = await apiCall(flags, () =>
                  api.api.v1.factory.fleet.bundles.post({
                    releaseId: releaseData.releaseId as string,
                    role,
                    arch: (flags.arch as string) ?? "amd64",
                    dxVersion: (flags.dxVersion as string) ?? args.version,
                    k3sVersion: (flags.k3sVersion as string) ?? "v1.31.4+k3s1",
                    helmChartVersion: args.version,
                  })
                );

                const bundleData = bundle as Record<string, unknown>;
                if (!f.json) {
                  console.log(styleSuccess(`Bundle created: ${bundleData.releaseBundleId}`));
                  console.log(
                    `\nTo complete the bundle, run the build pipeline:\n` +
                    `  dx ops build-bundle --bundle-id ${bundleData.releaseBundleId}\n`
                  );
                }
              }

              if (f.json) {
                console.log(JSON.stringify({ success: true }, null, 2));
              }
            })
        )
        .command("list", (sc) =>
          sc
            .meta({ description: "List release bundles" })
            .flags({
              releaseId: { type: "string", description: "Filter by release ID" },
              status: { type: "string", alias: "s", description: "Filter by status" },
              role: { type: "string", description: "Filter by role (site|factory)" },
              limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
            })
            .run(async ({ flags }) => {
              const api = await getFleetApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.fleet.bundles.get({
                  query: {
                    releaseId: flags.releaseId as string | undefined,
                    status: flags.status as string | undefined,
                    role: flags.role as string | undefined,
                  },
                })
              );
              tableOrJson(
                flags,
                result,
                ["ID", "Release", "Role", "Arch", "Status", "Created"],
                (r) => [
                  styleMuted(String(r.releaseBundleId ?? "")),
                  styleBold(String(r.releaseId ?? "")),
                  String(r.role ?? ""),
                  String(r.arch ?? ""),
                  colorStatus(String(r.status ?? "")),
                  timeAgo(r.createdAt as string),
                ],
                undefined,
                { emptyMessage: "No bundles found." },
              );
            })
        )
    );
}
