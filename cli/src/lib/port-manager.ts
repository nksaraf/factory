/**
 * Port allocation and persistence.
 *
 * Auto-assigns free host ports to compose services and persists assignments.
 */

import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_PORT_RETRIES = 100;

interface PortReservation {
  port: number;
  pinned: boolean;
}

export interface PortRequest {
  name: string;
  preferred?: number;
}

/**
 * Check if a port is available to bind on 127.0.0.1.
 */
export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Allocate a single free port by binding to :0, avoiding reserved ports.
 */
export async function allocatePort(reserved: Set<number>): Promise<number> {
  for (let i = 0; i < MAX_PORT_RETRIES; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.once("listening", () => {
        const addr = server.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        server.close(() => resolve(p));
      });
      server.listen(0, "127.0.0.1");
    });
    if (!reserved.has(port)) return port;
  }
  throw new Error("Failed to allocate a free port after retries");
}

/**
 * Manages persistent port reservations for compose services.
 */
export class PortManager {
  private readonly reservationsFile: string;

  constructor(private readonly stateDir: string) {
    this.reservationsFile = join(stateDir, "ports.json");
  }

  private read(): Record<string, PortReservation> {
    if (!existsSync(this.reservationsFile)) return {};
    try {
      const raw = readFileSync(this.reservationsFile, "utf-8");
      return JSON.parse(raw) as Record<string, PortReservation>;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, PortReservation>): void {
    mkdirSync(this.stateDir, { recursive: true });
    writeFileSync(this.reservationsFile, JSON.stringify(data, null, 2) + "\n");
  }

  /**
   * Resolve ports for a list of requests. Reuses persistent assignments when
   * possible, respects pinned ports, and tries preferred ports before falling
   * back to OS-assigned dynamic ports.
   */
  async resolve(
    requests: PortRequest[],
  ): Promise<Record<string, number>> {
    const reservations = this.read();
    const allReserved = new Set<number>(
      Object.values(reservations).map((r) => r.port),
    );
    const result: Record<string, number> = {};

    for (const req of requests) {
      const { name, preferred } = req;
      const existing = reservations[name];

      if (existing && existing.pinned) {
        if (!(await isPortFree(existing.port))) {
          throw new Error(
            `Pinned port ${existing.port} for ${name} is in use by another process`,
          );
        }
        result[name] = existing.port;
      } else if (existing && (await isPortFree(existing.port))) {
        result[name] = existing.port;
      } else {
        let port: number | undefined;
        if (
          preferred !== undefined &&
          !allReserved.has(preferred) &&
          (await isPortFree(preferred))
        ) {
          port = preferred;
        } else {
          port = await allocatePort(allReserved);
        }
        result[name] = port;
        allReserved.add(port);
        reservations[name] = { port, pinned: false };
      }

      if (!reservations[name]) {
        reservations[name] = { port: result[name], pinned: false };
      }
    }

    this.write(reservations);
    return result;
  }

  /**
   * Pin a service to a specific port. Throws if the port conflicts with
   * another service's reservation.
   */
  pin(service: string, port: number): void {
    const reservations = this.read();
    for (const [k, v] of Object.entries(reservations)) {
      if (v.port === port && k !== service) {
        throw new Error(`Port ${port} is already reserved by ${k}`);
      }
    }
    reservations[service] = { port, pinned: true };
    this.write(reservations);
  }

  /**
   * Clear reservations. If a service name is given, only that service is
   * removed; otherwise all reservations are cleared.
   */
  clear(service?: string): void {
    if (service) {
      const reservations = this.read();
      if (service in reservations) {
        delete reservations[service];
        this.write(reservations);
      }
    } else {
      this.write({});
    }
  }

  /**
   * Return the current reservations as a sorted array.
   */
  status(): Array<{ name: string; port: number; pinned: boolean }> {
    const reservations = this.read();
    return Object.entries(reservations)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        port: data.port,
        pinned: data.pinned,
      }));
  }

  /**
   * Write port assignments as environment variables to a file.
   *
   * If the key already looks like an env var (uppercase with underscores),
   * use it directly. Otherwise convert from service-name to SERVICE_NAME_PORT.
   */
  writeEnvFile(ports: Record<string, number>, envPath: string): void {
    const dir = dirname(envPath);
    mkdirSync(dir, { recursive: true });

    const lines: string[] = [];
    for (const name of Object.keys(ports).sort()) {
      const port = ports[name];
      let varName: string;
      if (name === name.toUpperCase() && name.includes("_")) {
        varName = name;
      } else {
        varName = name.toUpperCase().replace(/-/g, "_") + "_PORT";
      }
      lines.push(`${varName}=${port}`);
    }
    writeFileSync(envPath, lines.join("\n") + "\n");
  }
}
