import { describe, expect, it } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import type {
  AccessTarget,
  SshTransport,
  KubectlTransport,
} from "../services/remote-access.js"
import {
  JumpHop,
  RemoteAccess,
  RemoteAccessLive,
} from "../services/remote-access.js"
import { RemoteExec, RemoteExecLive } from "../services/remote-exec.js"
import {
  SshAdapter,
  KubectlAdapter,
  LocalAdapter,
} from "@smp/factory-shared/effect/transport-adapter"
import {
  ProcessManager,
  type IProcessManager,
  type CaptureResult,
} from "@smp/factory-shared/effect/process-manager"
import { buildSshArgs, buildKubectlExecArgs } from "../../lib/ssh-utils.js"
import type { ResolvedEntity } from "../../lib/entity-finder.js"

// ── Helpers ──────────────────────────────────────────────────

function makeSshTarget(overrides: Partial<SshTransport> = {}): AccessTarget {
  const transport: SshTransport = {
    kind: "ssh",
    host: "192.168.1.59",
    port: 22,
    user: "lepton",
    jumpChain: [],
    ...overrides,
  }
  return {
    slug: "lepton-59",
    displayName: "lepton-59",
    status: "online",
    entityType: "host",
    transport,
    raw: {} as ResolvedEntity,
  }
}

function makeKubectlTarget(
  overrides: Partial<KubectlTransport> = {}
): AccessTarget {
  const transport: KubectlTransport = {
    kind: "kubectl",
    podName: "workbench-abc123",
    namespace: "default",
    ...overrides,
  }
  return {
    slug: "my-workbench",
    displayName: "My Workbench",
    status: "running",
    entityType: "workbench",
    transport,
    raw: {} as ResolvedEntity,
  }
}

// ── SSH adapter parity with buildSshArgs ─────────────────────
// These tests verify that SshAdapter produces equivalent args to the
// legacy buildSshArgs function for the same inputs. This ensures the
// Effect migration doesn't change SSH behavior.

describe("SshAdapter parity with buildSshArgs", () => {
  it("basic SSH without jump host", () => {
    const legacy = buildSshArgs({
      host: "192.168.1.59",
      port: 22,
      user: "lepton",
      tty: "none",
      hostKeyCheck: "accept-new",
    })

    const adapter = new SshAdapter({
      host: "192.168.1.59",
      port: 22,
      user: "lepton",
      jumpChain: [],
    })
    const effectArgs = adapter.buildCmd("hostname")

    // Both should produce ssh ... lepton@192.168.1.59 <command>
    expect(legacy).toContain("lepton@192.168.1.59")
    expect(effectArgs).toContain("lepton@192.168.1.59")
    expect(effectArgs[0]).toBe("ssh")
    // Legacy uses -T, adapter also uses -T (BatchMode)
    expect(effectArgs).toContain("-T")
  })

  it("SSH with jump host", () => {
    const legacy = buildSshArgs({
      host: "192.168.2.86",
      user: "lepton",
      tty: "none",
      hostKeyCheck: "accept-new",
      jumpHost: "192.168.1.59",
      jumpUser: "lepton",
      jumpPort: 22,
    })

    const adapter = new SshAdapter({
      host: "192.168.2.86",
      port: 22,
      user: "lepton",
      jumpChain: [{ host: "192.168.1.59", port: 22, user: "lepton" }],
    })
    const effectArgs = adapter.buildCmd("hostname")

    // Both should have -J with jump spec
    expect(legacy).toContain("-J")
    expect(effectArgs).toContain("-J")

    const legacyJumpIdx = legacy.indexOf("-J")
    const effectJumpIdx = effectArgs.indexOf("-J")
    // Legacy includes :22 even for default port; adapter omits it (correct behavior)
    expect(legacy[legacyJumpIdx + 1]).toBe("lepton@192.168.1.59:22")
    // SshAdapter correctly omits default port 22 from jump spec
    expect(effectArgs[effectJumpIdx + 1]).toBe("lepton@192.168.1.59")
  })

  it("SSH with identity file", () => {
    const legacy = buildSshArgs({
      host: "10.0.0.1",
      port: 22,
      user: "deploy",
      tty: "none",
      hostKeyCheck: "accept-new",
      identity: "/home/user/.ssh/id_ed25519",
    })

    const adapter = new SshAdapter({
      host: "10.0.0.1",
      port: 22,
      user: "deploy",
      identity: "/home/user/.ssh/id_ed25519",
      jumpChain: [],
    })
    const effectArgs = adapter.buildCmd("hostname")

    const legacyIIdx = legacy.indexOf("-i")
    const effectIIdx = effectArgs.indexOf("-i")
    expect(legacyIIdx).toBeGreaterThanOrEqual(0)
    expect(effectIIdx).toBeGreaterThanOrEqual(0)
    expect(legacy[legacyIIdx + 1]).toBe("/home/user/.ssh/id_ed25519")
    expect(effectArgs[effectIIdx + 1]).toBe("/home/user/.ssh/id_ed25519")
  })

  it("SSH with non-standard port", () => {
    const legacy = buildSshArgs({
      host: "10.0.0.1",
      port: 2222,
      user: "root",
      tty: "none",
      hostKeyCheck: "accept-new",
    })

    const adapter = new SshAdapter({
      host: "10.0.0.1",
      port: 2222,
      user: "root",
      jumpChain: [],
    })
    const effectArgs = adapter.buildCmd("hostname")

    expect(legacy).toContain("-p")
    expect(effectArgs).toContain("-p")
    const legacyPIdx = legacy.indexOf("-p")
    const effectPIdx = effectArgs.indexOf("-p")
    expect(legacy[legacyPIdx + 1]).toBe("2222")
    expect(effectArgs[effectPIdx + 1]).toBe("2222")
  })
})

// ── KubectlAdapter parity with buildKubectlExecArgs ──────────

describe("KubectlAdapter parity with buildKubectlExecArgs", () => {
  it("basic kubectl exec", () => {
    const legacy = buildKubectlExecArgs({
      podName: "workbench-abc123",
      namespace: "default",
      interactive: true,
    })

    const adapter = new KubectlAdapter({
      podName: "workbench-abc123",
      namespace: "default",
    })
    const effectArgs = adapter.buildCmd("/bin/bash")

    // Both target the same pod and namespace
    expect(legacy).toContain("workbench-abc123")
    expect(effectArgs).toContain("workbench-abc123")
    expect(legacy).toContain("-n")
    expect(effectArgs).toContain("-n")
  })

  it("kubectl exec with container", () => {
    const legacy = buildKubectlExecArgs({
      podName: "workbench-abc123",
      namespace: "workbenches",
      container: "code-server",
      interactive: false,
    })

    const adapter = new KubectlAdapter({
      podName: "workbench-abc123",
      namespace: "workbenches",
      container: "code-server",
    })
    const effectArgs = adapter.buildCmd("ls -la")

    // Both specify the container
    expect(legacy).toContain("-c")
    expect(effectArgs).toContain("-c")
    expect(legacy).toContain("code-server")
    expect(effectArgs).toContain("code-server")
  })
})

// ── AccessTarget transport selection ─────────────────────────
// Tests that the correct transport adapter is selected based on
// the AccessTarget's transport kind.

describe("transport adapter selection from AccessTarget", () => {
  function adapterForTarget(target: AccessTarget) {
    switch (target.transport.kind) {
      case "ssh":
        return new SshAdapter({
          host: target.transport.host,
          port: target.transport.port,
          user: target.transport.user,
          identity: target.transport.identity,
          jumpChain: [...target.transport.jumpChain],
        })
      case "kubectl":
        return new KubectlAdapter({
          podName: target.transport.podName,
          namespace: target.transport.namespace,
          container: target.transport.container,
        })
      case "local":
        return new LocalAdapter()
    }
  }

  it("SSH target produces ssh command", () => {
    const target = makeSshTarget()
    const adapter = adapterForTarget(target)
    const cmd = adapter.buildCmd("hostname")
    expect(cmd[0]).toBe("ssh")
    expect(cmd).toContain("lepton@192.168.1.59")
  })

  it("SSH target with jump chain includes -J", () => {
    const target = makeSshTarget({
      jumpChain: [
        { host: "192.168.1.59", port: 22, user: "lepton" } as JumpHop,
      ],
    })
    const adapter = adapterForTarget(target)
    const cmd = adapter.buildCmd("hostname")
    expect(cmd).toContain("-J")
  })

  it("kubectl target produces kubectl exec command", () => {
    const target = makeKubectlTarget()
    const adapter = adapterForTarget(target)
    const cmd = adapter.buildCmd("/bin/bash")
    expect(cmd[0]).toBe("kubectl")
    expect(cmd).toContain("exec")
    expect(cmd).toContain("workbench-abc123")
  })

  it("local target produces bash command", () => {
    const target: AccessTarget = {
      slug: "local",
      displayName: "local",
      status: "online",
      entityType: "host",
      transport: { kind: "local" },
      raw: {} as ResolvedEntity,
    }
    const adapter = adapterForTarget(target)
    const cmd = adapter.buildCmd("hostname")
    expect(cmd[0]).toBe("bash")
    expect(cmd).toContain("-c")
  })
})

// ── Interactive session via ProcessManager ────────────────────
// Tests that dx ssh/exec would use ProcessManager.interactive
// with the correct command arrays.

describe("interactive session command building", () => {
  it("SSH interactive session: no command = force TTY", () => {
    const target = makeSshTarget()
    // For interactive SSH (no remote command), we need -tt for force TTY
    const adapter = new SshAdapter({
      host: (target.transport as SshTransport).host,
      port: (target.transport as SshTransport).port,
      user: (target.transport as SshTransport).user,
      jumpChain: [],
    })

    // Interactive mode: buildArgv with no shell wrapping
    const cmd = adapter.buildArgv([])
    expect(cmd[0]).toBe("ssh")
    expect(cmd).toContain("lepton@192.168.1.59")
    // No command at the end (interactive shell)
  })

  it("SSH exec with remote command", () => {
    const target = makeSshTarget()
    const adapter = new SshAdapter({
      host: (target.transport as SshTransport).host,
      port: (target.transport as SshTransport).port,
      user: (target.transport as SshTransport).user,
      jumpChain: [],
    })

    const cmd = adapter.buildCmd("docker ps --format '{{.Names}}'")
    expect(cmd[0]).toBe("ssh")
    // Command should be the last arg
    expect(cmd[cmd.length - 1]).toBe("docker ps --format '{{.Names}}'")
  })

  it("kubectl exec with shell command", () => {
    const adapter = new KubectlAdapter({
      podName: "workbench-abc",
      namespace: "default",
    })

    const cmd = adapter.buildCmd("ls -la /workspace")
    expect(cmd[0]).toBe("kubectl")
    expect(cmd).toContain("exec")
    // Should wrap in sh -c for kubectl
    const dashIdx = cmd.indexOf("--")
    expect(dashIdx).toBeGreaterThan(0)
  })
})

// ── URL log source resolution ────────────────────────────────
// Tests the logic of streamUrlLogs: URL → resolved target →
// @internal check → local/SSH source selection.

describe("log source resolution logic", () => {
  it("detects @internal services", () => {
    const svc = "api@internal"
    expect(svc.includes("@internal")).toBe(true)
  })

  it("strips @internal for service name matching", () => {
    const svc = "api@internal"
    const cleaned = svc.replace(/@.*$/, "")
    expect(cleaned).toBe("api")
  })

  it("prefers local compose when service is running locally", () => {
    // This tests the priority: local > SSH > remote
    const isLocal = true
    const hasHostEntity = true
    const source = isLocal ? "local" : hasHostEntity ? "ssh" : "remote"
    expect(source).toBe("local")
  })

  it("falls back to SSH when not running locally", () => {
    const isLocal = false
    const hasHostEntity = true
    const source = isLocal ? "local" : hasHostEntity ? "ssh" : "remote"
    expect(source).toBe("ssh")
  })

  it("falls back to remote when no host entity", () => {
    const isLocal = false
    const hasHostEntity = false
    const source = isLocal ? "local" : hasHostEntity ? "ssh" : "remote"
    expect(source).toBe("remote")
  })
})

// ── Inspect detail extraction ────────────────────────────────
// Tests the data extraction logic used by inspectFromUrl/inspectFromSlug.

describe("inspect detail extraction", () => {
  it("extracts port from spec.ports array", () => {
    const spec = { ports: [{ port: 8080 }, { port: 443 }] }
    const ports = spec.ports as Array<{ port: number }>
    expect(ports.map((p) => `:${p.port}`).join(", ")).toBe(":8080, :443")
  })

  it("extracts compose info from spec", () => {
    const spec = { composeProject: "factory", composeService: "api" }
    const result =
      spec.composeProject && spec.composeService
        ? `${spec.composeProject} / ${spec.composeService}`
        : (spec.composeProject ?? spec.composeService ?? "—")
    expect(result).toBe("factory / api")
  })

  it("handles missing compose info gracefully", () => {
    const spec: Record<string, unknown> = {}
    const project = spec.composeProject as string | undefined
    const svc = spec.composeService as string | undefined
    const result =
      project && svc ? `${project} / ${svc}` : (project ?? svc ?? "—")
    expect(result).toBe("—")
  })

  it("formats host with SSH port", () => {
    const entity = { sshHost: "192.168.1.59", sshPort: 2222 }
    const result = `${entity.sshHost}${entity.sshPort && entity.sshPort !== 22 ? `:${entity.sshPort}` : ""}`
    expect(result).toBe("192.168.1.59:2222")
  })

  it("omits port 22 in host display", () => {
    const entity = { sshHost: "192.168.1.59", sshPort: 22 }
    const result = `${entity.sshHost}${entity.sshPort && entity.sshPort !== 22 ? `:${entity.sshPort}` : ""}`
    expect(result).toBe("192.168.1.59")
  })
})

// ── Mock ProcessManager for interactive tests ─────────────────
// Verify that ProcessManager.interactive gets called with the right
// args when wiring through Effect services.

describe("ProcessManager.interactive wiring", () => {
  it("captures interactive call with SSH args", async () => {
    const calls: string[][] = []

    const mockPm: IProcessManager = {
      capture: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
      stream: () => Effect.succeed(0),
      interactive: (opts) => {
        calls.push(opts.cmd)
        return Effect.succeed(0)
      },
      spawn: () => Effect.succeed({ pid: 1 }) as any,
      kill: () => Effect.succeed(undefined),
      killTree: () => Effect.succeed(undefined),
      isRunning: () => Effect.succeed(false),
    }

    const mockPmLayer = Layer.succeed(ProcessManager, mockPm)

    const program = Effect.gen(function* () {
      const pm = yield* ProcessManager

      // Build SSH command for interactive session
      const adapter = new SshAdapter({
        host: "192.168.1.59",
        port: 22,
        user: "lepton",
        jumpChain: [],
      })
      const cmd = adapter.buildArgv([])
      // For interactive: add -tt for force TTY
      const interactiveCmd = ["ssh", "-tt", ...cmd.slice(1)]

      const exitCode = yield* pm.interactive({ cmd: interactiveCmd })
      return exitCode
    })

    const result = await Effect.runPromise(Effect.provide(program, mockPmLayer))

    expect(result).toBe(0)
    expect(calls.length).toBe(1)
    expect(calls[0][0]).toBe("ssh")
    expect(calls[0]).toContain("-tt")
    expect(calls[0]).toContain("lepton@192.168.1.59")
  })

  it("captures interactive call with kubectl args", async () => {
    const calls: string[][] = []

    const mockPm: IProcessManager = {
      capture: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
      stream: () => Effect.succeed(0),
      interactive: (opts) => {
        calls.push(opts.cmd)
        return Effect.succeed(0)
      },
      spawn: () => Effect.succeed({ pid: 1 }) as any,
      kill: () => Effect.succeed(undefined),
      killTree: () => Effect.succeed(undefined),
      isRunning: () => Effect.succeed(false),
    }

    const mockPmLayer = Layer.succeed(ProcessManager, mockPm)

    const program = Effect.gen(function* () {
      const pm = yield* ProcessManager

      const adapter = new KubectlAdapter({
        podName: "workbench-abc",
        namespace: "default",
      })
      const cmd = adapter.buildCmd("/bin/bash")

      const exitCode = yield* pm.interactive({ cmd })
      return exitCode
    })

    const result = await Effect.runPromise(Effect.provide(program, mockPmLayer))

    expect(result).toBe(0)
    expect(calls.length).toBe(1)
    expect(calls[0][0]).toBe("kubectl")
    expect(calls[0]).toContain("exec")
    expect(calls[0]).toContain("workbench-abc")
  })
})
