import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, relative } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

import { getFactoryClient } from "../client.js";
import {
  styleError,
  styleMuted,
} from "../commands/list-helpers.js";

// ─── Types ────────────────────────────────────────────────────

export interface MachineTarget {
  name: string;
  kind: string;
  host: string;
  port: number;
  user: string;
  /** e.g. ssh://ubuntu@10.0.0.5 or ssh://ubuntu@10.0.0.5:2222 */
  dockerHost: string;
  /** Where this machine was resolved from */
  source: "factory" | "ssh-config" | "local";
}

// ─── Machine resolution ───────────────────────────────────────

/**
 * Resolve a machine slug to a target, checking multiple sources in order:
 * 1. Factory API (infra.access.resolve)
 * 2. ~/.ssh/config
 * 3. ~/.config/dx/machines.json
 */
export async function resolveMachine(slug: string): Promise<MachineTarget> {
  // 1. Try Factory API
  const factoryResult = await resolveFromFactory(slug);
  if (factoryResult) return factoryResult;

  // 2. Try ~/.ssh/config
  const sshResult = resolveFromSshConfig(slug);
  if (sshResult) return sshResult;

  // 3. Try local machines.json
  const localResult = resolveFromLocalMachines(slug);
  if (localResult) return localResult;

  console.error(styleError(`No machine found for "${slug}".`));
  console.log(styleMuted("\nSearched Factory API, ~/.ssh/config, and ~/.config/dx/machines.json."));
  console.log(styleMuted("  Add to SSH config:  Host <slug> in ~/.ssh/config"));
  console.log(styleMuted("  Add locally:        dx docker add <slug> --host <ip> --user <user>"));
  console.log(styleMuted("  Sync from Factory:  dx ssh config sync"));
  process.exit(1);
}

const A = (api: any) => api.api.v1.factory.infra.access;

async function resolveFromFactory(slug: string): Promise<MachineTarget | null> {
  try {
    const api = await getFactoryClient();
    const result = await A(api).resolve({ slug }).get();
    const data = result?.data?.data;
    if (!data) return null;

    const { name, kind, host, port, user } = data;
    return buildTarget({ name, kind, host, port, user, source: "factory" });
  } catch {
    return null;
  }
}

// ─── SSH config parsing ───────────────────────────────────────

interface SshConfigHost {
  hostname?: string;
  user?: string;
  port?: number;
}

function parseSshConfig(): Map<string, SshConfigHost> {
  const configPath = resolve(homedir(), ".ssh", "config");
  if (!existsSync(configPath)) return new Map();

  const hosts = new Map<string, SshConfigHost>();
  try {
    const content = readFileSync(configPath, "utf-8");
    const lines = content.split("\n");
    let currentHost: string | null = null;
    let currentEntry: SshConfigHost = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const [key, ...rest] = line.split(/\s+/);
      const value = rest.join(" ");
      const keyLower = key.toLowerCase();

      if (keyLower === "host") {
        // Save previous entry
        if (currentHost && !currentHost.includes("*")) {
          hosts.set(currentHost, currentEntry);
        }
        currentHost = value;
        currentEntry = {};
      } else if (currentHost) {
        if (keyLower === "hostname") currentEntry.hostname = value;
        else if (keyLower === "user") currentEntry.user = value;
        else if (keyLower === "port") currentEntry.port = parseInt(value, 10);
      }
    }
    // Save last entry
    if (currentHost && !currentHost.includes("*")) {
      hosts.set(currentHost, currentEntry);
    }
  } catch {
    // Ignore parse errors
  }

  return hosts;
}

function resolveFromSshConfig(slug: string): MachineTarget | null {
  const hosts = parseSshConfig();
  const entry = hosts.get(slug);
  if (!entry) return null;

  const host = entry.hostname ?? slug;
  const user = entry.user ?? "root";
  const port = entry.port ?? 22;

  return buildTarget({ name: slug, kind: "ssh-config", host, port, user, source: "ssh-config" });
}

// ─── Local machines.json ──────────────────────────────────────

interface LocalMachineEntry {
  host: string;
  user?: string;
  port?: number;
  kind?: string;
  tags?: string[];
}

function resolveFromLocalMachines(slug: string): MachineTarget | null {
  const machinesPath = resolve(homedir(), ".config", "dx", "machines.json");
  if (!existsSync(machinesPath)) return null;

  try {
    const content = readFileSync(machinesPath, "utf-8");
    const machines: Record<string, LocalMachineEntry> = JSON.parse(content);
    const entry = machines[slug];
    if (!entry?.host) return null;

    return buildTarget({
      name: slug,
      kind: entry.kind ?? "local-config",
      host: entry.host,
      port: entry.port ?? 22,
      user: entry.user ?? "root",
      source: "local",
    });
  } catch {
    return null;
  }
}

/**
 * Save a machine to ~/.config/dx/machines.json
 */
export function saveLocalMachine(
  slug: string,
  entry: LocalMachineEntry,
): void {
  const dir = resolve(homedir(), ".config", "dx");
  const machinesPath = resolve(dir, "machines.json");

  let machines: Record<string, LocalMachineEntry> = {};
  if (existsSync(machinesPath)) {
    try {
      machines = JSON.parse(readFileSync(machinesPath, "utf-8"));
    } catch {
      // Start fresh if corrupt
    }
  }

  machines[slug] = entry;

  // Ensure directory exists
  spawnSync("mkdir", ["-p", dir]);
  const { writeFileSync } = require("node:fs");
  writeFileSync(machinesPath, JSON.stringify(machines, null, 2) + "\n");
}

/**
 * Remove a machine from ~/.config/dx/machines.json
 */
export function removeLocalMachine(slug: string): boolean {
  const machinesPath = resolve(homedir(), ".config", "dx", "machines.json");
  if (!existsSync(machinesPath)) return false;

  try {
    const machines: Record<string, LocalMachineEntry> = JSON.parse(
      readFileSync(machinesPath, "utf-8"),
    );
    if (!(slug in machines)) return false;
    delete machines[slug];
    const { writeFileSync } = require("node:fs");
    writeFileSync(machinesPath, JSON.stringify(machines, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ─── Shared helpers ───────────────────────────────────────────

function buildTarget(opts: {
  name: string;
  kind: string;
  host: string;
  port: number;
  user: string;
  source: MachineTarget["source"];
}): MachineTarget {
  const dockerHost =
    opts.port !== 22
      ? `ssh://${opts.user}@${opts.host}:${opts.port}`
      : `ssh://${opts.user}@${opts.host}`;

  return { ...opts, dockerHost };
}

// ─── SSH arg building ─────────────────────────────────────────

export function buildSshArgs(target: MachineTarget): string[] {
  const args = ["-o", "StrictHostKeyChecking=accept-new"];
  if (target.port !== 22) {
    args.push("-p", String(target.port));
  }
  args.push(`${target.user}@${target.host}`);
  return args;
}

// ─── Docker env ───────────────────────────────────────────────

export function buildDockerEnv(target: MachineTarget): NodeJS.ProcessEnv {
  return { ...process.env, DOCKER_HOST: target.dockerHost };
}

// ─── Preflight checks ─────────────────────────────────────────

export function checkLocalDocker(): void {
  const result = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(styleError("Docker CLI not found locally."));
    console.log(styleMuted("Install Docker Desktop or the Docker CLI to continue."));
    process.exit(1);
  }
}

// ─── Compose auto-sync detection ──────────────────────────────

/**
 * Detect if a compose file needs to be synced to the remote machine.
 * Returns true if the compose file has `build:` directives or
 * host-path volume mounts (./path:/container/path).
 */
export function needsSync(composeFilePath: string): boolean {
  if (!existsSync(composeFilePath)) return false;

  try {
    const content = readFileSync(composeFilePath, "utf-8");
    const doc = parseYaml(content);
    if (!doc?.services) return false;

    for (const svc of Object.values(doc.services) as any[]) {
      // Build directives require local context on the remote
      if (svc.build) return true;

      // Host-path volume mounts
      if (Array.isArray(svc.volumes)) {
        for (const v of svc.volumes) {
          const vol = typeof v === "string" ? v : v?.source;
          if (typeof vol === "string" && (vol.startsWith("./") || vol.startsWith("../"))) {
            return true;
          }
        }
      }

      // Configs/secrets from local files
      if (Array.isArray(svc.configs) || Array.isArray(svc.secrets)) return true;
    }

    // Top-level configs/secrets with file: references
    for (const section of [doc.configs, doc.secrets]) {
      if (!section) continue;
      for (const entry of Object.values(section) as any[]) {
        if (entry?.file) return true;
      }
    }
  } catch {
    // If we can't parse, assume no sync needed — DOCKER_HOST mode is safer
  }

  return false;
}

/**
 * Extract build context directories and volume mount paths from a compose file.
 * Returns absolute paths relative to the compose file's directory.
 */
function extractSyncPaths(composeFilePath: string): string[] {
  const paths: string[] = [];
  const composeDir = dirname(resolve(composeFilePath));

  try {
    const content = readFileSync(composeFilePath, "utf-8");
    const doc = parseYaml(content);
    if (!doc?.services) return paths;

    for (const svc of Object.values(doc.services) as any[]) {
      // Build contexts
      if (svc.build) {
        const ctx = typeof svc.build === "string" ? svc.build : svc.build.context;
        if (ctx) {
          const absCtx = resolve(composeDir, ctx);
          if (existsSync(absCtx)) paths.push(absCtx);
        }
        // Explicit Dockerfile reference
        if (typeof svc.build === "object" && svc.build.dockerfile) {
          const df = resolve(composeDir, svc.build.dockerfile);
          if (existsSync(df)) paths.push(df);
        }
      }

      // Host-path volume mounts
      if (Array.isArray(svc.volumes)) {
        for (const v of svc.volumes) {
          const vol = typeof v === "string" ? v.split(":")[0] : v?.source;
          if (typeof vol === "string" && (vol.startsWith("./") || vol.startsWith("../"))) {
            const absVol = resolve(composeDir, vol);
            if (existsSync(absVol)) paths.push(absVol);
          }
        }
      }
    }
    // Top-level configs and secrets with file: references
    for (const section of [doc.configs, doc.secrets]) {
      if (!section) continue;
      for (const entry of Object.values(section) as any[]) {
        if (entry?.file) {
          const absFile = resolve(composeDir, entry.file);
          if (existsSync(absFile)) paths.push(absFile);
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Deduplicate
  return [...new Set(paths)];
}

/**
 * Find the compose file in the current directory.
 * Checks common names: compose.yml, compose.yaml, docker-compose.yml, docker-compose.yaml
 */
export function findComposeFile(cwd: string = process.cwd()): string | null {
  const candidates = [
    "compose.yml",
    "compose.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
  ];
  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Sync local files to the remote machine and run docker compose there.
 * Syncs compose file, .env files, build context directories, and volume mount paths.
 */
export function syncAndRunCompose(
  target: MachineTarget,
  composeFile: string,
  composeArgs: string[],
): void {
  const sshArgs = buildSshArgs(target);
  const sshDest = `${target.user}@${target.host}`;
  const composeDir = dirname(resolve(composeFile));

  // Create remote working directory
  const mkdirResult = spawnSync("ssh", [...sshArgs, "mktemp -d /tmp/dx-compose-XXXXXX"], {
    encoding: "utf8",
  });
  if (mkdirResult.status !== 0) {
    console.error(styleError("Failed to create remote working directory."));
    process.exit(1);
  }
  const remoteDir = mkdirResult.stdout.trim();

  // Collect all paths to sync
  const syncPaths = extractSyncPaths(composeFile);

  // Add env files
  for (const envFile of [".env", ".env.local", ".env.production"]) {
    const p = resolve(composeDir, envFile);
    if (existsSync(p)) syncPaths.push(p);
  }

  // Count items for display
  const fileCount = syncPaths.length + 1; // +1 for compose file itself
  console.log(styleMuted(`Syncing ${fileCount} item(s) to ${target.name}:${remoteDir}`));

  // Build rsync args — sync the entire compose directory context
  const sshCmd = target.port !== 22
    ? `ssh -p ${target.port} -o StrictHostKeyChecking=accept-new`
    : "ssh -o StrictHostKeyChecking=accept-new";

  // Rsync the compose file and all referenced paths
  // We use --relative so directory structure is preserved
  const allPaths = [resolve(composeFile), ...syncPaths];

  // Convert to paths relative to composeDir for rsync --relative
  const relativePaths = allPaths.map(p => {
    const rel = relative(composeDir, p);
    return rel.startsWith("..") ? p : rel;
  });

  // Deduplicate
  const uniquePaths = [...new Set(relativePaths)];

  const rsyncArgs = [
    "-avz",
    "--relative",
    "-e", sshCmd,
    ...uniquePaths,
    `${sshDest}:${remoteDir}/`,
  ];

  const rsyncResult = spawnSync("rsync", rsyncArgs, {
    stdio: "inherit",
    cwd: composeDir,
  });
  if (rsyncResult.status !== 0) {
    console.error(styleError("Failed to sync files to remote machine."));
    console.log(styleMuted("Ensure rsync is installed locally and on the remote machine."));
    process.exit(1);
  }

  // Run docker compose on the remote
  const composeName = basename(composeFile);
  const remoteCmd = `cd ${remoteDir} && docker compose -f ${composeName} ${composeArgs.join(" ")}`;
  try {
    execFileSync("ssh", [...sshArgs, remoteCmd], { stdio: "inherit" });
  } catch (err: any) {
    if (err.status != null) process.exit(err.status);
    throw err;
  }
}

// ─── Bootstrap script ─────────────────────────────────────────

export const DOCKER_BOOTSTRAP_SCRIPT = `#!/bin/bash
set -euo pipefail

echo "==> Checking for Docker..."
if command -v docker &>/dev/null; then
  echo "Docker is already installed:"
  docker --version
  docker compose version 2>/dev/null || echo "(Docker Compose plugin not found)"
  echo ""
  echo "==> Verifying Docker daemon..."
  docker info >/dev/null 2>&1 && echo "Docker daemon is running." || echo "Warning: Docker daemon may not be running."
  exit 0
fi

echo "==> Detecting OS..."
IS_ALPINE=false
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "    OS: \$NAME \${VERSION_ID:-unknown}"
  if [ "\${ID:-}" = "alpine" ]; then
    IS_ALPINE=true
  fi
else
  echo "    Could not detect OS. Attempting install anyway."
fi

if [ "\$IS_ALPINE" = true ]; then
  echo "==> Installing Docker on Alpine via apk..."
  apk update
  apk add docker docker-compose docker-cli-compose
  rc-update add docker default 2>/dev/null || true
  service docker start 2>/dev/null || openrc 2>/dev/null && service docker start || true
else
  echo "==> Installing Docker via official convenience script..."
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Adding current user to docker group..."
CURRENT_USER=\$(whoami)
if [ "\$CURRENT_USER" != "root" ]; then
  if command -v sudo &>/dev/null; then
    sudo usermod -aG docker "\$CURRENT_USER" 2>/dev/null || adduser "\$CURRENT_USER" docker 2>/dev/null || true
  else
    adduser "\$CURRENT_USER" docker 2>/dev/null || true
  fi
  echo "    Added \$CURRENT_USER to docker group."
  echo "    Note: You may need to log out and back in for group changes to take effect."
fi

echo "==> Enabling and starting Docker service..."
if command -v systemctl &>/dev/null; then
  sudo systemctl enable docker --now 2>/dev/null || true
elif command -v rc-update &>/dev/null; then
  rc-update add docker default 2>/dev/null || true
  service docker start 2>/dev/null || true
else
  sudo service docker start 2>/dev/null || true
fi

echo "==> Verifying installation..."
docker --version
docker compose version 2>/dev/null || echo "Docker Compose plugin not found."

echo ""
echo "==> Docker setup complete!"
`;
