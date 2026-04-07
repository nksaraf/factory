import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { runDx } from "./run-dx.js";

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-cli-usage-"));
}

function writeMinimalConfig(home: string): void {
  const dir = path.join(home, ".config", "dx");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "config.yaml"),
    "apiUrl: http://127.0.0.1:59999\n",
    "utf8"
  );
}

const clearAuthEnv = {
  DX_AUTH_EMAIL: "",
  DX_AUTH_PASSWORD: "",
  FACTORY_AUTH_EMAIL: "",
  FACTORY_AUTH_PASSWORD: "",
};

describe("dx CLI auth usage errors", () => {
  it("factory login --json exits USAGE_ERROR when email is empty after prompt", () => {
    const home = isolatedHome();
    writeMinimalConfig(home);

    const { status, stdout, stderr } = runDx(["factory", "login", "--json"], {
      home,
      env: clearAuthEnv,
      input: "\n",
    });

    expect(status).toBe(ExitCodes.USAGE_ERROR);
    expect(stderr).toBe("");
    const jsonStart = stdout.indexOf("{");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(stdout.slice(jsonStart)) as {
      success: boolean;
      error?: { code?: string; message?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("AUTH_DENIED");
    expect(body.error?.message).toContain("Email is required");
  });
});
