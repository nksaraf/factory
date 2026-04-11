import { describe, expect, it } from "bun:test"

import { buildSshArgs, formatJumpSpec } from "../lib/ssh-utils.js"

describe("formatJumpSpec", () => {
  it("returns host only when no user or port", () => {
    expect(formatJumpSpec("bastion.example.com")).toBe("bastion.example.com")
  })

  it("prepends user@ when user is provided", () => {
    expect(formatJumpSpec("bastion.example.com", "admin")).toBe(
      "admin@bastion.example.com"
    )
  })

  it("appends :port when port is provided", () => {
    expect(formatJumpSpec("bastion.example.com", undefined, 2222)).toBe(
      "bastion.example.com:2222"
    )
  })

  it("includes both user and port", () => {
    expect(formatJumpSpec("bastion.example.com", "admin", 2222)).toBe(
      "admin@bastion.example.com:2222"
    )
  })

  it("omits port when port is 0 (falsy)", () => {
    expect(formatJumpSpec("bastion.example.com", "admin", 0)).toBe(
      "admin@bastion.example.com"
    )
  })
})

describe("buildSshArgs", () => {
  it("builds basic SSH args without jump host", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      port: 22,
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
    })

    expect(args).toContain("-T")
    expect(args).toContain("root@10.0.0.1")
    expect(args).not.toContain("-J")
    expect(args).not.toContain("-p")
  })

  it("includes -J flag when jumpHost is set", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      user: "ubuntu",
      tty: "none",
      hostKeyCheck: "none",
      jumpHost: "bastion.example.com",
    })

    const jIdx = args.indexOf("-J")
    expect(jIdx).toBeGreaterThanOrEqual(0)
    expect(args[jIdx + 1]).toBe("bastion.example.com")
  })

  it("formats jump spec with user and port", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      user: "ubuntu",
      tty: "none",
      hostKeyCheck: "none",
      jumpHost: "bastion.example.com",
      jumpUser: "jumpuser",
      jumpPort: 2222,
    })

    const jIdx = args.indexOf("-J")
    expect(args[jIdx + 1]).toBe("jumpuser@bastion.example.com:2222")
  })

  it("includes -i flag when identity is set", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
      identity: "/home/user/.ssh/id_ed25519",
    })

    const iIdx = args.indexOf("-i")
    expect(iIdx).toBeGreaterThanOrEqual(0)
    expect(args[iIdx + 1]).toBe("/home/user/.ssh/id_ed25519")
  })

  it("includes -p flag for non-22 ports", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      port: 2222,
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
    })

    const pIdx = args.indexOf("-p")
    expect(pIdx).toBeGreaterThanOrEqual(0)
    expect(args[pIdx + 1]).toBe("2222")
  })

  it("omits -p flag for port 22", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      port: 22,
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
    })

    expect(args).not.toContain("-p")
  })

  it("places -J before the target so SSH processes it first", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
      jumpHost: "bastion.example.com",
    })

    const jIdx = args.indexOf("-J")
    const targetIdx = args.indexOf("root@10.0.0.1")
    expect(jIdx).toBeLessThan(targetIdx)
  })

  it("combines jump host, identity, and custom port", () => {
    const args = buildSshArgs({
      host: "10.0.0.1",
      port: 2222,
      user: "deploy",
      tty: "basic",
      hostKeyCheck: "strict",
      identity: "/keys/deploy_key",
      jumpHost: "bastion.internal",
      jumpUser: "jump",
      jumpPort: 443,
    })

    expect(args).toContain("-t")
    expect(args).toContain("-J")
    expect(args[args.indexOf("-J") + 1]).toBe("jump@bastion.internal:443")
    expect(args).toContain("-i")
    expect(args[args.indexOf("-i") + 1]).toBe("/keys/deploy_key")
    expect(args).toContain("-p")
    expect(args[args.indexOf("-p") + 1]).toBe("2222")
    expect(args).toContain("deploy@10.0.0.1")
  })
})
