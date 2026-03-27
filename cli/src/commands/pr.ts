import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { getCurrentBranch } from "../lib/git.js";
import { gitPushAuto } from "../lib/git-push.js";
import { resolveRepoContext } from "../lib/repo-context.js";
import { toDxFlags } from "./dx-flags.js";
import {
  apiCall,
  tableOrJson,
  actionResult,
  detailView,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("pr", [
  "$ dx pr list                   List open PRs",
  "$ dx pr create                 Create PR interactively",
  "$ dx pr show 42                Show PR details",
  "$ dx pr merge 42               Merge a PR",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getApi(): Promise<any> {
  return getFactoryClient();
}

/**
 * Auto-detect PR number for the current branch by finding an open PR
 * whose head matches the current branch name.
 */
async function detectPrNumber(
  flags: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  ctx: { providerId: string; repoSlug: string },
  cwd: string,
): Promise<number> {
  const f = toDxFlags(flags);
  const branch = getCurrentBranch(cwd);
  const result = await apiCall(flags, () =>
    api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls.get({
      query: { state: "open" },
    }),
  );
  const pulls = Array.isArray((result as any)?.data) ? (result as any).data : Array.isArray(result) ? result : [];
  const match = pulls.find((pr: any) => pr.head === branch);
  if (!match) {
    exitWithError(f, `No open PR found for branch "${branch}"`);
  }
  return match.number;
}

export function prCommand(app: DxBase) {
  return app
    .sub("pr")
    .meta({ description: "Pull requests (list, create, show, merge, checks)" })

    // --- dx pr list ---
    .command("list", (c) =>
      c
        .meta({ description: "List pull requests" })
        .flags({
          status: {
            type: "string",
            description: "Filter by state: open, closed, all (default: open)",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const cwd = process.cwd();
            const ctx = await resolveRepoContext(cwd);
            const api = await getApi();
            const result = await apiCall(flags, () =>
              api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls.get({
                query: { state: (flags.status as string) ?? "open" },
              }),
            );
            tableOrJson(
              flags,
              result,
              ["#", "Title", "Author", "Status", "Branch"],
              (pr) => [
                String(pr.number ?? ""),
                styleBold(String(pr.title ?? "")),
                String((pr.author as any)?.login ?? ""),
                colorStatus(String(pr.state ?? "")),
                styleMuted(String(pr.head ?? "")),
              ],
              undefined,
              { emptyMessage: "No pull requests found." },
            );
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )

    // --- dx pr show ---
    .command("show", (c) =>
      c
        .meta({ description: "Show pull request details" })
        .args([
          {
            name: "number",
            type: "number",
            description: "PR number (auto-detects from current branch if omitted)",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const cwd = process.cwd();
            const ctx = await resolveRepoContext(cwd);
            const api = await getApi();
            const prNumber = (args.number as number | undefined) || await detectPrNumber(flags, api, ctx, cwd);
            const result = await apiCall(flags, () =>
              api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls[prNumber].get(),
            );
            detailView(flags, result, [
              ["Number", (r) => String(r.number ?? "")],
              ["Title", (r) => styleBold(String(r.title ?? ""))],
              ["State", (r) => colorStatus(String(r.state ?? ""))],
              ["Draft", (r) => String(r.draft ?? false)],
              ["Branch", (r) => `${styleMuted(String(r.head ?? ""))} -> ${String(r.base ?? "")}`],
              ["Author", (r) => String((r.author as any)?.login ?? "")],
              ["URL", (r) => styleMuted(String(r.url ?? r.htmlUrl ?? ""))],
              ["Body", (r) => String(r.body ?? "")],
            ]);
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )

    // --- dx pr create ---
    .command("create", (c) =>
      c
        .meta({ description: "Create a pull request" })
        .flags({
          title: {
            type: "string",
            description: "PR title",
          },
          body: {
            type: "string",
            description: "PR body / description",
          },
          draft: {
            type: "boolean",
            description: "Create as draft PR",
          },
          base: {
            type: "string",
            description: "Base branch (default: repo default branch)",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const cwd = process.cwd();
            const ctx = await resolveRepoContext(cwd);
            const head = getCurrentBranch(cwd);
            const base = (flags.base as string) || ctx.defaultBranch;

            let title = flags.title as string | undefined;
            if (!title) {
              const { input } = await import("@crustjs/prompts");
              title = await input({ message: "PR title:" });
            }

            // Push first
            gitPushAuto(cwd);

            const api = await getApi();
            const result = await apiCall(flags, () =>
              api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls.post({
                title,
                body: (flags.body as string) ?? "",
                head,
                base,
                draft: (flags.draft as boolean) ?? false,
              }),
            );

            if (f.json) {
              const pr = (result as any)?.data ?? result;
              console.log(JSON.stringify({
                success: true,
                number: pr.number,
                url: pr.url ?? pr.htmlUrl ?? "",
              }, null, 2));
            } else {
              const pr = (result as any)?.data ?? result;
              console.log(styleSuccess(`PR #${pr.number} created: ${pr.url ?? pr.htmlUrl ?? ""}`));
            }
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )

    // --- dx pr checks ---
    .command("checks", (c) =>
      c
        .meta({ description: "Show CI checks for a pull request" })
        .args([
          {
            name: "number",
            type: "number",
            description: "PR number (auto-detects from current branch if omitted)",
          },
        ])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const cwd = process.cwd();
            const ctx = await resolveRepoContext(cwd);
            const api = await getApi();
            const prNumber = (args.number as number | undefined) || await detectPrNumber(flags, api, ctx, cwd);
            const result = await apiCall(flags, () =>
              api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls[prNumber].checks.get(),
            );
            tableOrJson(
              flags,
              result,
              ["Name", "Status", "Conclusion", "URL"],
              (check) => [
                styleBold(String(check.name ?? "")),
                colorStatus(String(check.status ?? "")),
                colorStatus(String(check.conclusion ?? "")),
                styleMuted(String(check.url ?? check.detailsUrl ?? "")),
              ],
              undefined,
              { emptyMessage: "No checks found." },
            );
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )

    // --- dx pr merge ---
    .command("merge", (c) =>
      c
        .meta({ description: "Merge a pull request" })
        .args([
          {
            name: "number",
            type: "number",
            description: "PR number (auto-detects from current branch if omitted)",
          },
        ])
        .flags({
          squash: {
            type: "boolean",
            description: "Squash merge (default)",
          },
          rebase: {
            type: "boolean",
            description: "Rebase merge",
          },
          merge: {
            type: "boolean",
            description: "Merge commit",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const cwd = process.cwd();
            const ctx = await resolveRepoContext(cwd);
            const api = await getApi();
            const prNumber = (args.number as number | undefined) || await detectPrNumber(flags, api, ctx, cwd);

            let method = "squash";
            if (flags.rebase) method = "rebase";
            else if (flags.merge) method = "merge";

            const result = await apiCall(flags, () =>
              api.api.v1.factory.build["git-host-provider"][ctx.providerId].repos[ctx.repoSlug].pulls[prNumber].merge.post({
                method,
              }),
            );
            actionResult(flags, result, styleSuccess(`PR #${prNumber} merged (${method}).`));
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    );
}
