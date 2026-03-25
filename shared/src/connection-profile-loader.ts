import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  connectionProfileSchema,
  normalizeProfileEntry,
  type ConnectionProfile,
  type NormalizedProfileEntry,
} from "./connection-context-schemas";

const PROFILES_DIR = join(".dx", "profiles");

/** Load a connection profile (.dx/profiles/{name}.yaml). Returns null if not found or invalid. */
export function loadConnectionProfile(
  rootDir: string,
  profileName: string
): ConnectionProfile | null {
  const path = join(rootDir, PROFILES_DIR, `${profileName}.yaml`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parseYaml(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    const result = connectionProfileSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

/** Load and normalize a profile into a map of dep → { target, readonly, backend }. */
export function loadNormalizedProfile(
  rootDir: string,
  profileName: string
): Record<string, NormalizedProfileEntry> | null {
  const profile = loadConnectionProfile(rootDir, profileName);
  if (!profile) return null;
  const result: Record<string, NormalizedProfileEntry> = {};
  for (const [key, entry] of Object.entries(profile.connect)) {
    result[key] = normalizeProfileEntry(entry);
  }
  return result;
}

/** List available connection profile names by scanning .dx/profiles/*.yaml. */
export function listConnectionProfiles(rootDir: string): string[] {
  const dir = join(rootDir, PROFILES_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}
