import { getFactoryRestClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import type { FactoryClient } from "../lib/api-client.js"
import { exitWithError } from "../lib/cli-exit.js"
import { gitPushAuto } from "../lib/git-push.js"
import { getCurrentBranch } from "../lib/git.js"
import { resolveRepoContext } from "../lib/repo-context.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  actionResult,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
} from "./list-helpers.js"

setExamples("pr", [
  "$ dx pr list                   List open PRs",
  "$ dx pr create                 Create PR interactively",
  "$ dx pr show 42                Show PR details",
  "$ dx pr merge 42               Merge a PR",
])

function pullsPath(ctx: { providerId: string; repoSlug: string }): string {
  return `/api/v1/factory/build/git-host-provider/${ctx.providerId}/repos/${ctx.repoSlug}/pulls`
}

/**
 * Auto-detect PR number for the current branch by finding an open PR
 * whose head matches the current branch name.
 */
async function detectPrNumber(
  flags: Record<string, unknown>,
  rest: FactoryClient,
  ctx: { providerId: string; repoSlug: string },
  cwd: string
): Promise<number> {
  const f = toDxFlags(flags)
  const branch = getCurrentBranch(cwd)
  const result = await rest.request<{ data?: Record<string, unknown>[] }>(
    "GET",
    `${pullsPath(ctx)}?state=open`
  )
  const pulls = Array.isArray(result?.data) ? result.data : []
  const match = pulls.find((pr) => pr.head === branch)
  if (!match) {
    exitWithError(f, `No open PR found for branch "${branch}"`)
  }
  return match.number as number
}

function extractAuthorLogin(pr: Record<string, unknown>): string {
  const author = pr.author
  if (author && typeof author === "object" && "login" in author) {
    return String((author as Record<string, unknown>).login ?? "")
  }
  return ""
}

export function prCommand(app: DxBase) {
  return (
    app
      .sub("pr")
      .meta({
        description: "Pull requests (list, create, show, merge, checks)",
      })

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
            const f = toDxFlags(flags)
            try {
              const cwd = process.cwd()
              const ctx = await resolveRepoContext(cwd)
              const rest = await getFactoryRestClient()
              const state = (flags.status as string) ?? "open"
              const result = await rest.request<{
                data?: Record<string, unknown>[]
              }>("GET", `${pullsPath(ctx)}?state=${state}`)
              const data = Array.isArray(result?.data) ? result.data : []
              tableOrJson(
                flags,
                { data },
                ["#", "Title", "Author", "Status", "Branch"],
                (pr) => [
                  String(pr.number ?? ""),
                  styleBold(String(pr.title ?? "")),
                  extractAuthorLogin(pr),
                  colorStatus(String(pr.state ?? "")),
                  styleMuted(String(pr.head ?? "")),
                ],
                undefined,
                { emptyMessage: "No pull requests found." }
              )
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // --- dx pr show ---
      .command("show", (c) =>
        c
          .meta({ description: "Show pull request details" })
          .args([
            {
              name: "number",
              type: "number",
              description:
                "PR number (auto-detects from current branch if omitted)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const cwd = process.cwd()
              const ctx = await resolveRepoContext(cwd)
              const rest = await getFactoryRestClient()
              const prNumber =
                (args.number as number | undefined) ||
                (await detectPrNumber(flags, rest, ctx, cwd))
              const result = await rest.request<{
                data?: Record<string, unknown>
              }>("GET", `${pullsPath(ctx)}/${prNumber}`)
              const pr = result?.data ?? result
              detailView(flags, { data: pr }, [
                ["Number", (r) => String(r.number ?? "")],
                ["Title", (r) => styleBold(String(r.title ?? ""))],
                ["State", (r) => colorStatus(String(r.state ?? ""))],
                ["Draft", (r) => String(r.draft ?? false)],
                [
                  "Branch",
                  (r) =>
                    `${styleMuted(String(r.head ?? ""))} -> ${String(r.base ?? "")}`,
                ],
                ["Author", (r) => extractAuthorLogin(r)],
                ["URL", (r) => styleMuted(String(r.url ?? r.htmlUrl ?? ""))],
                ["Body", (r) => String(r.body ?? "")],
              ])
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
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
            const f = toDxFlags(flags)
            try {
              const cwd = process.cwd()
              const ctx = await resolveRepoContext(cwd)
              const head = getCurrentBranch(cwd)
              const base = (flags.base as string) || ctx.defaultBranch

              let title = flags.title as string | undefined
              if (!title) {
                const { input } = await import("@crustjs/prompts")
                title = await input({ message: "PR title:" })
              }

              // Push first
              gitPushAuto(cwd)

              const rest = await getFactoryRestClient()
              const result = await rest.request<{
                data?: Record<string, unknown>
              }>("POST", pullsPath(ctx), {
                title,
                body: (flags.body as string) ?? "",
                head,
                base,
                draft: (flags.draft as boolean) ?? false,
              })
              const pr = result?.data ?? (result as Record<string, unknown>)

              if (f.json) {
                console.log(
                  JSON.stringify(
                    {
                      success: true,
                      number: pr.number,
                      url: pr.url ?? pr.htmlUrl ?? "",
                    },
                    null,
                    2
                  )
                )
              } else {
                console.log(
                  styleSuccess(
                    `PR #${pr.number} created: ${pr.url ?? pr.htmlUrl ?? ""}`
                  )
                )
              }
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // --- dx pr checks ---
      .command("checks", (c) =>
        c
          .meta({ description: "Show CI checks for a pull request" })
          .args([
            {
              name: "number",
              type: "number",
              description:
                "PR number (auto-detects from current branch if omitted)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const cwd = process.cwd()
              const ctx = await resolveRepoContext(cwd)
              const rest = await getFactoryRestClient()
              const prNumber =
                (args.number as number | undefined) ||
                (await detectPrNumber(flags, rest, ctx, cwd))
              const result = await rest.request<{
                data?: Record<string, unknown>[]
              }>("GET", `${pullsPath(ctx)}/${prNumber}/checks`)
              const data = Array.isArray(result?.data) ? result.data : []
              tableOrJson(
                flags,
                { data },
                ["Name", "Status", "Conclusion", "URL"],
                (check) => [
                  styleBold(String(check.name ?? "")),
                  colorStatus(String(check.status ?? "")),
                  colorStatus(String(check.conclusion ?? "")),
                  styleMuted(String(check.url ?? check.detailsUrl ?? "")),
                ],
                undefined,
                { emptyMessage: "No checks found." }
              )
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // --- dx pr merge ---
      .command("merge", (c) =>
        c
          .meta({ description: "Merge a pull request" })
          .args([
            {
              name: "number",
              type: "number",
              description:
                "PR number (auto-detects from current branch if omitted)",
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
            const f = toDxFlags(flags)
            try {
              const cwd = process.cwd()
              const ctx = await resolveRepoContext(cwd)
              const rest = await getFactoryRestClient()
              const prNumber =
                (args.number as number | undefined) ||
                (await detectPrNumber(flags, rest, ctx, cwd))

              let method = "squash"
              if (flags.rebase) method = "rebase"
              else if (flags.merge) method = "merge"

              const result = await rest.request<Record<string, unknown>>(
                "POST",
                `${pullsPath(ctx)}/${prNumber}/merge`,
                { method }
              )
              actionResult(
                flags,
                result,
                styleSuccess(`PR #${prNumber} merged (${method}).`)
              )
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )
  )
}
