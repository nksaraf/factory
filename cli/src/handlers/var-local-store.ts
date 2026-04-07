/**
 * Local variable store at ~/.config/dx/vars.json.
 *
 * Stores variables as a flat Record<string, string> in a JSON file.
 * File permissions set to 0644 (world-readable, owner-writable).
 * Used as a fallback when not connected to Factory API.
 */

import fs from "node:fs";
import path from "node:path";
import { configDir } from "@crustjs/store";

const DX_CONFIG_DIR = configDir("dx");
const VARS_FILE = path.join(DX_CONFIG_DIR, "vars.json");

function ensureDir(): void {
  fs.mkdirSync(DX_CONFIG_DIR, { recursive: true });
}

function readAll(): Record<string, string> {
  try {
    const raw = fs.readFileSync(VARS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(vars: Record<string, string>): void {
  ensureDir();
  fs.writeFileSync(VARS_FILE, JSON.stringify(vars, null, 2), {
    mode: 0o600,
  });
}

export function localVarSet(key: string, value: string): void {
  const vars = readAll();
  vars[key] = value;
  writeAll(vars);
}

export function localVarGet(key: string): string | undefined {
  return readAll()[key];
}

export function localVarList(): Array<{ key: string; value: string }> {
  const vars = readAll();
  return Object.entries(vars).map(([key, value]) => ({ key, value }));
}

export function localVarRemove(key: string): boolean {
  const vars = readAll();
  if (!(key in vars)) return false;
  delete vars[key];
  writeAll(vars);
  return true;
}

/** Load all local variables as a flat env-compatible record. */
export function loadLocalVars(): Record<string, string> {
  return readAll();
}
