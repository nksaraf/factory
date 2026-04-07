import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendIfMissing } from "./file-utils.js";
import type { ConfigProvider, ConfigChange } from "./types.js";

const CURLRC_PATH = join(homedir(), ".curlrc");

const CURL_DEFAULTS = [
  "--connect-timeout 10",
  "--max-time 300",
  "--retry 3",
  "--retry-delay 2",
  "-L",
];

export const curlDefaultsProvider: ConfigProvider = {
  name: "curl defaults (~/.curlrc)",
  category: "curl",
  roles: ["workbench"],

  async detect(): Promise<ConfigChange[]> {
    const existing = existsSync(CURLRC_PATH)
      ? new Set(readFileSync(CURLRC_PATH, "utf8").split("\n").map((l) => l.trim()))
      : new Set<string>();

    return CURL_DEFAULTS.map((line) => ({
      id: `curl:${line.split(" ")[0]}`,
      category: "curl" as const,
      description: line,
      target: CURLRC_PATH,
      currentValue: existing.has(line) ? line : null,
      proposedValue: line,
      alreadyApplied: existing.has(line),
      requiresSudo: false,
      platform: null,
      apply: async () => appendIfMissing(CURLRC_PATH, [line]),
    }));
  },
};
