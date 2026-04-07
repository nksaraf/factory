import { existsSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { upsertManagedBlock, readManagedBlock } from "./file-utils.js";
import { capture } from "../../../lib/subprocess.js";
import type { ConfigProvider, ConfigChange } from "./types.js";

const SSH_CONFIG_PATH = join(homedir(), ".ssh", "config");
const SSH_SOCKETS_DIR = join(homedir(), ".ssh", "sockets");

const SSH_CONFIG_LINES = [
  "Host *",
  "    ControlMaster auto",
  "    ControlPath ~/.ssh/sockets/%r@%h-%p",
  "    ControlPersist 600",
  "    ServerAliveInterval 60",
  "    ServerAliveCountMax 3",
  "    Compression yes",
  "    AddKeysToAgent yes",
];

export const sshDefaultsProvider: ConfigProvider = {
  name: "SSH config",
  category: "ssh",
  roles: ["workbench", "site", "factory"],

  async detect(): Promise<ConfigChange[]> {
    // Windows: different approach (SSH agent service)
    if (process.platform === "win32") {
      return [await detectWindowsSshAgent()];
    }

    // macOS + Linux: ControlMaster config
    const changes: ConfigChange[] = [];

    // Check sockets directory
    const socketsExist = existsSync(SSH_SOCKETS_DIR);
    changes.push({
      id: "ssh:sockets-dir",
      category: "ssh",
      description: "Create ~/.ssh/sockets/ directory",
      target: SSH_SOCKETS_DIR,
      currentValue: socketsExist ? "exists" : null,
      proposedValue: "exists",
      alreadyApplied: socketsExist,
      requiresSudo: false,
      platform: null,
      apply: async () => {
        try {
          mkdirSync(SSH_SOCKETS_DIR, { recursive: true });
          chmodSync(SSH_SOCKETS_DIR, 0o700);
          return true;
        } catch {
          return false;
        }
      },
    });

    // Check SSH config block
    const currentBlock = readManagedBlock(SSH_CONFIG_PATH);
    const applied = currentBlock !== null &&
      SSH_CONFIG_LINES.every((line) => currentBlock.includes(line));

    changes.push({
      id: "ssh:controlmaster",
      category: "ssh",
      description: "Host * ControlMaster + ControlPersist + ServerAlive + Compression",
      target: SSH_CONFIG_PATH,
      currentValue: currentBlock ? "configured" : null,
      proposedValue: "ControlMaster auto, ControlPersist 600",
      alreadyApplied: applied,
      requiresSudo: false,
      platform: null,
      apply: async () => upsertManagedBlock(SSH_CONFIG_PATH, SSH_CONFIG_LINES),
    });

    return changes;
  },
};

async function detectWindowsSshAgent(): Promise<ConfigChange> {
  const result = await capture(["powershell", "-Command", "(Get-Service ssh-agent).Status"]);
  const running = result.exitCode === 0 && result.stdout.trim() === "Running";

  return {
    id: "ssh:agent-service",
    category: "ssh",
    description: "Enable and start SSH agent service",
    target: "ssh-agent service",
    currentValue: running ? "Running" : null,
    proposedValue: "Running",
    alreadyApplied: running,
    requiresSudo: false,
    platform: "win32",
    apply: async () => {
      const r1 = await capture(["powershell", "-Command", "Set-Service ssh-agent -StartupType Automatic"]);
      const r2 = await capture(["powershell", "-Command", "Start-Service ssh-agent"]);
      return r1.exitCode === 0 && r2.exitCode === 0;
    },
  };
}
