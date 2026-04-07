import { runSkillsInteractive } from "./run-skills-cli.js";

export async function agentSkillUpdate(): Promise<void> {
  await runSkillsInteractive(["update"]);
}
