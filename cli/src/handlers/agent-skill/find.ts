import { runSkillsInteractive } from "./run-skills-cli.js";

export async function agentSkillFind(opts: {
  query?: string;
}): Promise<void> {
  const args = ["find"];
  if (opts.query) args.push(opts.query);
  await runSkillsInteractive(args);
}
