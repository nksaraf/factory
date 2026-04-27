import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import {
  ProcessManager,
  type IProcessManager,
  type CaptureResult,
} from "@smp/factory-shared/effect/process-manager"
import {
  RemoteExec,
  RemoteExecLive,
  type AccessTarget,
  type SshTransport,
} from "../index.js"
import { SshError } from "@smp/factory-shared/effect"

// ── Mock ProcessManager ────────────────────────────────────

function mockPm(responses: CaptureResult[]): Layer.Layer<ProcessManager> {
  let callIndex = 0
  const mock: IProcessManager = {
    capture: () => {
      const r = responses[callIndex] ?? {
        code: -1,
        stdout: "",
        stderr: "no more responses",
      }
      callIndex++
      return Effect.succeed(r)
    },
    spawn: () => Effect.die("not implemented"),
    stream: () => Effect.succeed(0),
    interactive: () => Effect.succeed(0),
    kill: () => Effect.succeed(undefined as void),
    killTree: () => Effect.succeed(undefined as void),
    isRunning: () => Effect.succeed(false),
  }
  return Layer.succeed(ProcessManager, mock)
}

// ── Test targets ───────────────────────────────────────────

const sshTarget: AccessTarget = {
  slug: "test-host",
  displayName: "Test Host",
  status: "active",
  entityType: "vm",
  transport: {
    kind: "ssh",
    host: "10.0.0.1",
    port: 22,
    user: "root",
    jumpChain: [],
  },
  raw: {
    type: "vm",
    id: "h1",
    slug: "test-host",
    displayName: "Test Host",
    status: "active",
    transport: "ssh",
    sshHost: "10.0.0.1",
  },
}

const kubectlTarget: AccessTarget = {
  ...sshTarget,
  slug: "k8s-pod",
  transport: {
    kind: "kubectl",
    podName: "pod-1",
    namespace: "default",
  },
}

// ── RemoteExec.run with mock PM ────────────────────────────

describe("RemoteExec.run (mock ProcessManager)", () => {
  const runWith = (
    responses: CaptureResult[],
    effect: Effect.Effect<unknown, SshError, RemoteExec>
  ) => {
    const pmLayer = mockPm(responses)
    const execLayer = RemoteExecLive.pipe(Layer.provide(pmLayer))
    return Effect.runPromiseExit(Effect.provide(effect, execLayer))
  }

  it("returns result on success (code 0)", async () => {
    const exit = await runWith(
      [{ code: 0, stdout: "hello\n", stderr: "" }],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(sshTarget, "hostname")
      })
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.stdout.trim()).toBe("hello")
    }
  })

  it("diagnoses host key changed", async () => {
    const exit = await runWith(
      [
        {
          code: 255,
          stdout: "",
          stderr: "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
        },
      ],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(sshTarget, "hostname")
      })
    )
    // clearStaleHostKey can't clear a non-existent key in mock context,
    // so it fails with HostKeyChanged error
    expect(exit._tag).toBe("Failure")
  })

  it("fails with SshError on connection refused", async () => {
    const exit = await runWith(
      [
        {
          code: 255,
          stdout: "",
          stderr: "ssh: connect to host 10.0.0.1 port 22: Connection refused",
        },
      ],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(sshTarget, "hostname")
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails with SshError on timeout", async () => {
    const exit = await runWith(
      [
        {
          code: 255,
          stdout: "",
          stderr: "ssh: connect to host 10.0.0.1 port 22: Connection timed out",
        },
      ],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(sshTarget, "hostname")
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails with SshError on auth failure", async () => {
    const exit = await runWith(
      [{ code: 255, stdout: "", stderr: "Permission denied (publickey)." }],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(sshTarget, "hostname")
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  it("rejects kubectl targets", async () => {
    const exit = await runWith(
      [],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.run(kubectlTarget, "hostname")
      })
    )
    expect(exit._tag).toBe("Failure")
  })
})

// ── RemoteExec.curlJson with mock PM ───────────────────────

describe("RemoteExec.curlJson (mock ProcessManager)", () => {
  const runWith = <T>(
    responses: CaptureResult[],
    effect: Effect.Effect<T, SshError, RemoteExec>
  ) => {
    const pmLayer = mockPm(responses)
    const execLayer = RemoteExecLive.pipe(Layer.provide(pmLayer))
    return Effect.runPromiseExit(Effect.provide(effect, execLayer))
  }

  it("parses JSON from stdout", async () => {
    const exit = await runWith(
      [{ code: 0, stdout: '{"key":"value"}', stderr: "" }],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.curlJson<{ key: string }>(
          sshTarget,
          "http://localhost:8080/api"
        )
      })
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.key).toBe("value")
    }
  })

  it("diagnoses host key changed on curlJson", async () => {
    const exit = await runWith(
      [
        {
          code: 255,
          stdout: "",
          stderr: "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
        },
      ],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.curlJson<{ ok: boolean }>(
          sshTarget,
          "http://localhost:8080/api"
        )
      })
    )
    // clearStaleHostKey can't clear in mock context → fails with SshError
    expect(exit._tag).toBe("Failure")
  })

  it("fails on invalid JSON", async () => {
    const exit = await runWith(
      [{ code: 0, stdout: "not json", stderr: "" }],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.curlJson(sshTarget, "http://localhost:8080/api")
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails on connection error with SshError", async () => {
    const exit = await runWith(
      [{ code: 255, stdout: "", stderr: "Connection refused" }],
      Effect.gen(function* () {
        const exec = yield* RemoteExec
        return yield* exec.curlJson(sshTarget, "http://localhost:8080/api")
      })
    )
    expect(exit._tag).toBe("Failure")
  })
})
