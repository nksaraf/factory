import type { DxBase } from "../dx-root.js"
import { toDxFlags } from "./dx-flags.js"
import { exitWithError } from "../lib/cli-exit.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("org identity", [
  "$ dx org identity list                          List all principals with provider links",
  "$ dx org identity show nikhil-saraf              Show principal details + linked identities",
  "$ dx org identity link nikhil-saraf github 12345 Manually link a GitHub identity",
  "$ dx org identity unlink nikhil-saraf jira       Remove a provider link",
  "$ dx org identity merge keep-slug dup-slug       Merge duplicate into kept principal",
  "$ dx org identity sync                           Trigger identity sync now",
  "$ dx org identity unmatched --provider github    Show principals missing GitHub",
])

setExamples("org team", [
  "$ dx org team list                              List teams",
  "$ dx org team show engineering                  Show one team",
  "$ dx org team show engineering --members        Include member table",
  "$ dx org team create eng Engineering            Create a team",
  "$ dx org team create eng Eng --parent root       Nest under parent team slug",
  "$ dx org team update eng --name 'Engineering'    Update fields",
  "$ dx org team delete eng                         Soft-delete (bitemporal)",
  "$ dx org team member list engineering            List members with roles",
  "$ dx org team member add engineering alice       Add principal to team",
  "$ dx org team member add eng alice --role lead   With role lead|admin|member",
  "$ dx org team member remove engineering alice    Remove principal from team",
])

export function orgCommand(app: DxBase) {
  return app
    .sub("org")
    .meta({ description: "Organization management" })
    .command("identity", (c) =>
      c
        .meta({ description: "Identity & principal management" })
        .command("list", (sub) =>
          sub
            .meta({ description: "List all principals with provider links" })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityList } =
                  await import("../handlers/org-identity.js")
                await runIdentityList(f)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("show", (sub) =>
          sub
            .meta({ description: "Show principal details" })
            .args([
              {
                name: "slug",
                type: "string",
                required: true,
                description: "Principal slug or ID",
              },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityShow } =
                  await import("../handlers/org-identity.js")
                await runIdentityShow(f, args.slug)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("link", (sub) =>
          sub
            .meta({ description: "Link an external identity to a principal" })
            .args([
              {
                name: "principal",
                type: "string",
                required: true,
                description: "Principal slug or ID",
              },
              {
                name: "provider",
                type: "string",
                required: true,
                description: "Provider (github, slack, jira, google)",
              },
              {
                name: "externalId",
                type: "string",
                required: true,
                description: "External user ID",
              },
            ])
            .flags({
              name: {
                type: "string" as const,
                description: "Display name for this identity",
              },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityLink } =
                  await import("../handlers/org-identity.js")
                await runIdentityLink(
                  f,
                  args.principal,
                  args.provider,
                  args.externalId,
                  flags.name as string | undefined
                )
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("unlink", (sub) =>
          sub
            .meta({ description: "Remove a provider link from a principal" })
            .args([
              {
                name: "principal",
                type: "string",
                required: true,
                description: "Principal slug or ID",
              },
              {
                name: "provider",
                type: "string",
                required: true,
                description: "Provider to unlink",
              },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityUnlink } =
                  await import("../handlers/org-identity.js")
                await runIdentityUnlink(f, args.principal, args.provider)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("merge", (sub) =>
          sub
            .meta({ description: "Merge a duplicate principal into another" })
            .args([
              {
                name: "keep",
                type: "string",
                required: true,
                description: "Principal to keep (slug or ID)",
              },
              {
                name: "duplicate",
                type: "string",
                required: true,
                description: "Principal to merge & delete (slug or ID)",
              },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityMerge } =
                  await import("../handlers/org-identity.js")
                await runIdentityMerge(f, args.keep, args.duplicate)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("sync", (sub) =>
          sub
            .meta({ description: "Trigger identity sync across all providers" })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentitySync } =
                  await import("../handlers/org-identity.js")
                await runIdentitySync(f)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("unmatched", (sub) =>
          sub
            .meta({ description: "Show principals missing provider links" })
            .flags({
              provider: {
                type: "string" as const,
                description: "Filter to principals missing this provider",
              },
            })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityUnmatched } =
                  await import("../handlers/org-identity.js")
                await runIdentityUnmatched(f, {
                  provider: flags.provider as string | undefined,
                })
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
    )
    .command("team", (c) =>
      c
        .meta({ description: "Teams and membership" })
        .command("list", (sub) =>
          sub.meta({ description: "List teams" }).run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { runTeamList } = await import("../handlers/org-team.js")
              await runTeamList(f)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
        )
        .command("show", (sub) =>
          sub
            .meta({ description: "Show team details" })
            .args([
              {
                name: "slugOrId",
                type: "string",
                required: true,
                description: "Team slug or ID",
              },
            ])
            .flags({
              members: {
                type: "boolean" as const,
                description: "Include members table",
              },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runTeamShow } = await import("../handlers/org-team.js")
                await runTeamShow(f, args.slugOrId, {
                  withMembers: Boolean(flags.members),
                })
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("create", (sub) =>
          sub
            .meta({ description: "Create a team" })
            .args([
              {
                name: "slug",
                type: "string",
                required: true,
                description: "Unique slug",
              },
              {
                name: "name",
                type: "string",
                required: true,
                description: "Display name",
              },
            ])
            .flags({
              type: {
                type: "string" as const,
                description:
                  "team | business-unit | product-area (default: team)",
              },
              parent: {
                type: "string" as const,
                description: "Parent team slug or ID",
              },
              description: {
                type: "string" as const,
                description: "Stored in team spec",
              },
              slack: {
                type: "string" as const,
                description: "Slack channel (team spec)",
              },
              oncall: {
                type: "string" as const,
                description: "Oncall URL (team spec)",
              },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runTeamCreate } =
                  await import("../handlers/org-team.js")
                await runTeamCreate(f, args.slug, args.name, {
                  type: flags.type as string | undefined,
                  parent: flags.parent as string | undefined,
                  description: flags.description as string | undefined,
                  slackChannel: flags.slack as string | undefined,
                  oncallUrl: flags.oncall as string | undefined,
                })
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("update", (sub) =>
          sub
            .meta({ description: "Update a team" })
            .args([
              {
                name: "slugOrId",
                type: "string",
                required: true,
                description: "Team slug or ID",
              },
            ])
            .flags({
              name: {
                type: "string" as const,
                description: "New display name",
              },
              type: {
                type: "string" as const,
                description: "team | business-unit | product-area",
              },
              parent: {
                type: "string" as const,
                description: "Parent team slug or ID",
              },
              noParent: {
                type: "boolean" as const,
                description: "Detach from parent team",
              },
              description: {
                type: "string" as const,
                description: "Team spec description",
              },
              slack: {
                type: "string" as const,
                description: "Slack channel (team spec)",
              },
              oncall: {
                type: "string" as const,
                description: "Oncall URL (team spec)",
              },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runTeamUpdate } =
                  await import("../handlers/org-team.js")
                const noParent = Boolean(flags.noParent)
                const parentFlag = flags.parent as string | undefined
                if (noParent && parentFlag) {
                  exitWithError(
                    f,
                    "Use either --parent or --no-parent, not both."
                  )
                }
                await runTeamUpdate(f, args.slugOrId, {
                  name: flags.name as string | undefined,
                  type: flags.type as string | undefined,
                  parent: noParent ? null : parentFlag,
                  description: flags.description as string | undefined,
                  slackChannel: flags.slack as string | undefined,
                  oncallUrl: flags.oncall as string | undefined,
                })
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("delete", (sub) =>
          sub
            .meta({ description: "Delete a team (bitemporal)" })
            .args([
              {
                name: "slugOrId",
                type: "string",
                required: true,
                description: "Team slug or ID",
              },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runTeamDelete } =
                  await import("../handlers/org-team.js")
                await runTeamDelete(f, args.slugOrId)
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
            })
        )
        .command("member", (m) =>
          m
            .meta({ description: "Team membership" })
            .command("list", (sub) =>
              sub
                .meta({ description: "List principals on a team" })
                .args([
                  {
                    name: "team",
                    type: "string",
                    required: true,
                    description: "Team slug or ID",
                  },
                ])
                .run(async ({ args, flags }) => {
                  const f = toDxFlags(flags)
                  try {
                    const { runTeamMemberList } =
                      await import("../handlers/org-team.js")
                    await runTeamMemberList(f, args.team)
                  } catch (err) {
                    exitWithError(
                      f,
                      err instanceof Error ? err.message : String(err)
                    )
                  }
                })
            )
            .command("add", (sub) =>
              sub
                .meta({ description: "Add a principal to a team" })
                .args([
                  {
                    name: "team",
                    type: "string",
                    required: true,
                    description: "Team slug or ID",
                  },
                  {
                    name: "principal",
                    type: "string",
                    required: true,
                    description: "Principal slug or ID",
                  },
                ])
                .flags({
                  role: {
                    type: "string" as const,
                    description: "member | lead | admin (default: member)",
                  },
                })
                .run(async ({ args, flags }) => {
                  const f = toDxFlags(flags)
                  try {
                    const { runTeamMemberAdd } =
                      await import("../handlers/org-team.js")
                    await runTeamMemberAdd(
                      f,
                      args.team,
                      args.principal,
                      flags.role as string | undefined
                    )
                  } catch (err) {
                    exitWithError(
                      f,
                      err instanceof Error ? err.message : String(err)
                    )
                  }
                })
            )
            .command("remove", (sub) =>
              sub
                .meta({ description: "Remove a principal from a team" })
                .args([
                  {
                    name: "team",
                    type: "string",
                    required: true,
                    description: "Team slug or ID",
                  },
                  {
                    name: "principal",
                    type: "string",
                    required: true,
                    description: "Principal slug or ID",
                  },
                ])
                .run(async ({ args, flags }) => {
                  const f = toDxFlags(flags)
                  try {
                    const { runTeamMemberRemove } =
                      await import("../handlers/org-team.js")
                    await runTeamMemberRemove(f, args.team, args.principal)
                  } catch (err) {
                    exitWithError(
                      f,
                      err instanceof Error ? err.message : String(err)
                    )
                  }
                })
            )
        )
    )
}
