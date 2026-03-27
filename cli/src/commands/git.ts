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
        )

        .command("update", (c) =>
          c
            .meta({ description: "Update a git host provider" })
            .args([
              {
                name: "id",
                type: "string",
                required: true,
                description: "Provider ID",
              },
            ])
            .flags({
              name: {
                type: "string",
                description: "New provider name",
              },
              token: {
                type: "string",
                description: "New access token / credentials",
              },
              authMode: {
                type: "string",
                description: "New auth mode (pat, github_app, oauth)",
              },
            })
            .run(async ({ args, flags }) => {
              const api = await getApi();
              const body: Record<string, unknown> = {};
              if (flags.name) body.name = flags.name as string;
              if (flags.token) body.credentialsEnc = flags.token as string;
              if (flags.authMode) body.authMode = flags.authMode as string;
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build["git-host-provider"][args.id].put(body),
              );
              actionResult(flags, result, styleSuccess(`Git host provider ${args.id} updated.`));
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
        )

        .command("create", (c) =>
          c
            .meta({ description: "Create a repo" })
            .flags({
              name: {
                type: "string",
                description: "Repo name",
              },
              kind: {
                type: "string",
                description:
                  "Repo kind (product-module, platform-module, library, vendor-module, infra, docs, client-project, tool)",
              },
              gitUrl: {
                type: "string",
                required: true,
                description: "Git URL",
              },
              branch: {
                type: "string",
                description: "Default branch (default: main)",
              },
              team: {
                type: "string",
                description: "Team ID",
              },
            })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags);

              const repoKinds = [
                "product-module",
                "platform-module",
                "library",
                "vendor-module",
                "infra",
                "docs",
                "client-project",
                "tool",
              ] as const;

              let name = flags.name as string | undefined;
              if (!name) {
                const { input } = await import("@inquirer/prompts");
                name = await input({ message: "Repo name:" });
              }

              let kind = flags.kind as string | undefined;
              if (!kind) {
                const { select } = await import("@inquirer/prompts");
                kind = await select({
                  message: "Repo kind:",
                  choices: repoKinds.map((k) => ({ name: k, value: k })),
                });
              }

              const api = await getApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build.repos.post({
                  name,
                  kind,
                  gitUrl: flags.gitUrl as string,
                  defaultBranch: (flags.branch as string) ?? "main",
                  teamId: flags.team as string ?? "",
                }),
              );
              actionResult(flags, result, styleSuccess(`Repo "${name}" created.`));
            }),
        ),
    )

    // --- dx git clone ---
    .command("clone", (c) =>
      c
        .meta({ description: "Clone a repo (URL, factory slug, or interactive picker)" })
        .args([
          {
            name: "target",
            type: "string",
            description: "Git URL, factory repo slug, or omit for interactive picker",
          },
        ])
        .flags({
          dir: { type: "string", alias: "d", description: "Target directory" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const target = args.target as string | undefined;
            let gitUrl: string;

            // Direct URL — skip factory API entirely
            if (target && /^(https?:\/\/|git@|ssh:\/\/)/.test(target)) {
              gitUrl = target;
            } else {
              // Factory lookup
              const api = await getApi();
              if (!target) {
                const listRes = await api.api.v1.factory.build.repos.get();
                const repos = listRes.data?.data as Array<{ name: string; kind?: string; gitUrl?: string }> | undefined;
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
                  target
                ].get();
                if (res.error || !res.data?.data) {
                  exitWithError(f, "Repo not found");
                  return;
                }
                gitUrl = res.data.data.gitUrl ?? "";
              }
            }

            if (!gitUrl) {
              exitWithError(f, "Repo has no git URL");
              return;
            }
            const { execFileSync } = await import("node:child_process");
            const cloneArgs = ["clone", gitUrl];
            if (flags.dir) cloneArgs.push(flags.dir as string);
            console.log(`Cloning ${gitUrl}...`);
            execFileSync("git", cloneArgs, {
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
