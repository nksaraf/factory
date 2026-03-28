import { runSkillsInteractive, runSkillsCapture } from "./run-skills-cli.js";

export async function agentSkillList(opts: {
  global?: boolean;
  agent?: string;
  json?: boolean;
}): Promise<void> {
  const args = ["list"];
  if (opts.global) args.push("--global");
  if (opts.agent) args.push("--agent", opts.agent);

  if (opts.json) {
    const result = await runSkillsCapture([...args, "--json"]);
    process.stdout.write(result.stdout);
    if (result.exitCode !== 0) process.exit(result.exitCode);
    return;
  }

  await runSkillsInteractive(args);
}
