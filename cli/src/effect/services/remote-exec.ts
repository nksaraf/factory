import { spawn } from "node:child_process"
import { statSync } from "node:fs"
import { Context, Effect, Layer } from "effect"
import { SshError } from "@smp/factory-shared/effect"
import { buildSshArgs, clearStaleHostKey } from "../../lib/ssh-utils.js"
import type { AccessTarget, JumpHop, SshTransport } from "./remote-access.js"

// ── Types ──────────────────────────────────────────────────

export interface ExecResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

// ── Service ────────────────────────────────────────────────

export class RemoteExec extends Context.Tag("RemoteExec")<
  RemoteExec,
  {
    readonly run: (
      target: AccessTarget,
      command: string,
      opts?: { timeoutMs?: number }
    ) => Effect.Effect<ExecResult, SshError>

    readonly runLocal: (
      command: string,
      opts?: { timeoutMs?: number }
    ) => Effect.Effect<ExecResult, never>

    readonly curlJson: <T>(
      target: AccessTarget,
      url: string
    ) => Effect.Effect<T, SshError>
  }
>() {}

// ── SSH diagnostic engine ──────────────────────────────────

type SshFailure = SshError["failure"]

function diagnoseSshFailure(
  transport: SshTransport,
  code: number,
  stderr: string
): { failure: SshFailure; autoFixed: boolean; suggestions?: undefined } {
  const jumpChain = transport.jumpChain as JumpHop[]

  if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
    const cleared = clearStaleHostKey(transport.host, transport.port)
    return {
      failure: { _tag: "HostKeyChanged", cleared },
      autoFixed: cleared,
    }
  }

  if (stderr.includes("Permission denied (publickey)")) {
    let keyExists: boolean | undefined
    let keyPermissions: string | undefined
    if (transport.identity) {
      try {
        const stat = statSync(transport.identity)
        keyExists = true
        keyPermissions = (stat.mode & 0o777).toString(8)
      } catch {
        keyExists = false
      }
    }
    return {
      failure: {
        _tag: "AuthFailed",
        user: transport.user,
        keyExists,
        keyPermissions,
      },
      autoFixed: false,
    }
  }

  if (stderr.includes("Permission denied (password)")) {
    return {
      failure: { _tag: "PasswordRequired" },
      autoFixed: false,
    }
  }

  if (
    stderr.includes("Connection refused") ||
    (stderr.includes("connect to host") &&
      stderr.includes("Connection refused"))
  ) {
    return {
      failure: { _tag: "ConnectionRefused", port: transport.port },
      autoFixed: false,
    }
  }

  if (
    stderr.includes("Connection timed out") ||
    stderr.includes("Operation timed out")
  ) {
    // TODO: probe jump host independently (nc -zvw 3 jumpHost jumpPort) to
    // distinguish "jump host down" from "target unreachable through jump"
    return {
      failure: { _tag: "Timeout" },
      autoFixed: false,
    }
  }

  if (stderr.includes("Could not resolve hostname")) {
    const match = stderr.match(/Could not resolve hostname (\S+)/)
    return {
      failure: { _tag: "HostNotFound", hostname: match?.[1] ?? transport.host },
      autoFixed: false,
    }
  }

  if (stderr.includes("UNPROTECTED PRIVATE KEY FILE") && transport.identity) {
    let current = "unknown"
    try {
      current = (statSync(transport.identity).mode & 0o777).toString(8)
    } catch {}
    return {
      failure: {
        _tag: "KeyPermissions",
        path: transport.identity,
        current,
      },
      autoFixed: true,
    }
  }

  if (stderr.includes("kex_exchange_identification")) {
    return {
      failure: {
        _tag: "JumpForwardingFailed",
        jumpHost: jumpChain[0]?.host ?? transport.host,
      },
      autoFixed: false,
    }
  }

  return {
    failure: {
      _tag: "CommandFailed",
      exitCode: code,
      stderr: stderr.slice(0, 500),
    },
    autoFixed: false,
  }
}

// ── Implementation ─────────────────────────────────────────

function spawnProcess(
  args: string[],
  _command: string,
  timeoutMs: number
): Effect.Effect<ExecResult, never> {
  return Effect.async<ExecResult, never>((resume) => {
    const proc = spawn(args[0], args.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resume(Effect.succeed({ code: code ?? -1, stdout, stderr }))
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resume(
        Effect.succeed({ code: -1, stdout, stderr: stderr || "spawn error" })
      )
    })
    return Effect.sync(() => {
      clearTimeout(timer)
      proc.kill("SIGKILL")
    })
  })
}

function buildSshCommand(transport: SshTransport, command: string): string[] {
  const sshArgs = buildSshArgs({
    host: transport.host,
    port: transport.port,
    user: transport.user,
    identity: transport.identity,
    jumpHost: transport.jumpChain[0]?.host,
    jumpUser: transport.jumpChain[0]?.user,
    jumpPort: transport.jumpChain[0]?.port,
    tty: "none",
    hostKeyCheck: "accept-new",
    extraArgs: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
  })
  sshArgs.push(command)
  return ["ssh", ...sshArgs]
}

function makeSshError(
  transport: SshTransport,
  diagnosis: ReturnType<typeof diagnoseSshFailure>
): SshError {
  return new SshError({
    host: transport.host,
    jumpChain: [...transport.jumpChain],
    failure: diagnosis.failure,
    autoFixed: diagnosis.autoFixed,
  })
}

function diagnoseAndRetry(
  transport: SshTransport,
  args: string[],
  command: string,
  timeoutMs: number,
  result: ExecResult
): Effect.Effect<ExecResult, SshError> {
  return Effect.gen(function* () {
    const diagnosis = diagnoseSshFailure(transport, result.code, result.stderr)

    if (diagnosis.autoFixed && diagnosis.failure._tag === "HostKeyChanged") {
      const retry = yield* spawnProcess(args, command, timeoutMs)
      if (retry.code === 0) return retry
      return yield* makeSshError(transport, { ...diagnosis, autoFixed: false })
    }

    if (
      diagnosis.autoFixed &&
      diagnosis.failure._tag === "KeyPermissions" &&
      transport.identity
    ) {
      try {
        const fs = yield* Effect.promise(() => import("node:fs"))
        fs.chmodSync(transport.identity, 0o600)
        const retry = yield* spawnProcess(args, command, timeoutMs)
        if (retry.code === 0) return retry
      } catch {}
      return yield* makeSshError(transport, diagnosis)
    }

    return yield* makeSshError(transport, diagnosis)
  })
}

function requireSsh(
  target: AccessTarget
): Effect.Effect<SshTransport, SshError> {
  if (target.transport.kind !== "ssh") {
    return Effect.fail(
      new SshError({
        host: target.slug,
        failure: {
          _tag: "CommandFailed",
          exitCode: -1,
          stderr: `Transport ${target.transport.kind} not supported — use kubectl exec for kubectl targets`,
        },
      })
    )
  }
  return Effect.succeed(target.transport)
}

export const RemoteExecLive = Layer.succeed(RemoteExec, {
  run: (target, command, opts) =>
    Effect.gen(function* () {
      const transport = yield* requireSsh(target)
      const timeoutMs = opts?.timeoutMs ?? 15_000
      const args = buildSshCommand(transport, command)
      const result = yield* spawnProcess(args, command, timeoutMs)
      if (result.code === 0) return result
      return yield* diagnoseAndRetry(
        transport,
        args,
        command,
        timeoutMs,
        result
      )
    }),

  runLocal: (command, opts) => {
    const timeoutMs = opts?.timeoutMs ?? 15_000
    return spawnProcess(["bash", "-c", command], command, timeoutMs)
  },

  curlJson: <T>(target: AccessTarget, url: string) =>
    Effect.gen(function* () {
      const transport = yield* requireSsh(target)
      const cmd = `curl -sf --max-time 10 '${url}'`
      const timeoutMs = 15_000
      const args = buildSshCommand(transport, cmd)
      const result = yield* spawnProcess(args, cmd, timeoutMs)

      if (result.code !== 0 || !result.stdout.trim()) {
        // diagnoseAndRetry either retries successfully or fails with SshError
        const retried = yield* diagnoseAndRetry(
          transport,
          args,
          cmd,
          timeoutMs,
          result
        )
        // If retry succeeded, try to parse its stdout
        try {
          return JSON.parse(retried.stdout) as T
        } catch {
          return yield* new SshError({
            host: transport.host,
            failure: {
              _tag: "CommandFailed",
              exitCode: 0,
              stderr: `Invalid JSON after retry: ${retried.stdout.slice(0, 100)}`,
            },
          })
        }
      }

      try {
        return JSON.parse(result.stdout) as T
      } catch {
        return yield* new SshError({
          host: transport.host,
          failure: {
            _tag: "CommandFailed",
            exitCode: 0,
            stderr: `Invalid JSON from ${url}: ${result.stdout.slice(0, 100)}`,
          },
        })
      }
    }),
})
