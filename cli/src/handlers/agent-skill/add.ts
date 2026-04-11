import { runSkillsInteractive } from "./run-skills-cli.js"

export async function agentSkillAdd(opts: {
  package: string
  global?: boolean
  agent?: string
  skill?: string
  all?: boolean
  yes?: boolean
}): Promise<void> {
  const args = ["add", opts.package]
  if (opts.global) args.push("--global")
  if (opts.agent) args.push("--agent", opts.agent)
  if (opts.skill) args.push("--skill", opts.skill)
  if (opts.all) args.push("--all")
  if (opts.yes) args.push("--yes")
  await runSkillsInteractive(args)
}
