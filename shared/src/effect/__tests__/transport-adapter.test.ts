import { describe, expect, it } from "bun:test"
import {
  LocalAdapter,
  SshAdapter,
  KubectlAdapter,
  DockerExecAdapter,
  DockerComposeExecAdapter,
  NestedAdapter,
} from "../transport-adapter.js"

describe("LocalAdapter", () => {
  const adapter = new LocalAdapter()

  it("wraps command in bash -c", () => {
    expect(adapter.buildCmd("hostname")).toEqual(["bash", "-c", "hostname"])
  })

  it("passes argv through directly", () => {
    expect(adapter.buildArgv(["ls", "-la"])).toEqual(["ls", "-la"])
  })

  it("escapes arguments with special chars", () => {
    expect(adapter.escapeArg("hello world")).toBe("'hello world'")
  })

  it("passes safe arguments unquoted", () => {
    expect(adapter.escapeArg("hostname")).toBe("hostname")
    expect(adapter.escapeArg("/usr/bin/test")).toBe("/usr/bin/test")
  })

  it("escapes single quotes", () => {
    expect(adapter.escapeArg("it's")).toBe("'it'\\''s'")
  })
})

describe("SshAdapter", () => {
  const simple = new SshAdapter({
    host: "192.168.2.86",
    port: 22,
    user: "lepton",
    jumpChain: [],
  })

  it("builds SSH command with user@host", () => {
    const cmd = simple.buildCmd("hostname")
    expect(cmd[0]).toBe("ssh")
    expect(cmd).toContain("lepton@192.168.2.86")
    expect(cmd[cmd.length - 1]).toBe("hostname")
  })

  it("includes -T flag", () => {
    const cmd = simple.buildCmd("hostname")
    expect(cmd).toContain("-T")
  })

  it("includes BatchMode=yes", () => {
    const cmd = simple.buildCmd("hostname")
    const batchIdx = cmd.indexOf("BatchMode=yes")
    expect(batchIdx).toBeGreaterThan(0)
    expect(cmd[batchIdx - 1]).toBe("-o")
  })

  it("adds jump host with -J", () => {
    const withJump = new SshAdapter({
      host: "192.168.2.86",
      port: 22,
      user: "lepton",
      jumpChain: [{ host: "192.168.1.59", port: 22, user: "lepton" }],
    })
    const cmd = withJump.buildCmd("hostname")
    expect(cmd).toContain("-J")
    const jIdx = cmd.indexOf("-J")
    expect(cmd[jIdx + 1]).toBe("lepton@192.168.1.59")
  })

  it("adds multi-hop jump chain", () => {
    const multiHop = new SshAdapter({
      host: "10.0.0.5",
      port: 22,
      user: "deploy",
      jumpChain: [
        { host: "bastion.example.com", port: 22, user: "jump" },
        { host: "192.168.1.59", port: 2222, user: "lepton" },
      ],
    })
    const cmd = multiHop.buildCmd("hostname")
    const jIdx = cmd.indexOf("-J")
    expect(cmd[jIdx + 1]).toBe(
      "jump@bastion.example.com,lepton@192.168.1.59:2222"
    )
  })

  it("adds identity file with -i", () => {
    const withKey = new SshAdapter({
      host: "192.168.2.86",
      port: 22,
      user: "lepton",
      identity: "/home/user/.ssh/deploy_key",
      jumpChain: [],
    })
    const cmd = withKey.buildCmd("hostname")
    expect(cmd).toContain("-i")
    expect(cmd).toContain("/home/user/.ssh/deploy_key")
  })

  it("adds non-standard port with -p", () => {
    const nonStd = new SshAdapter({
      host: "192.168.2.86",
      port: 2222,
      user: "lepton",
      jumpChain: [],
    })
    const cmd = nonStd.buildCmd("hostname")
    expect(cmd).toContain("-p")
    expect(cmd).toContain("2222")
  })
})

describe("KubectlAdapter", () => {
  const adapter = new KubectlAdapter({
    podName: "workbench-dev-ws",
    namespace: "workbench-dev-ws",
  })

  it("builds kubectl exec command", () => {
    const cmd = adapter.buildCmd("hostname")
    expect(cmd).toEqual([
      "kubectl",
      "exec",
      "-i",
      "workbench-dev-ws",
      "-n",
      "workbench-dev-ws",
      "--",
      "sh",
      "-c",
      "hostname",
    ])
  })

  it("passes argv without shell wrapping", () => {
    const cmd = adapter.buildArgv(["python", "-c", "print('hello')"])
    expect(cmd).toEqual([
      "kubectl",
      "exec",
      "-i",
      "workbench-dev-ws",
      "-n",
      "workbench-dev-ws",
      "--",
      "python",
      "-c",
      "print('hello')",
    ])
  })

  it("adds container flag", () => {
    const withContainer = new KubectlAdapter({
      podName: "pod-1",
      namespace: "default",
      container: "sidecar",
    })
    const cmd = withContainer.buildCmd("hostname")
    expect(cmd).toContain("-c")
    expect(cmd).toContain("sidecar")
  })

  it("does not escape arguments (argv passthrough)", () => {
    expect(adapter.escapeArg("hello world")).toBe("hello world")
  })
})

describe("DockerExecAdapter", () => {
  const adapter = new DockerExecAdapter("traffic-airflow-airflow-webserver-1")

  it("builds docker exec command", () => {
    const cmd = adapter.buildCmd("hostname")
    expect(cmd).toEqual([
      "docker",
      "exec",
      "traffic-airflow-airflow-webserver-1",
      "sh",
      "-c",
      "hostname",
    ])
  })

  it("passes argv without shell wrapping", () => {
    const cmd = adapter.buildArgv(["python", "-c", "print(1)"])
    expect(cmd).toEqual([
      "docker",
      "exec",
      "traffic-airflow-airflow-webserver-1",
      "python",
      "-c",
      "print(1)",
    ])
  })
})

describe("DockerComposeExecAdapter", () => {
  const adapter = new DockerComposeExecAdapter(
    "traffic-airflow",
    "airflow-webserver"
  )

  it("builds docker compose exec command", () => {
    const cmd = adapter.buildCmd("hostname")
    expect(cmd).toEqual([
      "docker",
      "compose",
      "-p",
      "traffic-airflow",
      "exec",
      "-T",
      "airflow-webserver",
      "sh",
      "-c",
      "hostname",
    ])
  })
})

describe("NestedAdapter (SSH → Docker exec)", () => {
  const ssh = new SshAdapter({
    host: "192.168.2.86",
    port: 22,
    user: "lepton",
    jumpChain: [],
  })
  const docker = new DockerExecAdapter("airflow-webserver-1")
  const nested = new NestedAdapter(ssh, docker)

  it("composes SSH + docker exec", () => {
    const cmd = nested.buildCmd("hostname")
    expect(cmd[0]).toBe("ssh")
    expect(cmd).toContain("lepton@192.168.2.86")
    const remoteCmd = cmd[cmd.length - 1]
    expect(remoteCmd).toContain("docker exec")
    expect(remoteCmd).toContain("airflow-webserver-1")
    expect(remoteCmd).toContain("hostname")
  })

  it("reports combined kind", () => {
    expect(nested.kind).toBe("ssh+docker-exec")
  })

  it("double-escapes arguments", () => {
    const escaped = nested.escapeArg("it's a test")
    expect(escaped).toContain("'")
  })
})
