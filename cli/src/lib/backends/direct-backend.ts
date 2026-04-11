import { createConnection } from "node:net"

import type { TunnelSpec } from "@smp/factory-shared/connection-context-schemas"

import type { TunnelBackend, TunnelHandle } from "../tunnel-backend.js"

/**
 * DirectBackend — "no tunnel" backend.
 * Passes connection strings through without spawning any processes.
 * Optionally validates that the remote host:port is reachable.
 */
export class DirectBackend implements TunnelBackend {
  readonly kind = "direct" as const

  async start(spec: TunnelSpec): Promise<TunnelHandle> {
    return {
      spec,
      status: "healthy",
    }
  }

  async stop(_handle: TunnelHandle): Promise<void> {
    // No process to stop for direct connections
  }

  async checkHealth(handle: TunnelHandle): Promise<boolean> {
    // For direct connections with an opaque connection string, assume healthy
    if (handle.spec.connectionString) {
      return true
    }

    // Attempt a TCP connect check if we have host:port info
    return tcpCheck(handle.spec.remoteHost, handle.spec.remotePort, 2000)
  }
}

function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs })
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}
