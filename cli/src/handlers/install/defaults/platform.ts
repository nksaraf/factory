import { existsSync, readFileSync } from "node:fs";

export interface PlatformInfo {
  os: "darwin" | "linux" | "win32";
  isWSL: boolean;
  elevated: boolean;
}

let cached: PlatformInfo | undefined;

/** Detect platform info. Cached for process lifetime. */
export function detectPlatform(): PlatformInfo {
  if (cached) return cached;

  const os = process.platform as "darwin" | "linux" | "win32";

  const isWSL =
    os === "linux" &&
    existsSync("/proc/version") &&
    readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");

  const elevated =
    os === "win32" ? false : (process.getuid?.() === 0);

  cached = { os, isWSL, elevated };
  return cached;
}
