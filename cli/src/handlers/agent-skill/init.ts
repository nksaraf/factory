import { runSkillsInteractive } from "./run-skills-cli.js"

export async function agentSkillInit(opts: { name?: string }): Promise<void> {
  const args = ["init"]
  if (opts.name) args.push(opts.name)
  await runSkillsInteractive(args)
}
