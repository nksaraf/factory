import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { listTiers, loadTierOverlay } from "./tier-overlay-loader";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `tier-test-${Date.now()}`);
  mkdirSync(join(testDir, ".dx", "tiers"), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadTierOverlay", () => {
  test("loads valid tier overlay", () => {
    writeFileSync(
      join(testDir, ".dx", "tiers", "staging.yaml"),
      "env:\n  DATABASE_URL: postgresql://staging:5432/db\n  LOG_LEVEL: debug\n"
    );
    const result = loadTierOverlay(testDir, "staging");
    expect(result).toEqual({
      DATABASE_URL: "postgresql://staging:5432/db",
      LOG_LEVEL: "debug",
    });
  });

  test("returns null for missing file", () => {
    const result = loadTierOverlay(testDir, "nonexistent");
    expect(result).toBeNull();
  });

  test("returns null for invalid YAML", () => {
    writeFileSync(
      join(testDir, ".dx", "tiers", "bad.yaml"),
      "not: [valid: tier"
    );
    const result = loadTierOverlay(testDir, "bad");
    expect(result).toBeNull();
  });

  test("returns empty env for tier with no env key", () => {
    writeFileSync(
      join(testDir, ".dx", "tiers", "empty.yaml"),
      "{}\n"
    );
    const result = loadTierOverlay(testDir, "empty");
    expect(result).toEqual({});
  });
});

describe("listTiers", () => {
  test("lists available tier files", () => {
    writeFileSync(join(testDir, ".dx", "tiers", "staging.yaml"), "env: {}\n");
    writeFileSync(join(testDir, ".dx", "tiers", "production.yaml"), "env: {}\n");
    const tiers = listTiers(testDir);
    expect(tiers.sort()).toEqual(["production", "staging"]);
  });

  test("returns empty array when no tiers dir", () => {
    rmSync(join(testDir, ".dx", "tiers"), { recursive: true });
    expect(listTiers(testDir)).toEqual([]);
  });
});
