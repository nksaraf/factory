import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  listConnectionProfiles,
  loadConnectionProfile,
  loadNormalizedProfile,
} from "./connection-profile-loader";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `profile-test-${Date.now()}`);
  mkdirSync(join(testDir, ".dx", "profiles"), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadConnectionProfile", () => {
  test("loads profile with shorthand entries", () => {
    writeFileSync(
      join(testDir, ".dx", "profiles", "staging-deps.yaml"),
      'description: "Connect to staging"\nconnect:\n  postgres: staging\n  redis: staging\n'
    );
    const profile = loadConnectionProfile(testDir, "staging-deps");
    expect(profile).not.toBeNull();
    expect(profile!.description).toBe("Connect to staging");
    expect(profile!.connect.postgres).toBe("staging");
    expect(profile!.connect.redis).toBe("staging");
  });

  test("loads profile with object entries", () => {
    writeFileSync(
      join(testDir, ".dx", "profiles", "prod-debug.yaml"),
      "connect:\n  postgres:\n    target: production\n    readonly: true\n    backend: kubectl\n"
    );
    const profile = loadConnectionProfile(testDir, "prod-debug");
    expect(profile).not.toBeNull();
    expect(profile!.connect.postgres).toEqual({
      target: "production",
      readonly: true,
      backend: "kubectl",
    });
  });

  test("returns null for missing profile", () => {
    expect(loadConnectionProfile(testDir, "nonexistent")).toBeNull();
  });

  test("returns null for invalid profile", () => {
    writeFileSync(
      join(testDir, ".dx", "profiles", "bad.yaml"),
      "not a valid profile"
    );
    expect(loadConnectionProfile(testDir, "bad")).toBeNull();
  });
});

describe("loadNormalizedProfile", () => {
  test("normalizes mixed shorthand and object entries", () => {
    writeFileSync(
      join(testDir, ".dx", "profiles", "mixed.yaml"),
      "connect:\n  postgres:\n    target: production\n    readonly: true\n  redis: staging\n"
    );
    const result = loadNormalizedProfile(testDir, "mixed");
    expect(result).not.toBeNull();
    expect(result!.postgres).toEqual({
      target: "production",
      readonly: true,
      backend: "direct",
    });
    expect(result!.redis).toEqual({
      target: "staging",
      readonly: false,
      backend: "direct",
    });
  });

  test("returns null for missing profile", () => {
    expect(loadNormalizedProfile(testDir, "nonexistent")).toBeNull();
  });
});

describe("listConnectionProfiles", () => {
  test("lists available profiles", () => {
    writeFileSync(join(testDir, ".dx", "profiles", "staging.yaml"), "connect: {}\n");
    writeFileSync(join(testDir, ".dx", "profiles", "prod.yaml"), "connect: {}\n");
    const profiles = listConnectionProfiles(testDir);
    expect(profiles.sort()).toEqual(["prod", "staging"]);
  });

  test("returns empty array when no profiles dir", () => {
    rmSync(join(testDir, ".dx", "profiles"), { recursive: true });
    expect(listConnectionProfiles(testDir)).toEqual([]);
  });
});
