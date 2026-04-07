import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deepMergeJsonConfig, readJsonConfig, sudoWrite } from "./file-utils.js";
import type { ConfigProvider, ConfigChange } from "./types.js";

const DOCKER_DEFAULTS = {
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-ulimits": {
    nofile: { Name: "nofile", Hard: 65536, Soft: 65536 },
  },
  features: { buildkit: true },
  builder: { gc: { enabled: true, defaultKeepStorage: "20GB" } },
};

function getDaemonJsonPath(): { path: string; requiresSudo: boolean } {
  if (process.platform === "darwin" || process.platform === "win32") {
    // macOS and Windows (Docker Desktop): user-scope config, no elevation needed
    return { path: join(homedir(), ".docker", "daemon.json"), requiresSudo: false };
  }
  // Linux: system-wide config requires sudo
  return { path: "/etc/docker/daemon.json", requiresSudo: true };
}

/** Deep-equal comparison that ignores key order in objects. */
function jsonValueMatch(current: unknown, proposed: unknown): boolean {
  if (current === proposed) return true;
  if (current === null || proposed === null) return current === proposed;
  if (typeof current !== typeof proposed) return false;
  if (typeof current !== "object") return current === proposed;
  if (Array.isArray(current) !== Array.isArray(proposed)) return false;
  if (Array.isArray(current) && Array.isArray(proposed)) {
    if (current.length !== proposed.length) return false;
    return current.every((v, i) => jsonValueMatch(v, proposed[i]));
  }
  const cObj = current as Record<string, unknown>;
  const pObj = proposed as Record<string, unknown>;
  const cKeys = Object.keys(cObj);
  const pKeys = Object.keys(pObj);
  if (cKeys.length !== pKeys.length) return false;
  return cKeys.every((k) => k in pObj && jsonValueMatch(cObj[k], pObj[k]));
}

export const dockerDefaultsProvider: ConfigProvider = {
  name: "Docker daemon defaults",
  category: "docker",
  roles: ["workbench", "site", "factory"],

  async detect(): Promise<ConfigChange[]> {
    const { path: daemonPath, requiresSudo } = getDaemonJsonPath();
    const existing = readJsonConfig(daemonPath);
    const changes: ConfigChange[] = [];

    // Check each top-level key
    for (const [key, value] of Object.entries(DOCKER_DEFAULTS)) {
      const currentVal = existing[key];
      const applied = jsonValueMatch(currentVal, value);

      changes.push({
        id: `docker:${key}`,
        category: "docker",
        description: `${key}: ${JSON.stringify(value)}`,
        target: daemonPath,
        currentValue: currentVal !== undefined ? JSON.stringify(currentVal) : null,
        proposedValue: JSON.stringify(value),
        alreadyApplied: applied,
        requiresSudo,
        platform: null,
        apply: async () => {
          if (requiresSudo) {
            const merged = { ...readJsonConfig(daemonPath), [key]: value };
            const content = JSON.stringify(merged, null, 2) + "\n";
            return sudoWrite(daemonPath, content);
          }
          return deepMergeJsonConfig(daemonPath, { [key]: value });
        },
      });
    }

    return changes;
  },
};
