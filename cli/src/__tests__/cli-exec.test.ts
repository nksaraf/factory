import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { runDx } from "./run-dx.js";

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-cli-test-"));
}

function writeDxConfig(home: string, yaml: string): void {
  const dir = path.join(home, ".config", "dx");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.yaml"), yaml, "utf8");
}

describe("dx CLI (subprocess)", () => {
  it("prints help", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["--help"], { home });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Software Factory CLI");
    expect(stdout).toContain("dx");
  });

  it("stub command prints NYI message", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["module", "list"], { home });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Not yet implemented");
  });

  it("stub command --json prints NYI payload and exits 1", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["module", "list", "--json"], {
      home,
    });
    expect(status).toBe(ExitCodes.GENERAL_FAILURE);
    expect(stderr).toBe("");
    const body = JSON.parse(stdout) as {
      success: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("NYI");
  });

  it("auth logout with no session", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["auth", "logout"], { home });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("No local session was stored.");
  });

  it("auth logout --json with no session", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["auth", "logout", "--json"], {
      home,
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const body = JSON.parse(stdout) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("whoami with no session writes to stderr and exits 3", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["whoami"], { home });
    expect(status).toBe(ExitCodes.AUTH_FAILURE);
    expect(stdout).toBe("");
    expect(stderr).toContain("Not signed in");
  });

  it("whoami --json with no session", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["whoami", "--json"], { home });
    expect(status).toBe(ExitCodes.AUTH_FAILURE);
    expect(stderr).toBe("");
    const body = JSON.parse(stdout) as {
      success: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("AUTH_DENIED");
  });

  it("status when API is unreachable (stderr)", () => {
    const home = isolatedHome();
    writeDxConfig(home, "apiUrl: http://127.0.0.1:59999\n");
    const { status, stdout, stderr } = runDx(["status"], { home });
    expect(status).toBe(ExitCodes.CONNECTION_FAILURE);
    expect(stdout).toBe("");
    expect(stderr).toContain("Could not reach Factory API");
  });

  it("status --json when API is unreachable", () => {
    const home = isolatedHome();
    writeDxConfig(home, "apiUrl: http://127.0.0.1:59999\n");
    const { status, stdout, stderr } = runDx(["status", "--json"], { home });
    expect(status).toBe(ExitCodes.CONNECTION_FAILURE);
    expect(stderr).toBe("");
    const body = JSON.parse(stdout) as {
      success: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("API_UNREACHABLE");
  });
});
