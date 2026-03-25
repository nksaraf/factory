import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { TunnelBackendKind, TunnelSpec } from "@smp/factory-shared/connection-context-schemas";

import type { TunnelBackend, TunnelHandle, TunnelStatus } from "./tunnel-backend.js";
import { DirectBackend } from "./backends/direct-backend.js";

interface TunnelStateEntry {
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  backend: string;
  pid?: number;
  status: string;
  connectionString?: string;
}

const TUNNELS_FILE = join(".dx", ".tunnels.yaml");

export class TunnelManager {
  private readonly rootDir: string;
  private readonly backends: Record<string, TunnelBackend>;
  private handles: TunnelHandle[] = [];

  constructor(
    rootDir: string,
    backends?: Partial<Record<TunnelBackendKind, TunnelBackend>>
  ) {
    this.rootDir = rootDir;
    this.backends = {
      direct: new DirectBackend(),
      ...backends,
    };
  }

  /** Start all tunnels, routing each spec to the appropriate backend. */
  async startAll(specs: TunnelSpec[]): Promise<TunnelHandle[]> {
    this.handles = [];
    for (const spec of specs) {
      const backend = this.backends[spec.backend];
      if (!backend) {
        throw new Error(
          `No backend registered for "${spec.backend}". Available: ${Object.keys(this.backends).join(", ")}`
        );
      }
      const handle = await backend.start(spec);
      this.handles.push(handle);
    }
    this.saveState();
    return this.handles;
  }

  /** Stop all active tunnels. */
  async stopAll(): Promise<void> {
    for (const handle of this.handles) {
      const backend = this.backends[handle.spec.backend];
      if (backend) {
        try {
          await backend.stop(handle);
        } catch {
          // Best effort — tunnel may already be stopped
        }
      }
      handle.status = "stopped";
    }
    this.handles = [];
    this.cleanupState();
  }

  /** Get status of all tunnels (reads from state file if no active handles). */
  getStatus(): TunnelStatus[] {
    if (this.handles.length > 0) {
      return this.handles.map(toStatus);
    }
    return this.loadState();
  }

  /** Check health of all active tunnels. */
  async checkAllHealth(): Promise<TunnelStatus[]> {
    for (const handle of this.handles) {
      const backend = this.backends[handle.spec.backend];
      if (backend) {
        try {
          const healthy = await backend.checkHealth(handle);
          handle.status = healthy ? "healthy" : "unhealthy";
        } catch {
          handle.status = "unhealthy";
        }
      }
    }
    this.saveState();
    return this.handles.map(toStatus);
  }

  private saveState(): void {
    const path = join(this.rootDir, TUNNELS_FILE);
    mkdirSync(dirname(path), { recursive: true });
    const entries: TunnelStateEntry[] = this.handles.map((h) => ({
      name: h.spec.name,
      localPort: h.spec.localPort,
      remoteHost: h.spec.remoteHost,
      remotePort: h.spec.remotePort,
      backend: h.spec.backend,
      pid: h.pid,
      status: h.status,
      connectionString: h.spec.connectionString,
    }));
    writeFileSync(path, stringifyYaml({ tunnels: entries }), "utf8");
  }

  private loadState(): TunnelStatus[] {
    const path = join(this.rootDir, TUNNELS_FILE);
    if (!existsSync(path)) return [];
    try {
      const raw = parseYaml(readFileSync(path, "utf8")) as { tunnels?: TunnelStateEntry[] };
      return (raw.tunnels ?? []).map((e) => ({
        name: e.name,
        localPort: e.localPort,
        remoteHost: e.remoteHost,
        remotePort: e.remotePort,
        backend: e.backend as TunnelBackendKind,
        status: e.status as TunnelHandle["status"],
        connectionString: e.connectionString,
      }));
    } catch {
      return [];
    }
  }

  private cleanupState(): void {
    const path = join(this.rootDir, TUNNELS_FILE);
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

function toStatus(handle: TunnelHandle): TunnelStatus {
  return {
    name: handle.spec.name,
    localPort: handle.spec.localPort,
    remoteHost: handle.spec.remoteHost,
    remotePort: handle.spec.remotePort,
    backend: handle.spec.backend,
    status: handle.status,
    connectionString: handle.spec.connectionString,
  };
}
