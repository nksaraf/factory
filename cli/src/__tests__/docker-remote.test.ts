import { describe, expect, it } from "vitest";
import { buildSshArgs, buildTarget, type MachineTarget } from "../handlers/docker-remote.js";

function makeTarget(overrides: Partial<MachineTarget> = {}): MachineTarget {
  return {
    name: "test-host",
    kind: "host",
    host: "10.0.0.1",
    port: 22,
    user: "root",
    dockerHost: "ssh://root@10.0.0.1",
    source: "factory",
    ...overrides,
  };
}

describe("buildTarget", () => {
  it("sets dockerHost to ssh://user@host for standard targets", () => {
    const target = buildTarget({
      name: "my-host",
      kind: "host",
      host: "10.0.0.1",
      port: 22,
      user: "root",
      source: "factory",
    });

    expect(target.dockerHost).toBe("ssh://root@10.0.0.1");
  });

  it("includes port in dockerHost when not 22", () => {
    const target = buildTarget({
      name: "my-host",
      kind: "host",
      host: "10.0.0.1",
      port: 2222,
      user: "ubuntu",
      source: "factory",
    });

    expect(target.dockerHost).toBe("ssh://ubuntu@10.0.0.1:2222");
  });

  it("uses ssh://<slug> when jumpHost is configured", () => {
    const target = buildTarget({
      name: "bastion-target",
      kind: "host",
      host: "10.0.0.1",
      port: 22,
      user: "root",
      source: "factory",
      jumpHost: "bastion.example.com",
    });

    expect(target.dockerHost).toBe("ssh://bastion-target");
  });

  it("uses ssh://<slug> even with custom port when jumpHost is set", () => {
    const target = buildTarget({
      name: "internal-host",
      kind: "host",
      host: "192.168.1.10",
      port: 2222,
      user: "deploy",
      source: "factory",
      jumpHost: "bastion.example.com",
      jumpUser: "jump",
      jumpPort: 443,
    });

    // Port/user are NOT in dockerHost — Docker reads them from SSH config
    expect(target.dockerHost).toBe("ssh://internal-host");
  });

  it("preserves all fields in the returned target", () => {
    const target = buildTarget({
      name: "my-host",
      kind: "host",
      host: "10.0.0.1",
      port: 22,
      user: "root",
      source: "factory",
      jumpHost: "bastion.example.com",
      jumpUser: "admin",
      jumpPort: 2222,
      identityFile: "/keys/id_ed25519",
    });

    expect(target.jumpHost).toBe("bastion.example.com");
    expect(target.jumpUser).toBe("admin");
    expect(target.jumpPort).toBe(2222);
    expect(target.identityFile).toBe("/keys/id_ed25519");
    expect(target.name).toBe("my-host");
    expect(target.host).toBe("10.0.0.1");
  });
});

describe("buildSshArgs", () => {
  it("builds basic args without jump host", () => {
    const args = buildSshArgs(makeTarget());

    expect(args).toContain("-o");
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain("root@10.0.0.1");
    expect(args).not.toContain("-J");
    expect(args).not.toContain("-i");
    expect(args).not.toContain("-p");
  });

  it("includes -J flag with formatted jump spec", () => {
    const args = buildSshArgs(makeTarget({
      jumpHost: "bastion.internal",
      jumpUser: "admin",
      jumpPort: 2222,
    }));

    const jIdx = args.indexOf("-J");
    expect(jIdx).toBeGreaterThanOrEqual(0);
    expect(args[jIdx + 1]).toBe("admin@bastion.internal:2222");
  });

  it("includes -i flag for identity file", () => {
    const args = buildSshArgs(makeTarget({
      identityFile: "/home/user/.ssh/deploy_key",
    }));

    const iIdx = args.indexOf("-i");
    expect(iIdx).toBeGreaterThanOrEqual(0);
    expect(args[iIdx + 1]).toBe("/home/user/.ssh/deploy_key");
  });

  it("includes -p for non-22 ports", () => {
    const args = buildSshArgs(makeTarget({ port: 2222 }));

    const pIdx = args.indexOf("-p");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    expect(args[pIdx + 1]).toBe("2222");
  });

  it("omits -p for port 22", () => {
    const args = buildSshArgs(makeTarget({ port: 22 }));
    expect(args).not.toContain("-p");
  });

  it("combines all options: jump + identity + port", () => {
    const args = buildSshArgs(makeTarget({
      port: 2222,
      user: "deploy",
      jumpHost: "bastion.example.com",
      jumpUser: "jump",
      jumpPort: 443,
      identityFile: "/keys/id_ed25519",
    }));

    expect(args[args.indexOf("-J") + 1]).toBe("jump@bastion.example.com:443");
    expect(args[args.indexOf("-i") + 1]).toBe("/keys/id_ed25519");
    expect(args[args.indexOf("-p") + 1]).toBe("2222");
    expect(args).toContain("deploy@10.0.0.1");
  });
});
