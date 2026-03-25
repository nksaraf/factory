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
  fn: () => Promise<{ data: unknown; error: unknown }>,
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
async function getApi(): Promise<any> {
  return getFactoryClient();
}

export function gitCommand(app: DxBase) {
  return app
    .sub("git")
    .meta({ description: "Git integration (host providers, repos, clone)" })

    // --- dx git host ---
    .command("host", (c) =>
      c
        .meta({ description: "Manage git host providers" })

        .command("list", (c) =>
          c
            .meta({ description: "List git host providers" })
            .flags({
              teamId: { type: "string", description: "Filter by team ID" },
              limit: { type: "number", description: "Max results" },
            })
            .run(async ({ flags }) => {
              const api = await getApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build["git-host-provider"].get({
                  query: {
                    teamId: flags.teamId as string | undefined,
                    limit: flags.limit as number | undefined,
                  },
                }),
              );
              jsonOut(flags, result);
            }),
        )

        .command("create", (c) =>
          c
            .meta({ description: "Create a git host provider" })
            .flags({
              name: {
                type: "string",
                required: true,
                description: "Provider name",
              },
              type: {
                type: "string",
                required: true,
                description:
                  "Host type (github, gitlab, gitea, bitbucket)",
              },
              authMode: {
                type: "string",
                description: "Auth mode (pat, github_app, oauth)",
              },
              token: {
                type: "string",
                description: "Access token",
              },
              apiBaseUrl: {
                type: "string",
                description: "API base URL",
              },
              teamId: {
                type: "string",
                required: true,
                description: "Team ID",
              },
            })
            .run(async ({ flags }) => {
              const api = await getApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build["git-host-provider"].post({
                  name: flags.name as string,
                  hostType: flags.type as string,
                  authMode: (flags.authMode as string) ?? "pat",
                  credentialsEnc: flags.token as string | undefined,
                  apiBaseUrl:
                    (flags.apiBaseUrl as string) ??
                    "https://api.github.com",
                  teamId: flags.teamId as string,
                }),
              );
              jsonOut(flags, result);
            }),
        )

        .command("sync", (c) =>
          c
            .meta({ description: "Trigger full sync for a provider" })
            .args([
              {
                name: "id",
                type: "string",
                required: true,
                description: "Provider ID",
              },
            ])
            .run(async ({ args, flags }) => {
              const api = await getApi();
              const result = await apiCall(flags, () =>
                (api.api.v1.factory.build["git-host-provider"] as any)[
                  args.id
                ].sync.post(),
              );
              jsonOut(flags, result);
            }),
        )

        .command("delete", (c) =>
          c
            .meta({ description: "Delete a git host provider" })
            .args([
              {
                name: "id",
                type: "string",
                required: true,
                description: "Provider ID",
              },
            ])
            .run(async ({ args, flags }) => {
              const api = await getApi();
              await apiCall(flags, () =>
                (api.api.v1.factory.build["git-host-provider"] as any)[
                  args.id
                ].delete(),
              );
              console.log("Deleted.");
            }),
        ),
    )

    // --- dx git repo ---
    .command("repo", (c) =>
      c
        .meta({ description: "Manage synced repos" })

        .command("list", (c) =>
          c
            .meta({ description: "List repos" })
            .flags({
              moduleId: {
                type: "string",
                description: "Filter by module ID",
              },
              limit: { type: "number", description: "Max results" },
            })
            .run(async ({ flags }) => {
              const api = await getApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build.repos.get({
                  query: {
                    moduleId: flags.moduleId as string | undefined,
                    limit: flags.limit as number | undefined,
                  },
                }),
              );
              jsonOut(flags, result);
            }),
        ),
    )

    // --- dx git clone ---
    .command("clone", (c) =>
      c
        .meta({ description: "Clone a factory repo locally" })
        .args([
          {
            name: "slug",
            type: "string",
            required: true,
            description: "Repo slug or ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const api = await getApi();
            const res = await api.api.v1.factory.build.repos[
              args.slug
            ].get();
            if (res.error || !res.data?.data) {
              exitWithError(f, "Repo not found");
              return;
            }
            const repo = res.data.data;
            const { execFileSync } = await import("node:child_process");
            console.log(`Cloning ${repo.gitUrl}...`);
            execFileSync("git", ["clone", repo.gitUrl], {
              stdio: "inherit",
            });
          } catch (err) {
            exitWithError(
              f,
              err instanceof Error ? err.message : String(err),
            );
          }
        }),
    );
}
