import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import { TunnelManager } from "./tunnel-manager.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `tunnel-test-${Date.now()}`);
  mkdirSync(join(testDir, ".dx"), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const directSpec: TunnelSpec = {
  name: "postgres",
  localPort: 15432,
  remoteHost: "staging-postgres",
  remotePort: 5432,
  backend: "direct",
  connectionString: "postgresql://staging:5432/db",
};

const directSpec2: TunnelSpec = {
  name: "redis",
  localPort: 16379,
  remoteHost: "staging-redis",
  remotePort: 6379,
  backend: "direct",
};

describe("TunnelManager", () => {
  test("startAll with direct backend succeeds", async () => {
    const mgr = new TunnelManager(testDir);
    const handles = await mgr.startAll([directSpec, directSpec2]);
    expect(handles).toHaveLength(2);
    expect(handles[0].status).toBe("healthy");
    expect(handles[1].status).toBe("healthy");
  });

  test("persists state to .dx/.tunnels.yaml", async () => {
    const mgr = new TunnelManager(testDir);
    await mgr.startAll([directSpec]);
    expect(existsSync(join(testDir, ".dx", ".tunnels.yaml"))).toBe(true);
  });

  test("getStatus returns tunnel info", async () => {
    const mgr = new TunnelManager(testDir);
    await mgr.startAll([directSpec]);
    const status = mgr.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe("postgres");
    expect(status[0].backend).toBe("direct");
    expect(status[0].status).toBe("healthy");
  });

  test("getStatus reads from state file when no active handles", async () => {
    const mgr1 = new TunnelManager(testDir);
    await mgr1.startAll([directSpec]);

    // New manager instance reads state from file
    const mgr2 = new TunnelManager(testDir);
    const status = mgr2.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe("postgres");
  });

  test("stopAll clears handles and state", async () => {
    const mgr = new TunnelManager(testDir);
    await mgr.startAll([directSpec]);
    await mgr.stopAll();
    expect(mgr.getStatus()).toEqual([]);
    expect(existsSync(join(testDir, ".dx", ".tunnels.yaml"))).toBe(false);
  });

  test("throws for unknown backend", async () => {
    const mgr = new TunnelManager(testDir);
    const badSpec: TunnelSpec = {
      ...directSpec,
      backend: "kubectl",
    };
    await expect(mgr.startAll([badSpec])).rejects.toThrow('No backend registered for "kubectl"');
  });
});
