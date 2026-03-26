/**
 * Dev server management controller.
 *
 * Manages native dev servers (Node/Python/Java) as background daemons.
 * Port sharing: native dev and Docker compose use the SAME port reservation
 * (keyed by the service name). Starting native dev stops the Docker container
 * for that service, and vice-versa.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import type { DxComponentYaml, DxYaml } from "@smp/factory-shared/config-schemas";

import { detectServiceType, type ServiceType } from "./detect-service-type.js";
import { PortManager, isPortFree } from "./port-manager.js";
import { composeIsRunning, composeStop } from "./docker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedComponent {
  name: string;
  absPath: string;
  type: ServiceType;
  preferredPort?: number;
}

export interface StartResult {
  name: string;
  pid: number;
  port: number;
  alreadyRunning: boolean;
  stoppedDocker: boolean;
}

export interface StopResult {
  name: string;
  pid: number;
}

export interface DevServerInfo {
  name: string;
  port: number | null;
  pid: number | null;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Dev command builders
// ---------------------------------------------------------------------------

function buildDevCmd(
  type: ServiceType,
  port: number,
  absPath: string,
): string[] {
  switch (type) {
    case "node":
      return ["pnpm", "dev", "--port", String(port)];
    case "python":
      if (existsSync(join(absPath, "main.py"))) {
        return ["fastapi", "dev", "--port", String(port)];
      }
      return [
        "uvicorn",
        "main:app",
        "--reload",
        "--host",
        "0.0.0.0",
        "--port",
        String(port),
      ];
    case "java":
      return [
        "mvn",
        "spring-boot:run",
        `-Dspring-boot.run.arguments=--server.port=${port}`,
      ];
  }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (isNaN(pid)) return null;
    if (!isProcessRunning(pid)) {
      unlinkSync(pidFile);
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function killProcessTree(pid: number): void {
  // Send SIGTERM to process group (negative PID)
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  // Poll for exit up to ~2 seconds
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // Process is gone
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  // Force kill
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* noop */
    }
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class DevController {
  private readonly stateDir: string;
  private readonly portManager: PortManager;
  private readonly composeFile: string;
  private readonly projectName: string;

  constructor(
    private readonly rootDir: string,
    private readonly moduleConfig: DxYaml,
    private readonly componentConfigs: Record<string, DxComponentYaml>,
  ) {
    this.stateDir = join(rootDir, ".dx", "dev");
    this.portManager = new PortManager(join(rootDir, ".dx"));
    this.composeFile = join(rootDir, ".dx", "generated", "docker-compose.yaml");
    this.projectName = basename(rootDir);
  }

  // ------------------------------------------------------------------
  // Resolve
  // ------------------------------------------------------------------

  resolveComponent(name: string): ResolvedComponent {
    const ref = this.moduleConfig.components[name];
    if (!ref) {
      const available = Object.keys(this.moduleConfig.components).join(", ");
      throw new Error(
        `Component "${name}" not found. Available: ${available}`,
      );
    }

    const absPath = resolve(this.rootDir, ref.path);

    // Use explicit type from dx.yaml, or auto-detect from filesystem
    const type: ServiceType | null =
      (ref as { type?: ServiceType }).type ?? detectServiceType(absPath);

    if (!type) {
      throw new Error(
        `Cannot determine service type for "${name}" at ${absPath}. ` +
          `Add a "type" field (node/python/java) to your dx.yaml component config.`,
      );
    }

    return {
      name,
      absPath,
      type,
      preferredPort: ref.port ?? undefined,
    };
  }

  // ------------------------------------------------------------------
  // Port environment for sibling discovery
  // ------------------------------------------------------------------

  private async allPortsEnv(): Promise<Record<string, string>> {
    const requests = [
      ...Object.entries(this.moduleConfig.components).map(([name, ref]) => ({
        name,
        preferred: ref.port ?? undefined,
      })),
      ...Object.entries(this.moduleConfig.resources).map(
        ([name, dep]) => ({
          name,
          preferred: dep.port,
        }),
      ),
    ];

    const ports = await this.portManager.resolve(requests);
    const env: Record<string, string> = {};
    for (const [name, port] of Object.entries(ports)) {
      const varName = name.toUpperCase().replace(/-/g, "_") + "_PORT";
      env[varName] = String(port);
    }
    return env;
  }

  // ------------------------------------------------------------------
  // Docker coordination
  // ------------------------------------------------------------------

  private composeServiceName(componentName: string): string {
    const mod = this.moduleConfig.module;
    return `${mod}-${componentName}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private stopDockerContainer(componentName: string): boolean {
    if (!existsSync(this.composeFile)) return false;
    const sn = this.composeServiceName(componentName);
    if (!composeIsRunning(this.composeFile, sn, { projectName: this.projectName })) {
      return false;
    }
    composeStop(this.composeFile, [sn], { projectName: this.projectName });
    return true;
  }

  // ------------------------------------------------------------------
  // start
  // ------------------------------------------------------------------

  async start(
    component: string,
    opts?: { port?: number },
  ): Promise<StartResult> {
    const resolved = this.resolveComponent(component);

    mkdirSync(this.stateDir, { recursive: true });

    const pidFile = join(this.stateDir, `${resolved.name}.pid`);
    const portFile = join(this.stateDir, `${resolved.name}.port`);
    const logFile = join(this.stateDir, `${resolved.name}.log`);

    // Already running?
    const existingPid = readPid(pidFile);
    if (existingPid !== null) {
      const existingPort = existsSync(portFile)
        ? parseInt(readFileSync(portFile, "utf-8").trim(), 10)
        : 0;
      return {
        name: resolved.name,
        pid: existingPid,
        port: existingPort,
        alreadyRunning: true,
        stoppedDocker: false,
      };
    }

    // Stop Docker container for this service
    const stoppedDocker = this.stopDockerContainer(resolved.name);

    // Allocate port
    let actualPort: number;
    if (opts?.port !== undefined) {
      if (!(await isPortFree(opts.port))) {
        throw new Error(`Port ${opts.port} is already in use`);
      }
      actualPort = opts.port;
    } else {
      const assigned = await this.portManager.resolve([
        { name: resolved.name, preferred: resolved.preferredPort },
      ]);
      actualPort = assigned[resolved.name];
    }

    // Build command and environment
    const cmd = buildDevCmd(resolved.type, actualPort, resolved.absPath);
    const portEnv = await this.allPortsEnv();
    const procEnv = {
      ...process.env,
      ...portEnv,
      PORT: String(actualPort),
    };

    // Spawn background process
    const logFd = openSync(logFile, "w");
    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd: resolved.absPath,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: procEnv,
    });
    proc.unref();

    // Write state files
    const pid = proc.pid!;
    writeFileSync(pidFile, String(pid));
    writeFileSync(portFile, String(actualPort));

    return {
      name: resolved.name,
      pid,
      port: actualPort,
      alreadyRunning: false,
      stoppedDocker,
    };
  }

  // ------------------------------------------------------------------
  // stop
  // ------------------------------------------------------------------

  stop(component?: string): StopResult[] {
    const stopped: StopResult[] = [];

    if (!existsSync(this.stateDir)) return stopped;

    if (component === undefined) {
      // Stop all
      for (const entry of readdirSync(this.stateDir)) {
        if (!entry.endsWith(".pid")) continue;
        const name = entry.replace(/\.pid$/, "");
        const pidFile = join(this.stateDir, entry);
        const portFile = join(this.stateDir, `${name}.port`);
        const pid = readPid(pidFile);
        if (pid !== null) {
          killProcessTree(pid);
          stopped.push({ name, pid });
        }
        try {
          unlinkSync(pidFile);
        } catch {}
        try {
          unlinkSync(portFile);
        } catch {}
      }
      return stopped;
    }

    const resolved = this.resolveComponent(component);
    const pidFile = join(this.stateDir, `${resolved.name}.pid`);
    const portFile = join(this.stateDir, `${resolved.name}.port`);

    const pid = readPid(pidFile);
    if (pid !== null) {
      killProcessTree(pid);
      stopped.push({ name: resolved.name, pid });
    }
    // Always clean up state files (handles stale PIDs too)
    try {
      unlinkSync(pidFile);
    } catch {}
    try {
      unlinkSync(portFile);
    } catch {}
    return stopped;
  }

  // ------------------------------------------------------------------
  // restart
  // ------------------------------------------------------------------

  async restart(component: string): Promise<StartResult> {
    this.stop(component);
    return this.start(component);
  }

  // ------------------------------------------------------------------
  // ps
  // ------------------------------------------------------------------

  ps(): DevServerInfo[] {
    const result: DevServerInfo[] = [];
    if (!existsSync(this.stateDir)) return result;

    for (const entry of readdirSync(this.stateDir).sort()) {
      if (!entry.endsWith(".pid")) continue;
      const name = entry.replace(/\.pid$/, "");
      const pidFile = join(this.stateDir, entry);
      const portFile = join(this.stateDir, `${name}.port`);

      const pid = readPid(pidFile);
      let port: number | null = null;
      if (existsSync(portFile)) {
        const parsed = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
        if (!isNaN(parsed)) port = parsed;
      }

      result.push({
        name,
        port,
        pid,
        running: pid !== null,
      });
    }

    return result;
  }

  // ------------------------------------------------------------------
  // logs
  // ------------------------------------------------------------------

  logs(component: string): string {
    const resolved = this.resolveComponent(component);
    const logFile = join(this.stateDir, `${resolved.name}.log`);
    if (!existsSync(logFile)) {
      throw new Error(
        `No log file found for ${resolved.name}. Is the dev server running?`,
      );
    }
    return logFile;
  }
}

