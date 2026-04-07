import { existsSync, readFileSync } from "node:fs";
import { capture } from "../../../lib/subprocess.js";
import { sudoWrite, sudoExec } from "./file-utils.js";
import { detectPlatform } from "./platform.js";
import type { ConfigProvider, ConfigChange } from "./types.js";

// Linux sysctl defaults
const SYSCTL_CONF_PATH = "/etc/sysctl.d/dx-dev.conf";
const SYSCTL_CONTENT = [
  "fs.inotify.max_user_watches=524288",
  "fs.inotify.max_user_instances=1024",
  "vm.swappiness=10",
].join("\n") + "\n";

// Linux ulimits
const LIMITS_CONF_PATH = "/etc/security/limits.d/dx-dev.conf";
const LIMITS_CONTENT = [
  "*    soft    nofile    65536",
  "*    hard    nofile    65536",
].join("\n") + "\n";

export const systemDefaultsProvider: ConfigProvider = {
  name: "System limits",
  category: "system",
  roles: ["workbench", "site", "factory"],

  async detect(): Promise<ConfigChange[]> {
    if (process.platform === "darwin") return detectDarwin();
    if (process.platform === "linux") return detectLinux();
    // Windows: no system limit changes
    return [];
  },
};

async function detectDarwin(): Promise<ConfigChange[]> {
  // macOS: launchctl maxfiles
  const result = await capture(["launchctl", "limit", "maxfiles"]);
  const current = result.exitCode === 0 ? result.stdout.trim() : null;
  const alreadyHigh = current !== null && /65536/.test(current);

  return [{
    id: "system:maxfiles",
    category: "system",
    description: "launchctl limit maxfiles 65536 200000",
    target: "launchctl",
    currentValue: current,
    proposedValue: "65536 200000",
    alreadyApplied: alreadyHigh,
    requiresSudo: true,
    platform: "darwin",
    apply: async () => {
      const r = sudoExec("launchctl", ["limit", "maxfiles", "65536", "200000"]);
      return r.status === 0;
    },
  }];
}

async function detectLinux(): Promise<ConfigChange[]> {
  const { isWSL } = detectPlatform();
  const changes: ConfigChange[] = [];

  // sysctl.d config — skip in WSL (kernel params controlled by .wslconfig)
  if (!isWSL) {
    const sysctlExists = existsSync(SYSCTL_CONF_PATH);
    const sysctlMatch = sysctlExists && readFileSync(SYSCTL_CONF_PATH, "utf8") === SYSCTL_CONTENT;

    changes.push({
      id: "system:sysctl",
      category: "system",
      description: "inotify watches=524288, instances=1024, swappiness=10",
      target: SYSCTL_CONF_PATH,
      currentValue: sysctlExists ? "configured" : null,
      proposedValue: SYSCTL_CONTENT.trim(),
      alreadyApplied: sysctlMatch,
      requiresSudo: true,
      platform: "linux",
      apply: async () => {
        if (!sudoWrite(SYSCTL_CONF_PATH, SYSCTL_CONTENT)) return false;
        const reload = sudoExec("sysctl", ["--system"]);
        return reload.status === 0;
      },
    });
  }

  // limits.d config
  const limitsExists = existsSync(LIMITS_CONF_PATH);
  const limitsMatch = limitsExists && readFileSync(LIMITS_CONF_PATH, "utf8") === LIMITS_CONTENT;

  changes.push({
    id: "system:limits",
    category: "system",
    description: "nofile soft/hard 65536",
    target: LIMITS_CONF_PATH,
    currentValue: limitsExists ? "configured" : null,
    proposedValue: LIMITS_CONTENT.trim(),
    alreadyApplied: limitsMatch,
    requiresSudo: true,
    platform: "linux",
    apply: async () => {
      return sudoWrite(LIMITS_CONF_PATH, LIMITS_CONTENT);
    },
  });

  return changes;
}
