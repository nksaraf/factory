import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import {
  RemoteAccess,
  RemoteAccessLive,
  RemoteExec,
  RemoteExecLive,
  type AccessTarget,
  type ExecResult,
  type SshTransport,
} from "../index.js"
import { diagnoseSshFailure } from "../services/remote-exec.js"
import { SshError } from "@smp/factory-shared/effect"
import { JumpHop } from "../services/remote-access.js"

// ── diagnoseSshFailure (pure function, no mocks needed) ─────

const makeSshTransport = (
  overrides: Partial<SshTransport> = {}
): SshTransport => ({
  kind: "ssh",
  host: "192.168.2.86",
  port: 22,
  user: "lepton",
  jumpChain: [],
  ...overrides,
})

describe("diagnoseSshFailure", () => {
  it("detects host key changed", () => {
    // clearStaleHostKey runs real SSH — just verify the pattern detection
    const d = diagnoseSshFailure(
      makeSshTransport({ host: "127.0.0.254" }),
      255,
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n" +
        "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\n"
    )
    expect(d.failure._tag).toBe("HostKeyChanged")
  })

  it("detects permission denied (publickey)", () => {
    const d = diagnoseSshFailure(
      makeSshTransport({ identity: "/nonexistent/key" }),
      255,
      "Permission denied (publickey)."
    )
    expect(d.failure._tag).toBe("AuthFailed")
    if (d.failure._tag === "AuthFailed") {
      expect(d.failure.user).toBe("lepton")
      expect(d.failure.keyExists).toBe(false)
    }
    expect(d.autoFixed).toBe(false)
  })

  it("detects password required", () => {
    const d = diagnoseSshFailure(
      makeSshTransport(),
      255,
      "Permission denied (password)."
    )
    expect(d.failure._tag).toBe("PasswordRequired")
    expect(d.autoFixed).toBe(false)
  })

  it("detects connection refused", () => {
    const d = diagnoseSshFailure(
      makeSshTransport({ port: 2222 }),
      255,
      "ssh: connect to host 192.168.2.86 port 2222: Connection refused"
    )
    expect(d.failure._tag).toBe("ConnectionRefused")
    if (d.failure._tag === "ConnectionRefused") {
      expect(d.failure.port).toBe(2222)
    }
  })

  it("detects connection timeout", () => {
    const d = diagnoseSshFailure(
      makeSshTransport(),
      255,
      "ssh: connect to host 192.168.2.86 port 22: Connection timed out"
    )
    expect(d.failure._tag).toBe("Timeout")
  })

  it("detects operation timed out (macOS variant)", () => {
    const d = diagnoseSshFailure(
      makeSshTransport(),
      255,
      "ssh: connect to host 192.168.2.86 port 22: Operation timed out"
    )
    expect(d.failure._tag).toBe("Timeout")
  })

  it("detects hostname not found", () => {
    const d = diagnoseSshFailure(
      makeSshTransport({ host: "nonexistent.local" }),
      255,
      "ssh: Could not resolve hostname nonexistent.local: Name or service not known"
    )
    expect(d.failure._tag).toBe("HostNotFound")
    if (d.failure._tag === "HostNotFound") {
      expect(d.failure.hostname).toBe("nonexistent.local")
    }
  })

  it("detects key exchange failure (jump forwarding)", () => {
    const d = diagnoseSshFailure(
      makeSshTransport({
        jumpChain: [new JumpHop({ host: "bastion", port: 22, user: "root" })],
      }),
      255,
      "kex_exchange_identification: Connection closed by remote host"
    )
    expect(d.failure._tag).toBe("JumpForwardingFailed")
    if (d.failure._tag === "JumpForwardingFailed") {
      expect(d.failure.jumpHost).toBe("bastion")
    }
  })

  it("detects unprotected key file and marks autoFixed", () => {
    const d = diagnoseSshFailure(
      makeSshTransport({ identity: "/tmp/test-key" }),
      255,
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n" +
        "WARNING: UNPROTECTED PRIVATE KEY FILE!\n" +
        "Permissions 0644 for '/tmp/test-key' are too open."
    )
    expect(d.failure._tag).toBe("KeyPermissions")
    expect(d.autoFixed).toBe(true)
    if (d.failure._tag === "KeyPermissions") {
      expect(d.failure.path).toBe("/tmp/test-key")
    }
  })

  it("falls back to CommandFailed for unknown errors", () => {
    const d = diagnoseSshFailure(
      makeSshTransport(),
      1,
      "bash: some-command: command not found"
    )
    expect(d.failure._tag).toBe("CommandFailed")
    if (d.failure._tag === "CommandFailed") {
      expect(d.failure.exitCode).toBe(1)
      expect(d.failure.stderr).toContain("command not found")
    }
  })
})

// ── SshError message formatting ─────────────────────────────

describe("SshError", () => {
  it("formats HostKeyChanged message", () => {
    const err = new SshError({
      host: "192.168.2.86",
      failure: { _tag: "HostKeyChanged", cleared: true },
    })
    expect(err.message).toContain("host key changed")
    expect(err.message).toContain("192.168.2.86")
  })

  it("formats AuthFailed with jump chain", () => {
    const err = new SshError({
      host: "192.168.2.86",
      jumpChain: [{ host: "192.168.1.59", port: 22, user: "lepton" }],
      failure: { _tag: "AuthFailed", user: "root" },
    })
    expect(err.message).toContain("via 192.168.1.59")
    expect(err.message).toContain("user root")
  })

  it("provides recovery suggestions for AuthFailed", () => {
    const err = new SshError({
      host: "host1",
      failure: { _tag: "AuthFailed", user: "root" },
    })
    const suggestions = err.effectiveSuggestions
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].command).toContain("ssh keys generate")
  })

  it("provides recovery suggestion for ConnectionRefused", () => {
    const err = new SshError({
      host: "host1",
      failure: { _tag: "ConnectionRefused", port: 22 },
    })
    expect(err.effectiveSuggestions.length).toBeGreaterThan(0)
  })
})

// ── RemoteAccess.fromEntity (pure, no API needed) ───────────

describe("RemoteAccess.fromEntity", () => {
  it("builds SSH transport from ResolvedEntity", () => {
    const layer = RemoteAccessLive
    const program = Effect.gen(function* () {
      const access = yield* RemoteAccess
      const target = access.fromEntity({
        type: "vm",
        id: "host_123",
        slug: "app-prod",
        displayName: "app-prod",
        status: "active",
        transport: "ssh",
        sshHost: "192.168.2.86",
        sshPort: 22,
        sshUser: "lepton",
        jumpHost: "192.168.1.59",
        jumpUser: "lepton",
        jumpPort: 22,
      })

      expect(target.slug).toBe("app-prod")
      expect(target.transport.kind).toBe("ssh")
      if (target.transport.kind === "ssh") {
        expect(target.transport.host).toBe("192.168.2.86")
        expect(target.transport.user).toBe("lepton")
        expect(target.transport.jumpChain).toHaveLength(1)
        expect(target.transport.jumpChain[0].host).toBe("192.168.1.59")
      }
    })

    return Effect.runPromise(Effect.provide(program, layer))
  })

  it("builds kubectl transport for k8s workbenches", () => {
    const layer = RemoteAccessLive
    const program = Effect.gen(function* () {
      const access = yield* RemoteAccess
      const target = access.fromEntity({
        type: "workbench",
        id: "wb_123",
        slug: "dev-ws",
        displayName: "dev-ws",
        status: "active",
        transport: "kubectl",
        podName: "workbench-dev-ws",
        namespace: "workbench-dev-ws",
        container: "workbench",
      })

      expect(target.transport.kind).toBe("kubectl")
      if (target.transport.kind === "kubectl") {
        expect(target.transport.podName).toBe("workbench-dev-ws")
        expect(target.transport.namespace).toBe("workbench-dev-ws")
      }
    })

    return Effect.runPromise(Effect.provide(program, layer))
  })

  it("falls back to local transport when no SSH/kubectl", () => {
    const layer = RemoteAccessLive
    const program = Effect.gen(function* () {
      const access = yield* RemoteAccess
      const target = access.fromEntity({
        type: "host",
        id: "local",
        slug: "localhost",
        displayName: "localhost",
        status: "active",
        transport: "none",
      })

      expect(target.transport.kind).toBe("local")
    })

    return Effect.runPromise(Effect.provide(program, layer))
  })
})

// ── RemoteExec.runLocal (real process, no SSH) ──────────────

describe("RemoteExec.runLocal", () => {
  it("runs a local command and captures stdout", async () => {
    const layer = RemoteExecLive
    const program = Effect.gen(function* () {
      const exec = yield* RemoteExec
      const result = yield* exec.runLocal("echo hello")
      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toBe("hello")
    })

    await Effect.runPromise(Effect.provide(program, layer))
  })

  it("captures exit code for failed commands", async () => {
    const layer = RemoteExecLive
    const program = Effect.gen(function* () {
      const exec = yield* RemoteExec
      const result = yield* exec.runLocal("exit 42")
      expect(result.code).toBe(42)
    })

    await Effect.runPromise(Effect.provide(program, layer))
  })

  it("captures stderr", async () => {
    const layer = RemoteExecLive
    const program = Effect.gen(function* () {
      const exec = yield* RemoteExec
      const result = yield* exec.runLocal("echo error >&2")
      expect(result.stderr.trim()).toBe("error")
    })

    await Effect.runPromise(Effect.provide(program, layer))
  })
})
