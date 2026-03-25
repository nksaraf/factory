import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
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
            short: "s",
            description: "Filter by status (draft|staging|production)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.releases.get({
              query: { status: flags.status as string | undefined },
            })
          );
          jsonOut(flags, result);
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
            api.api.v1.fleet.releases.post({ version: args.version })
          );
          jsonOut(flags, result);
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
            api.api.v1.fleet.releases({ version: args.version }).get()
          );
          jsonOut(flags, result);
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
            api.api.v1.fleet
              .releases({ version: args.version })
              .promote.post({
                target: (flags.target as string) ?? "staging",
              })
          );
          jsonOut(flags, result);
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
                  api.api.v1.fleet.releases({ version: args.version }).get()
                );

                if (!release) {
                  exitWithError(f, `Release ${args.version} not found`);
                }

                const bundle = await apiCall(flags, () =>
                  api.api.v1.fleet.bundles.post({
                    releaseId: (release as any).releaseId,
                    role,
                    arch: (flags.arch as string) ?? "amd64",
                    dxVersion: (flags.dxVersion as string) ?? args.version,
                    k3sVersion: (flags.k3sVersion as string) ?? "v1.31.4+k3s1",
                    helmChartVersion: args.version,
                  })
                );

                console.log(`Bundle record created: ${JSON.stringify(bundle, null, 2)}`);
                console.log(
                  `\nTo complete the bundle, run the build pipeline:\n` +
                  `  dx ops build-bundle --bundle-id ${(bundle as any).releaseBundleId}\n`
                );
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
              status: { type: "string", description: "Filter by status" },
              role: { type: "string", description: "Filter by role (site|factory)" },
            })
            .run(async ({ flags }) => {
              const api = await getFleetApi();
              const result = await apiCall(flags, () =>
                api.api.v1.fleet.bundles.get({
                  query: {
                    releaseId: flags.releaseId as string | undefined,
                    status: flags.status as string | undefined,
                    role: flags.role as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
    );
}
