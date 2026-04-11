import { runSkillsInteractive } from "./run-skills-cli.js"

export async function agentSkillCheck(): Promise<void> {
  await runSkillsInteractive(["check"])
}
