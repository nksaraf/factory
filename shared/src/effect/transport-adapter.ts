/**
 * Transport adapters — build command arrays for different execution contexts.
 *
 * Each adapter wraps a logical command into the right process invocation
 * for its transport (local shell, SSH, kubectl, docker exec). ProcessManager
 * runs the resulting cmd array without knowing which transport is in use.
 */

// ── Interface ──────────────────────────────────────────────

export interface TransportAdapter {
  readonly kind: string
  buildCmd(command: string): string[]
  buildArgv(args: string[]): string[]
  escapeArg(arg: string): string
}

// ── Shell escaping ─────────────────────────────────────────

function bashEscape(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@]+$/.test(arg)) return arg
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

// ── Local adapter ──────────────────────────────────────────

export class LocalAdapter implements TransportAdapter {
  readonly kind = "local"

  buildCmd(command: string): string[] {
    return ["bash", "-c", command]
  }

  buildArgv(args: string[]): string[] {
    return args
  }

  escapeArg(arg: string): string {
    return bashEscape(arg)
  }
}

// ── SSH adapter ────────────────────────────────────────────

export interface SshTarget {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly identity?: string
  readonly jumpChain: readonly { host: string; port: number; user: string }[]
}

export class SshAdapter implements TransportAdapter {
  readonly kind = "ssh"

  constructor(private readonly target: SshTarget) {}

  buildCmd(command: string): string[] {
    return ["ssh", ...this.sshArgs(), command]
  }

  buildArgv(args: string[]): string[] {
    return ["ssh", ...this.sshArgs(), args.map((a) => bashEscape(a)).join(" ")]
  }

  escapeArg(arg: string): string {
    return bashEscape(arg)
  }

  private sshArgs(): string[] {
    const args: string[] = ["-T"]
    args.push("-o", "StrictHostKeyChecking=accept-new")
    args.push("-o", "ServerAliveInterval=30")
    args.push("-o", "ServerAliveCountMax=3")
    args.push("-o", "BatchMode=yes")
    args.push("-o", "ConnectTimeout=10")

    if (this.target.jumpChain.length > 0) {
      const jumpSpec = this.target.jumpChain
        .map((h) => {
          let spec = h.user ? `${h.user}@${h.host}` : h.host
          if (h.port && h.port !== 22) spec += `:${h.port}`
          return spec
        })
        .join(",")
      args.push("-J", jumpSpec)
    }

    if (this.target.identity) {
      args.push("-i", this.target.identity)
    }

    if (this.target.port && this.target.port !== 22) {
      args.push("-p", String(this.target.port))
    }

    const userHost = this.target.user
      ? `${this.target.user}@${this.target.host}`
      : this.target.host
    args.push(userHost)

    return args
  }
}

// ── Kubectl adapter ────────────────────────────────────────

export interface KubectlTarget {
  readonly podName: string
  readonly namespace: string
  readonly container?: string
  readonly kubeContext?: string
}

export class KubectlAdapter implements TransportAdapter {
  readonly kind = "kubectl"

  constructor(private readonly target: KubectlTarget) {}

  buildCmd(command: string): string[] {
    return [...this.baseArgs(), "--", "sh", "-c", command]
  }

  buildArgv(args: string[]): string[] {
    return [...this.baseArgs(), "--", ...args]
  }

  escapeArg(arg: string): string {
    return arg
  }

  private baseArgs(): string[] {
    const args = [
      "kubectl",
      "exec",
      "-i",
      this.target.podName,
      "-n",
      this.target.namespace,
    ]
    if (this.target.container) args.push("-c", this.target.container)
    if (this.target.kubeContext) args.push("--context", this.target.kubeContext)
    return args
  }
}

// ── Docker exec adapter ────────────────────────────────────

export class DockerExecAdapter implements TransportAdapter {
  readonly kind = "docker-exec"

  constructor(private readonly containerName: string) {}

  buildCmd(command: string): string[] {
    return ["docker", "exec", this.containerName, "sh", "-c", command]
  }

  buildArgv(args: string[]): string[] {
    return ["docker", "exec", this.containerName, ...args]
  }

  escapeArg(arg: string): string {
    return bashEscape(arg)
  }
}

// ── Docker compose exec adapter ────────────────────────────

export class DockerComposeExecAdapter implements TransportAdapter {
  readonly kind = "docker-compose-exec"

  constructor(
    private readonly project: string,
    private readonly service: string
  ) {}

  buildCmd(command: string): string[] {
    return [
      "docker",
      "compose",
      "-p",
      this.project,
      "exec",
      "-T",
      this.service,
      "sh",
      "-c",
      command,
    ]
  }

  buildArgv(args: string[]): string[] {
    return [
      "docker",
      "compose",
      "-p",
      this.project,
      "exec",
      "-T",
      this.service,
      ...args,
    ]
  }

  escapeArg(arg: string): string {
    return bashEscape(arg)
  }
}

// ── Nested adapter (SSH → Docker exec) ─────────────────────

export class NestedAdapter implements TransportAdapter {
  readonly kind: string

  constructor(
    private readonly outer: TransportAdapter,
    private readonly inner: TransportAdapter
  ) {
    this.kind = `${outer.kind}+${inner.kind}`
  }

  buildCmd(command: string): string[] {
    const innerCmd = this.inner.buildCmd(command)
    const innerStr = innerCmd.map((a) => this.outer.escapeArg(a)).join(" ")
    return this.outer.buildCmd(innerStr)
  }

  buildArgv(args: string[]): string[] {
    const innerCmd = this.inner.buildArgv(args)
    const innerStr = innerCmd.map((a) => this.outer.escapeArg(a)).join(" ")
    return this.outer.buildCmd(innerStr)
  }

  escapeArg(arg: string): string {
    return this.outer.escapeArg(this.inner.escapeArg(arg))
  }
}
