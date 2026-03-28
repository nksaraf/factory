import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import type { TunnelBackend, TunnelHandle } from "../tunnel-backend.js";

interface SshTunnelHandle extends TunnelHandle {
  process?: ChildProcess;
}

/**
 * SshBackend — spawns `ssh -L` tunnels to forward remote services
 * through SSH bastion hosts.
 *
 * The spec encodes bastion info in the connectionString field:
 *   ssh://[user@]bastion-host[:bastion-port]
 *
 * The tunnel forwards:
 *   localhost:localPort → remoteHost:remotePort
 * via the bastion.
 */
export class SshBackend implements TunnelBackend {
  readonly kind = "ssh" as const;

  async start(spec: TunnelSpec): Promise<SshTunnelHandle> {
    const bastion = parseBastionFromSpec(spec);
    const bindSpec = `${spec.localPort}:${spec.remoteHost}:${spec.remotePort}`;

    const args = [
      "-N",                                 // no remote command
      "-L", bindSpec,                       // local port forward
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
    ];

    if (bastion.port !== 22) {
      args.push("-p", String(bastion.port));
    }

    if (bastion.user) {
      args.push(`${bastion.user}@${bastion.host}`);
    } else {
      args.push(bastion.host);
    }

    const child = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const handle: SshTunnelHandle = {
      spec,
      pid: child.pid,
      status: "starting",
      process: child,
    };

    child.on("exit", () => {
      handle.status = "stopped";
    });

    child.on("error", () => {
      handle.status = "unhealthy";
    });

    // Wait briefly for the tunnel to bind
    await waitForPort(spec.localPort, 5000);
    handle.status = "healthy";

    return handle;
  }

  async stop(handle: TunnelHandle): Promise<void> {
    const sshHandle = handle as SshTunnelHandle;
    if (sshHandle.process && !sshHandle.process.killed) {
      sshHandle.process.kill("SIGTERM");
      // Give it a moment to exit cleanly
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (sshHandle.process && !sshHandle.process.killed) {
            sshHandle.process.kill("SIGKILL");
          }
          resolve();
        }, 3000);
        sshHandle.process!.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    handle.status = "stopped";
  }

  async checkHealth(handle: TunnelHandle): Promise<boolean> {
    const sshHandle = handle as SshTunnelHandle;
    if (!sshHandle.process || sshHandle.process.killed) {
      return false;
    }
    return tcpCheck("127.0.0.1", handle.spec.localPort, 2000);
  }
}

interface BastionInfo {
  host: string;
  port: number;
  user?: string;
}

function parseBastionFromSpec(spec: TunnelSpec): BastionInfo {
  const cs = spec.connectionString;
  if (!cs) {
    throw new Error(
      `SSH tunnel spec "${spec.name}" requires a connectionString with bastion info, e.g. ssh://user@bastion:22`
    );
  }

  // Parse ssh://[user@]host[:port]
  const match = cs.match(/^ssh:\/\/(?:([^@]+)@)?([^:]+)(?::(\d+))?$/);
  if (!match) {
    throw new Error(
      `Invalid SSH bastion connectionString: "${cs}". Expected: ssh://[user@]host[:port]`
    );
  }

  return {
    user: match[1],
    host: match[2],
    port: match[3] ? parseInt(match[3], 10) : 22,
  };
}

function tcpCheck(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(); // best effort — tunnel may still be establishing
        return;
      }
      tcpCheck("127.0.0.1", port, 500).then((ok) => {
        if (ok) {
          resolve();
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}
