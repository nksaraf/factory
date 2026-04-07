import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendIfMissing } from "./file-utils.js";
import type { ConfigProvider, ConfigChange } from "./types.js";

const PSQLRC_PATH = join(homedir(), ".psqlrc");

const PSQL_DEFAULTS = [
  "\\pset null '(null)'",
  "\\pset linestyle unicode",
  "\\pset border 2",
  "\\x auto",
  "\\timing on",
  "\\set HISTSIZE 10000",
  "\\set ON_ERROR_ROLLBACK interactive",
];

export const psqlDefaultsProvider: ConfigProvider = {
  name: "psql defaults (~/.psqlrc)",
  category: "psql",
  roles: ["workbench"],

  async detect(): Promise<ConfigChange[]> {
    const existing = existsSync(PSQLRC_PATH)
      ? new Set(readFileSync(PSQLRC_PATH, "utf8").split("\n").map((l) => l.trim()))
      : new Set<string>();

    return PSQL_DEFAULTS.map((line) => {
      // Use first word as the identifier
      const key = line.split(/\s+/).slice(0, 2).join(" ");
      return {
        id: `psql:${key}`,
        category: "psql" as const,
        description: line,
        target: PSQLRC_PATH,
        currentValue: existing.has(line) ? line : null,
        proposedValue: line,
        alreadyApplied: existing.has(line),
        requiresSudo: false,
        platform: null,
        apply: async () => appendIfMissing(PSQLRC_PATH, [line]),
      };
    });
  },
};
