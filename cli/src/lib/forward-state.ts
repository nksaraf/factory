/**
 * Global state manager for active SSH port forwards.
 *
 * Persists to ~/.config/dx/forwards.json so `dx forward list` / `dx forward close`
 * work across terminal sessions. Dead PIDs are pruned on every read.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { isPortFree } from "./port-manager.js"
import {
  type SshOptions,
  buildSshArgs,
  clearStaleHostKey,
} from "./ssh-utils.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForwardEntry {
  id: string
  pid: number
  localPort: number
  remotePort: number
  remoteHost: string
  displayName: string
  startedAt: string
}

// ---------------------------------------------------------------------------
// State file (resolve lazily so tests can mock homedir before first use)
// ---------------------------------------------------------------------------

function stateDir(): string {
  return join(homedir(), ".config", "dx")
}

function stateFile(): string {
  return join(stateDir(), "forwards.json")
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function shortId(): string {
  return randomBytes(3).toString("hex")
}

// ---------------------------------------------------------------------------
// ForwardState
// ---------------------------------------------------------------------------

export class ForwardState {
  private read(): ForwardEntry[] {
    const file = stateFile()
    if (!existsSync(file)) return []
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as ForwardEntry[]
    } catch {
      return []
    }
  }

  private write(entries: ForwardEntry[]): void {
    mkdirSync(stateDir(), { recursive: true })
    // Atomic write: temp file + rename to avoid partial reads from concurrent processes
    const file = stateFile()
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n")
    renameSync(tmp, file)
  }

  /** Read entries, pruning any whose PID is dead. */
  list(): ForwardEntry[] {
    const entries = this.read()
    const alive = entries.filter((e) => isPidAlive(e.pid))
    if (alive.length !== entries.length) {
      this.write(alive)
    }
    return alive
  }

  /** Add an entry, return the assigned id. */
  add(entry: Omit<ForwardEntry, "id">): string {
    const entries = this.list() // prunes dead
    const existing = new Set(entries.map((e) => e.id))
    let id = shortId()
    while (existing.has(id)) id = shortId()
    entries.push({ ...entry, id })
    this.write(entries)
    return id
  }

  /** Remove by id. Returns true if found. */
  remove(id: string): boolean {
    const entries = this.list() // prunes dead
    const filtered = entries.filter((e) => e.id !== id)
    if (filtered.length === entries.length) return false
    this.write(filtered)
    return true
  }

  /** Remove all entries. */
  clear(): void {
    this.write([])
  }

  /** Get all local ports currently forwarded (alive only). */
  reservedPorts(): Set<number> {
    return new Set(this.list().map((e) => e.localPort))
  }
}

// ---------------------------------------------------------------------------
// Port finding
// ---------------------------------------------------------------------------

/**
 * Find a free local port, checking against both global forwards and OS-level
 * port availability.
 *
 * @param preferred - The port to try first.
 * @param explicit  - If true (user passed --as), error if the port is taken.
 * @returns The free port number.
 */
export async function findFreePort(
  preferred: number,
  explicit: boolean
): Promise<number> {
  const forwardPorts = new ForwardState().reservedPorts()

  const isFree = async (port: number) =>
    !forwardPorts.has(port) && (await isPortFree(port))

  if (await isFree(preferred)) return preferred

  if (explicit) {
    throw new Error(`Port ${preferred} is already in use`)
  }

  // Auto-increment from preferred+1
  for (let p = preferred + 1; p < preferred + 100; p++) {
    if (p > 65535) break
    if (await isFree(p)) return p
  }

  throw new Error(`Could not find a free port near ${preferred}`)
}

// ---------------------------------------------------------------------------
// Shared SSH forward spawner
// ---------------------------------------------------------------------------

export interface SshForwardOptions {
  sshHost: string
  sshPort?: number
  sshUser?: string
  identityFile?: string
  jumpHost?: string
  jumpUser?: string
  jumpPort?: number
  localPort: number
  remotePort: number
  /** If true, spawn detached so the SSH process outlives the CLI. */
  background?: boolean
}

/**
 * Spawn an `ssh -N -L` process for port forwarding.
 * Returns the ChildProcess. Caller is responsible for lifecycle.
 *
 * When `background` is true the process is detached with all stdio closed
 * and `unref()`'d so the parent CLI can exit immediately.
 */
export function spawnSshForward(opts: SshForwardOptions): ChildProcess {
  clearStaleHostKey(opts.sshHost, opts.sshPort ?? 22)

  const forwardSpec = `${opts.localPort}:localhost:${opts.remotePort}`
  const sshArgs = buildSshArgs({
    host: opts.sshHost,
    port: opts.sshPort,
    user: opts.sshUser,
    identity: opts.identityFile,
    tty: "none",
    hostKeyCheck: "accept-new",
    jumpHost: opts.jumpHost,
    jumpUser: opts.jumpUser,
    jumpPort: opts.jumpPort,
    extraArgs: ["-N", "-o", "ExitOnForwardFailure=yes", "-L", forwardSpec],
  })

  const child = spawn("ssh", sshArgs, {
    stdio: opts.background ? "ignore" : ["ignore", "pipe", "pipe"],
    detached: !!opts.background,
  })

  if (opts.background) child.unref()

  return child
}
