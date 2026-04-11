import type { DxBase } from "../dx-root.js"

import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { stubRun } from "./stub-run.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("agent", [
  "$ dx agent list                        List agents",
  "$ dx agent run my-agent                Run an agent",
  "$ dx agent skill add user/repo         Add a skill from GitHub",
  "$ dx agent skill list -g               List globally installed skills",
  "$ dx agent skill find                  Search for skills interactively",
  "$ dx agent skill sync                  Install org's internal skills",
])

/** Shared flags for skill add / remove. */
const SKILL_MUTATE_FLAGS = {
  global: {
    type: "boolean" as const,
    short: "g",
    description:
      "Install/remove globally (user-level) instead of project-level",
  },
  agent: {
    type: "string" as const,
    short: "a",
    description: "Target agent(s) (e.g. claude-code, cursor; use '*' for all)",
  },
  skill: {
    type: "string" as const,
    short: "s",
    description: "Specific skill name(s) to install/remove (use '*' for all)",
  },
  all: {
    type: "boolean" as const,
    description: "Shorthand for --skill '*' --agent '*' --yes",
  },
  yes: {
    type: "boolean" as const,
    short: "y",
    description: "Skip confirmation prompts",
  },
}

function agentSkillCommands(app: DxBase) {
  return (
    app
      .sub("skill")
      .meta({ description: "Manage agent skills (SKILL.md packages)" })

      // ── add ──
      .command("add", (c) =>
        c
          .meta({ description: "Add a skill package from GitHub" })
          .args([
            {
              name: "package",
              type: "string",
              required: true,
              description: "GitHub repo (user/repo) or URL",
            },
          ])
          .flags(SKILL_MUTATE_FLAGS)
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillAdd } =
                await import("../handlers/agent-skill/add.js")
              await agentSkillAdd({
                package: args.package as string,
                global: flags.global as boolean | undefined,
                agent: flags.agent as string | undefined,
                skill: flags.skill as string | undefined,
                all: flags.all as boolean | undefined,
                yes: flags.yes as boolean | undefined,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── remove ──
      .command("remove", (c) =>
        c
          .meta({ description: "Remove installed skills" })
          .args([
            {
              name: "skills",
              type: "string",
              description: "Skill name(s) to remove (interactive if omitted)",
            },
          ])
          .flags(SKILL_MUTATE_FLAGS)
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillRemove } =
                await import("../handlers/agent-skill/remove.js")
              await agentSkillRemove({
                skills: args.skills as string | undefined,
                global: flags.global as boolean | undefined,
                agent: flags.agent as string | undefined,
                skill: flags.skill as string | undefined,
                all: flags.all as boolean | undefined,
                yes: flags.yes as boolean | undefined,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── list ──
      .command("list", (c) =>
        c
          .meta({ description: "List installed skills" })
          .flags({
            global: {
              type: "boolean",
              short: "g",
              description: "List global skills (default: project)",
            },
            agent: {
              type: "string",
              short: "a",
              description: "Filter by specific agent(s)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillList } =
                await import("../handlers/agent-skill/list.js")
              await agentSkillList({
                global: flags.global as boolean | undefined,
                agent: flags.agent as string | undefined,
                json: f.json,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── find ──
      .command("find", (c) =>
        c
          .meta({ description: "Search for skills interactively" })
          .args([
            {
              name: "query",
              type: "string",
              description: "Search keyword (interactive if omitted)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillFind } =
                await import("../handlers/agent-skill/find.js")
              await agentSkillFind({
                query: args.query as string | undefined,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── check ──
      .command("check", (c) =>
        c
          .meta({ description: "Check for available skill updates" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillCheck } =
                await import("../handlers/agent-skill/check.js")
              await agentSkillCheck()
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── update ──
      .command("update", (c) =>
        c
          .meta({ description: "Update all skills to latest versions" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillUpdate } =
                await import("../handlers/agent-skill/update.js")
              await agentSkillUpdate()
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── init ──
      .command("init", (c) =>
        c
          .meta({ description: "Initialize a new skill (creates SKILL.md)" })
          .args([
            {
              name: "name",
              type: "string",
              description: "Skill name (creates <name>/SKILL.md)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillInit } =
                await import("../handlers/agent-skill/init.js")
              await agentSkillInit({
                name: args.name as string | undefined,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── sync ──
      .command("sync", (c) =>
        c
          .meta({
            description:
              "Install the org's internal skill library from the monorepo skills/ directory",
          })
          .flags({
            agent: {
              type: "string",
              short: "a",
              description: "Target agent(s) to sync to",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { agentSkillSync } =
                await import("../handlers/agent-skill/sync.js")
              await agentSkillSync({
                agent: flags.agent as string | undefined,
                json: f.json,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )
  )
}

export function agentCommand(app: DxBase) {
  const skillSub = agentSkillCommands(app)

  return app
    .sub("agent")
    .meta({ description: "Agent operations" })
    .command("list", (c) => c.meta({ description: "List agents" }).run(stubRun))
    .command("run", (c) => c.meta({ description: "Run an agent" }).run(stubRun))
    .command("show", (c) =>
      c.meta({ description: "Show agent details" }).run(stubRun)
    )
    .command(skillSub)
}
