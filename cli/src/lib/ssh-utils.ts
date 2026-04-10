import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Clear a stale SSH host key if the remote host identity has changed.
 * This happens when a sandbox is recreated with the same hostname.
 * Returns true if a stale key was found and removed.
 */
export function clearStaleHostKey(host: string, port: number = 22): boolean {
  try {
    const hostSpec = port !== 22 ? `[${host}]:${port}` : host

    // Check if we have a stored key for this host
    const lookup = spawnSync("ssh-keygen", ["-F", hostSpec], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (lookup.status !== 0 || !lookup.stdout?.trim()) {
      return false // No stored key
    }

    // Probe the host to check if key has changed
    const probe = spawnSync(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        ...(port !== 22 ? ["-p", String(port)] : []),
        host,
        "true",
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      }
    )

    const stderr = probe.stderr ?? ""
    if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
      spawnSync("ssh-keygen", ["-R", hostSpec], {
        stdio: ["ignore", "ignore", "ignore"],
      })
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Format a ProxyJump spec string: [user@]host[:port]
 */
export function formatJumpSpec(
  host: string,
  user?: string,
  port?: number
): string {
  let jump = user ? `${user}@${host}` : host
  if (port) jump += `:${port}`
  return jump
}

export type TtyMode = "force" | "basic" | "none"
export type HostKeyMode = "strict" | "accept-new" | "none"

export interface SshOptions {
  host: string
  port?: number
  user?: string
  identity?: string
  tty: TtyMode
  dir?: string
  sudo?: boolean
  hostKeyCheck: HostKeyMode
  jumpHost?: string
  jumpUser?: string
  jumpPort?: number
  /** Extra args inserted before the user@host target (e.g. -N, -L). */
  extraArgs?: string[]
}

/**
 * Build SSH command args (not including the "ssh" binary itself).
 *
 * TTY modes:
 * - force: -tt + SetEnv TERM (for interactive shells)
 * - basic: -t (for remote commands that need a terminal)
 * - none: -T (for piped/scripted execution)
 *
 * Host key modes:
 * - strict: StrictHostKeyChecking=yes
 * - accept-new: StrictHostKeyChecking=accept-new (default for interactive)
 * - none: StrictHostKeyChecking=no + UserKnownHostsFile=/dev/null (for scripted)
 */
export function buildSshArgs(opts: SshOptions): string[] {
  const args: string[] = []

  // TTY
  if (opts.tty === "force") {
    args.push("-tt")
    const term = process.env.TERM || "xterm-256color"
    args.push("-o", `SetEnv=TERM=${term}`)
  } else if (opts.tty === "basic") {
    args.push("-t")
  } else {
    args.push("-T")
  }

  // Host key checking
  if (opts.hostKeyCheck === "strict") {
    args.push("-o", "StrictHostKeyChecking=yes")
  } else if (opts.hostKeyCheck === "accept-new") {
    args.push("-o", "StrictHostKeyChecking=accept-new")
  } else {
    args.push("-o", "StrictHostKeyChecking=no")
    args.push("-o", "UserKnownHostsFile=/dev/null")
  }

  // Keepalive
  args.push("-o", "ServerAliveInterval=30")
  args.push("-o", "ServerAliveCountMax=3")

  // ProxyJump (jump host / bastion)
  if (opts.jumpHost) {
    args.push("-J", formatJumpSpec(opts.jumpHost, opts.jumpUser, opts.jumpPort))
  }

  // Identity file
  if (opts.identity) {
    args.push("-i", opts.identity)
  }

  // Port
  if (opts.port && opts.port !== 22) {
    args.push("-p", String(opts.port))
  }

  // Extra args (e.g. -N -L for port forwarding) before the target
  if (opts.extraArgs) {
    args.push(...opts.extraArgs)
  }

  // User@Host (must be last)
  const target = opts.user ? `${opts.user}@${opts.host}` : opts.host
  args.push(target)

  return args
}

export interface KubectlExecOptions {
  podName: string
  namespace: string
  container?: string
  kubeContext?: string
  interactive: boolean
}

/**
 * Build kubectl exec args (not including "kubectl" binary).
 */
export function buildKubectlExecArgs(opts: KubectlExecOptions): string[] {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY
  const args = [
    "exec",
    ...(opts.interactive && isTTY ? ["-it"] : ["-i"]),
    opts.podName,
    "-n",
    opts.namespace,
  ]

  if (opts.container) {
    args.push("-c", opts.container)
  }

  if (opts.kubeContext) {
    args.push("--context", opts.kubeContext)
  }

  return args
}

/**
 * Build the full command to execute on a remote machine via SSH.
 * Handles --dir (cd) and --sudo wrapping.
 */
export function wrapRemoteCommand(
  cmd: string[],
  opts: { dir?: string; sudo?: boolean }
): string[] {
  let shellCmd = cmd.join(" ")

  if (opts.dir) {
    shellCmd = `cd ${escapeShellArg(opts.dir)} && ${shellCmd}`
  }

  if (opts.sudo) {
    shellCmd = `sudo -s -- bash -c ${escapeShellArg(shellCmd)}`
  }

  if (opts.dir || opts.sudo) {
    return ["bash", "-c", shellCmd]
  }

  return cmd
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

// ─── SSH Config Sync Helpers ─────────────────────────────────

const DX_CONFIG_BEGIN = "# --- BEGIN dx-managed ---"
const DX_CONFIG_END = "# --- END dx-managed ---"

export function generateSshConfigBlocks(
  targets: Array<{
    slug: string
    host: string
    user: string
    port?: number
    jumpHost?: string
    jumpUser?: string
    jumpPort?: number
    identityFile?: string
    kind: string
    id: string
  }>
): string[] {
  const lines: string[] = [DX_CONFIG_BEGIN, ""]

  for (const t of targets) {
    if (!t.host) continue
    lines.push(`Host ${t.slug}`)
    lines.push(`  HostName ${t.host}`)
    lines.push(`  User ${t.user}`)
    if (t.port && t.port !== 22) {
      lines.push(`  Port ${t.port}`)
    }
    if (t.jumpHost) {
      lines.push(
        `  ProxyJump ${formatJumpSpec(t.jumpHost, t.jumpUser, t.jumpPort)}`
      )
    }
    if (t.identityFile) {
      lines.push(`  IdentityFile ${t.identityFile}`)
    }
    lines.push(`  StrictHostKeyChecking accept-new`)
    lines.push(`  # dx:kind=${t.kind} dx:id=${t.id}`)
    lines.push("")
  }

  lines.push(DX_CONFIG_END)
  return [lines.join("\n")]
}

export function mergeSshConfig(configPath: string, dxBlock: string): void {
  mkdirSync(join(configPath, ".."), { recursive: true, mode: 0o700 })

  let existing = ""
  if (existsSync(configPath)) {
    existing = readFileSync(configPath, "utf-8")
  }

  // Remove old dx-managed block
  const beginIdx = existing.indexOf(DX_CONFIG_BEGIN)
  const endIdx = existing.indexOf(DX_CONFIG_END)
  if (beginIdx !== -1 && endIdx !== -1) {
    existing =
      existing.slice(0, beginIdx) +
      existing.slice(endIdx + DX_CONFIG_END.length)
  }

  // Trim trailing whitespace, add dx block at end
  existing = existing.trimEnd()
  const newContent = existing ? `${existing}\n\n${dxBlock}\n` : `${dxBlock}\n`

  writeFileSync(configPath, newContent, { mode: 0o600 })
}
