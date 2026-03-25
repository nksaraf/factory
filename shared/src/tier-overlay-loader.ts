import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { tierOverlaySchema } from "./connection-context-schemas";

const TIERS_DIR = join(".dx", "tiers");

/** Load a tier overlay file (.dx/tiers/{tier}.yaml). Returns env map or null if not found. */
export function loadTierOverlay(
  rootDir: string,
  tier: string
): Record<string, string> | null {
  const path = join(rootDir, TIERS_DIR, `${tier}.yaml`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parseYaml(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    const result = tierOverlaySchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data.env;
  } catch {
    return null;
  }
}

/** List available tier names by scanning .dx/tiers/*.yaml. */
export function listTiers(rootDir: string): string[] {
  const dir = join(rootDir, TIERS_DIR);
  if (!existsSync(dir)) return [];
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir)
      .filter((f: string) => f.endsWith(".yaml"))
      .map((f: string) => f.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}
