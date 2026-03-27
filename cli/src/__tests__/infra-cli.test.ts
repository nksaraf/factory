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
    expect(stdout).toContain("provider");
    expect(stdout).toContain("region");
    expect(stdout).toContain("cluster");
    expect(stdout).toContain("vm");
    expect(stdout).toContain("host");
    expect(stdout).toContain("kube-node");
    expect(stdout).toContain("subnet");
    expect(stdout).toContain("ip");
    expect(stdout).toContain("asset");
  });

  it("dx infra provider --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "provider", "--help"], {
      home,
    });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("sync");
  });

  it("dx infra region --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "region", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("delete");
  });

  it("dx infra cluster --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "cluster", "--help"], {
      home,
    });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("destroy");
  });

  it("dx infra vm --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "vm", "--help"], { home });
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

  it("dx infra host --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "host", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("add");
    expect(stdout).toContain("remove");
  });

  it("dx infra kube-node --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "kube-node", "--help"], {
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

  it("dx infra subnet --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "subnet", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("create");
    expect(stdout).toContain("delete");
  });

  it("dx infra ip --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "ip", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("available");
    expect(stdout).toContain("stats");
    expect(stdout).toContain("register");
    expect(stdout).toContain("assign");
    expect(stdout).toContain("release");
    expect(stdout).toContain("lookup");
  });

  it("dx infra asset --help shows subcommands", () => {
    const home = isolatedHome();
    const { status, stdout } = runDx(["infra", "asset", "--help"], { home });
    expect(status).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
  });
});
