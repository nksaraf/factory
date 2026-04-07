import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { detectPlatform } from "./platform.js";

/**
 * Write content to a path that may require elevated privileges.
 * Uses `sudo tee` when not root, direct write when root.
 */
export function sudoWrite(filePath: string, content: string): boolean {
  const { os, elevated } = detectPlatform();
  const dir = dirname(filePath);

  // Windows or already elevated: write directly, no sudo
  if (os === "win32" || elevated) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content);
      return true;
    } catch {
      return false;
    }
  }

  // Unix non-root: use sudo
  spawnSync("sudo", ["mkdir", "-p", dir], { encoding: "utf8" });
  const result = spawnSync("sudo", ["tee", filePath], {
    input: content, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  return result.status === 0;
}

/**
 * Run a command that may require sudo. Strips sudo when running as root.
 */
export function sudoExec(cmd: string, args: string[]): { status: number | null; stdout: string } {
  const { os, elevated } = detectPlatform();

  // Windows or already elevated: run directly, no sudo
  if (os === "win32" || elevated) {
    const result = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout };
  }

  const result = spawnSync("sudo", [cmd, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

/**
 * Upsert a key=value pair in an ini-style dotfile (like .npmrc, .curlrc).
 * If the key exists, update its value. If not, append it.
 * Preserves comments, blank lines, and unrelated entries.
 */
export function upsertDotfile(filePath: string, key: string, value: string): boolean {
  try {
    ensureParentDir(filePath);
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const lines = existing.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed.startsWith("#") || trimmed.startsWith(";") || !trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
        lines[i] = `${key}=${value}`;
        found = true;
        break;
      }
    }

    if (!found) {
      // Ensure trailing newline before appending
      if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
        lines.push("");
      }
      lines.push(`${key}=${value}`);
    }

    writeFileSync(filePath, lines.join("\n"), "utf8");
    return true;
  } catch {
    return false;
  }
}

const DX_MARKER_BEGIN = "# --- BEGIN dx-managed ---";
const DX_MARKER_END = "# --- END dx-managed ---";

/**
 * Upsert lines in a file using dx-managed block markers.
 * On first run, appends a marked block. On re-runs, replaces the block contents.
 * Lines outside the block are never touched.
 */
export function upsertManagedBlock(filePath: string, lines: string[]): boolean {
  try {
    ensureParentDir(filePath);
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const fileLines = existing.split("\n");

    const beginIdx = fileLines.indexOf(DX_MARKER_BEGIN);
    const endIdx = fileLines.indexOf(DX_MARKER_END);

    const block = [DX_MARKER_BEGIN, ...lines, DX_MARKER_END];

    if (beginIdx >= 0 && endIdx > beginIdx) {
      // Replace existing block
      fileLines.splice(beginIdx, endIdx - beginIdx + 1, ...block);
    } else {
      // Append new block with a blank line separator
      if (fileLines.length > 0 && fileLines[fileLines.length - 1]!.trim() !== "") {
        fileLines.push("");
      }
      fileLines.push(...block);
    }

    writeFileSync(filePath, fileLines.join("\n"), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the current dx-managed block from a file.
 * Returns the lines between the markers, or null if no block exists.
 */
export function readManagedBlock(filePath: string): string[] | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const beginIdx = lines.indexOf(DX_MARKER_BEGIN);
  const endIdx = lines.indexOf(DX_MARKER_END);
  if (beginIdx < 0 || endIdx <= beginIdx) return null;
  return lines.slice(beginIdx + 1, endIdx);
}

/**
 * Append lines to a file if they are not already present (line-by-line check).
 * Does NOT use managed blocks — for simple append-if-missing semantics.
 */
export function appendIfMissing(filePath: string, lines: string[]): boolean {
  try {
    ensureParentDir(filePath);
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const existingLines = new Set(existing.split("\n").map((l) => l.trim()));

    const toAdd = lines.filter((l) => !existingLines.has(l.trim()));
    if (toAdd.length === 0) return true;

    const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
    writeFileSync(filePath, existing + sep + toAdd.join("\n") + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep-merge a JSON config file with proposed values.
 * Reads existing JSON, deep merges proposed, writes back.
 * Never removes existing keys — only adds or updates.
 */
export function deepMergeJsonConfig(filePath: string, proposed: Record<string, unknown>): boolean {
  try {
    ensureParentDir(filePath);
    const existing: Record<string, unknown> = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, "utf8"))
      : {};

    const merged = deepMerge(existing, proposed);
    writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a JSON config file, returning an empty object if it doesn't exist or is invalid.
 */
export function readJsonConfig(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Create a file with content if it doesn't exist. Does nothing if it already exists.
 */
export function ensureFileExists(filePath: string, content: string): boolean {
  try {
    if (existsSync(filePath)) return true;
    ensureParentDir(filePath);
    writeFileSync(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
