import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  apiCall,
  tableOrJson,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js";

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
              limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
              sort: { type: "string", description: "Sort by: name, type, status (default: name)" },
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
              tableOrJson(
                flags,
                result,
                ["ID", "Name", "Type", "Auth", "Sync", "Status", "Last Sync"],
                (r) => [
                  styleMuted(String(r.gitHostProviderId ?? "")),
                  styleBold(String(r.name ?? "")),
                  String(r.hostType ?? ""),
                  String(r.authMode ?? ""),
                  colorStatus(String(r.syncStatus ?? "")),
                  colorStatus(String(r.status ?? "")),
                  timeAgo(r.lastSyncAt as string),
                ],
                undefined,
                { emptyMessage: "No git host providers found." },
              );
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
              actionResult(flags, result, styleSuccess(`Git host provider "${flags.name}" created.`));
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
                api.api.v1.factory.build["git-host-provider"]({ id: args.id }).sync.post(),
              );
              actionResult(flags, result, styleSuccess(`Sync started for provider ${args.id}.`));
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
                api.api.v1.factory.build["git-host-provider"]({ id: args.id }).delete(),
              );
              actionResult(flags, undefined, styleSuccess(`Git host provider ${args.id} deleted.`));
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
              limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
              sort: { type: "string", description: "Sort by: name, kind (default: name)" },
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
              tableOrJson(
                flags,
                result,
                ["ID", "Name", "Kind", "Branch", "Git URL"],
                (r) => [
                  styleMuted(String(r.repoId ?? "")),
                  styleBold(String(r.name ?? "")),
                  String(r.kind ?? ""),
                  String(r.defaultBranch ?? ""),
                  styleMuted(String(r.gitUrl ?? "")),
                ],
                undefined,
                { emptyMessage: "No repos found." },
              );
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
            required: false,
            description: "Repo slug or ID (interactive picker if omitted)",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const api = await getApi();
            let slug = args.slug as string | undefined;
            let gitUrl: string;
            if (!slug) {
              const listRes = await api.api.v1.factory.build.repos.get();
              const repos = listRes.data?.data;
              if (!repos || repos.length === 0) {
                exitWithError(f, "No repos found");
                return;
              }
              const { search } = await import("@inquirer/prompts");
              const choices = repos.map((r) => ({
                name: `${r.name} (${r.kind ?? "repo"})`,
                value: r.gitUrl ?? "",
                description: r.gitUrl ?? undefined,
              }));
              gitUrl = await search({
                message: "Search for a repo to clone",
                source: (input) => {
                  if (!input) return choices;
                  const term = input.toLowerCase();
                  return choices.filter(
                    (c) =>
                      c.name.toLowerCase().includes(term) ||
                      (c.description?.toLowerCase().includes(term) ?? false),
                  );
                },
              });
            } else {
              const res = await api.api.v1.factory.build.repos[
                slug
              ].get();
              if (res.error || !res.data?.data) {
                exitWithError(f, "Repo not found");
                return;
              }
              gitUrl = res.data.data.gitUrl ?? "";
            }
            if (!gitUrl) {
              exitWithError(f, "Repo has no git URL");
              return;
            }
            const { execFileSync } = await import("node:child_process");
            console.log(`Cloning ${gitUrl}...`);
            execFileSync("git", ["clone", gitUrl], {
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
