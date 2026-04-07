import { runSkillsInteractive } from "./run-skills-cli.js";

export async function agentSkillRemove(opts: {
  skills?: string;
  global?: boolean;
  agent?: string;
  skill?: string;
  all?: boolean;
  yes?: boolean;
}): Promise<void> {
  const args = ["remove"];
  if (opts.skills) args.push(opts.skills);
  if (opts.global) args.push("--global");
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.skill) args.push("--skill", opts.skill);
  if (opts.all) args.push("--all");
  if (opts.yes) args.push("--yes");
  await runSkillsInteractive(args);
}
