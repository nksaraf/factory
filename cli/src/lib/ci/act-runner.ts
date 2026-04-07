import { existsSync } from "node:fs";
import { capture, exec } from "../subprocess.js";

type Platform = "darwin" | "linux" | "win32";

export async function ensureActInstalled(): Promise<void> {
  const result = await capture(["act", "--version"]);
  if (result.exitCode === 0) return;

  console.log("act not found, installing...");
  const platform = process.platform as Platform;
  const installCmd: Record<Platform, string> = {
    darwin: "brew install act",
    linux: "curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash",
    win32: "winget install nektos.act",
  };

  const cmd = installCmd[platform];
  if (!cmd) throw new Error(`Unsupported platform for act installation: ${platform}`);

  await exec(["sh", "-c", cmd]);

  // Verify installation succeeded
  const verify = await capture(["act", "--version"]);
  if (verify.exitCode !== 0) {
    throw new Error("Failed to install act. Please install manually: https://github.com/nektos/act");
  }
  console.log(`act installed: ${verify.stdout.trim()}`);
}

export interface ActRunOptions {
  workflow?: string;
  job?: string;
  secrets?: string[];
  envFile?: string;
  platform?: string;
  verbose?: boolean;
  list?: boolean;
  event?: string;
  cwd?: string;
}

export async function runWithAct(options: ActRunOptions): Promise<number> {
  await ensureActInstalled();

  const args = ["act"];

  // Event type (default: push)
  if (options.event) args.push(options.event);

  if (options.workflow) args.push("-W", `.github/workflows/${options.workflow}`);
  if (options.job) args.push("-j", options.job);
  if (options.list) args.push("-l");
  if (options.verbose) args.push("-v");
  if (options.platform) args.push("-P", options.platform);

  // Explicit env file
  if (options.envFile) {
    args.push("--env-file", options.envFile);
  } else if (existsSync(".env")) {
    // Auto-detect .env in project root
    args.push("--env-file", ".env");
  }

  for (const secret of options.secrets ?? []) {
    args.push("-s", secret);
  }

  try {
    await exec(args, { cwd: options.cwd });
    return 0;
  } catch {
    return 1;
  }
}
