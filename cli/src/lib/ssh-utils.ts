import { execFileSync, spawnSync } from "node:child_process";

/**
 * Clear a stale SSH host key if the remote host identity has changed.
 * This happens when a sandbox is recreated with the same hostname.
 * Returns true if a stale key was found and removed.
 */
export function clearStaleHostKey(host: string, port: number = 22): boolean {
  try {
    const hostSpec = port !== 22 ? `[${host}]:${port}` : host;

    // Check if we have a stored key for this host
    const lookup = spawnSync("ssh-keygen", ["-F", hostSpec], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (lookup.status !== 0 || !lookup.stdout?.trim()) {
      return false; // No stored key
    }

    // Probe the host to check if key has changed
    const probe = spawnSync("ssh", [
      "-o", "StrictHostKeyChecking=yes",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      ...(port !== 22 ? ["-p", String(port)] : []),
      host,
      "true",
    ], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });

    const stderr = probe.stderr ?? "";
    if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
      spawnSync("ssh-keygen", ["-R", hostSpec], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export type TtyMode = 'force' | 'basic' | 'none';
export type HostKeyMode = 'strict' | 'accept-new' | 'none';

export interface SshOptions {
  host: string;
  port?: number;
  user?: string;
  identity?: string;
  tty: TtyMode;
  dir?: string;
  sudo?: boolean;
  hostKeyCheck: HostKeyMode;
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
  const args: string[] = [];

  // TTY
  if (opts.tty === 'force') {
    args.push('-tt');
    const term = process.env.TERM || 'xterm-256color';
    args.push('-o', `SetEnv=TERM=${term}`);
  } else if (opts.tty === 'basic') {
    args.push('-t');
  } else {
    args.push('-T');
  }

  // Host key checking
  if (opts.hostKeyCheck === 'strict') {
    args.push('-o', 'StrictHostKeyChecking=yes');
  } else if (opts.hostKeyCheck === 'accept-new') {
    args.push('-o', 'StrictHostKeyChecking=accept-new');
  } else {
    args.push('-o', 'StrictHostKeyChecking=no');
    args.push('-o', 'UserKnownHostsFile=/dev/null');
  }

  // Keepalive
  args.push('-o', 'ServerAliveInterval=30');
  args.push('-o', 'ServerAliveCountMax=3');

  // Identity file
  if (opts.identity) {
    args.push('-i', opts.identity);
  }

  // Port
  if (opts.port && opts.port !== 22) {
    args.push('-p', String(opts.port));
  }

  // User@Host
  const target = opts.user ? `${opts.user}@${opts.host}` : opts.host;
  args.push(target);

  return args;
}

export interface KubectlExecOptions {
  podName: string;
  namespace: string;
  container?: string;
  kubeContext?: string;
  interactive: boolean;
}

/**
 * Build kubectl exec args (not including "kubectl" binary).
 */
export function buildKubectlExecArgs(opts: KubectlExecOptions): string[] {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  const args = [
    "exec",
    ...(opts.interactive && isTTY ? ["-it"] : ["-i"]),
    opts.podName,
    "-n", opts.namespace,
  ];

  if (opts.container) {
    args.push("-c", opts.container);
  }

  if (opts.kubeContext) {
    args.push("--context", opts.kubeContext);
  }

  return args;
}

/**
 * Build the full command to execute on a remote machine via SSH.
 * Handles --dir (cd) and --sudo wrapping.
 */
export function wrapRemoteCommand(cmd: string[], opts: { dir?: string; sudo?: boolean }): string[] {
  let shellCmd = cmd.join(' ');

  if (opts.dir) {
    shellCmd = `cd ${escapeShellArg(opts.dir)} && ${shellCmd}`;
  }

  if (opts.sudo) {
    shellCmd = `sudo -s -- bash -c ${escapeShellArg(shellCmd)}`;
  }

  if (opts.dir || opts.sudo) {
    return ["bash", "-c", shellCmd];
  }

  return cmd;
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
