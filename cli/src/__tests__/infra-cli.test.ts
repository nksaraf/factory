import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDx } from "./run-dx.js";

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-infra-test-"));
}

describe("dx infra CLI", () => {
  // ---- Help / registration ----
  it("dx infra --help lists all subcommands", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["infra", "--help"], { home });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("providers");
    expect(stdout).toContain("regions");
    expect(stdout).toContain("clusters");
    expect(stdout).toContain("vms");
    expect(stdout).toContain("hosts");
    expect(stdout).toContain("kube-nodes");
    expect(stdout).toContain("subnets");
    expect(stdout).toContain("ips");
    expect(stdout).toContain("assets");
  });

  it("dx infra providers --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "providers", "--help"], {
      home,
    });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("sync");
  });

  it("dx infra regions --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "regions", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("delete");
  });

  it("dx infra clusters --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "clusters", "--help"], {
      home,
    });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("destroy");
  });

  it("dx infra vms --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "vms", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("restart");
    expect(stdout).toContain("snapshot");
    expect(stdout).toContain("destroy");
  });

  it("dx infra hosts --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "hosts", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("add");
    expect(stdout).toContain("remove");
  });

  it("dx infra kube-nodes --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "kube-nodes", "--help"], {
      home,
    });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("add");
    expect(stdout).toContain("remove");
    expect(stdout).toContain("pause");
    expect(stdout).toContain("resume");
    expect(stdout).toContain("evacuate");
  });

  it("dx infra subnets --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "subnets", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("delete");
  });

  it("dx infra ips --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "ips", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("available");
    expect(stdout).toContain("stats");
    expect(stdout).toContain("register");
    expect(stdout).toContain("assign");
    expect(stdout).toContain("release");
    expect(stdout).toContain("lookup");
  });

  it("dx infra assets --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "assets", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
  });
});
