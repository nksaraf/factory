/**
 * Fleet discovery — SSH into hosts, find docker compose projects,
 * fetch their compose files, and parse them into structured results.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter";
import type { CatalogSystem } from "@smp/factory-shared/catalog";

import {
  type MachineTarget,
  resolveMachine,
  buildSshArgs,
} from "./docker-remote.js";

// ─── Types ────────────────────────────────────────────────────

export interface ComposeProject {
  name: string;
  status: string;
  configFiles: string[];
}

export interface ContainerInfo {
  name: string;
  image: string;
  service: string;
  status: string;
  health: string;
  ports: string;
}

export interface DiscoveredStack {
  project: ComposeProject;
  host: string;
  target: MachineTarget;
  containers: ContainerInfo[];
  catalog: CatalogSystem | null;
  parseWarnings: string[];
  error?: string;
}

export interface DiscoveryResult {
  host: string;
  target: MachineTarget;
  stacks: DiscoveredStack[];
  error?: string;
}

// ─── SSH helpers ──────────────────────────────────────────────

function sshExec(target: MachineTarget, command: string): string {
  const args = buildSshArgs(target);
  return execFileSync("ssh", [...args, command], {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"], // suppress stderr
  }).trim();
}

function sshExecAsync(target: MachineTarget, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = buildSshArgs(target);
    execFile("ssh", [...args, command], { encoding: "utf-8", timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout ?? "").trim());
    });
  });
}

// ─── Discovery ────────────────────────────────────────────────

/**
 * List all docker compose projects on a remote host.
 */
function listComposeProjects(target: MachineTarget): ComposeProject[] {
  const raw = sshExec(target, "docker compose ls --format json");
  if (!raw) return [];

  const items = JSON.parse(raw) as Array<{
    Name: string;
    Status: string;
    ConfigFiles: string;
  }>;

  return items.map((item) => ({
    name: item.Name,
    status: item.Status,
    configFiles: item.ConfigFiles.split(","),
  }));
}

/**
 * Get container details for a specific compose project.
 */
function listContainers(
  target: MachineTarget,
  projectName: string,
): ContainerInfo[] {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(projectName)) {
    return []; // skip projects with unsafe names
  }
  try {
    const raw = sshExec(
      target,
      `docker compose -p ${projectName} ps --format json`,
    );
    if (!raw) return [];

    // docker compose ps --format json outputs one JSON object per line
    const lines = raw.split("\n").filter((l) => l.trim());
    const containers: ContainerInfo[] = [];

    for (const line of lines) {
      try {
        const c = JSON.parse(line);
        containers.push({
          name: c.Name ?? c.Names ?? "",
          image: c.Image ?? "",
          service: c.Service ?? "",
          status: c.State ?? c.Status ?? "",
          health: c.Health ?? "",
          ports: c.Ports ?? (c.Publishers ? formatPublishers(c.Publishers) : ""),
        });
      } catch {
        // skip malformed lines
      }
    }

    return containers;
  } catch {
    return [];
  }
}

function formatPublishers(
  publishers: Array<{
    URL?: string;
    TargetPort?: number;
    PublishedPort?: number;
    Protocol?: string;
  }> | undefined,
): string {
  if (!publishers || !Array.isArray(publishers)) return "";
  return publishers
    .filter((p) => p.PublishedPort && p.PublishedPort > 0)
    .map((p) => `${p.PublishedPort}→${p.TargetPort}/${p.Protocol ?? "tcp"}`)
    .join(", ");
}

/**
 * Fetch a remote file's content via SSH.
 */
function fetchRemoteFile(target: MachineTarget, path: string): string | null {
  try {
    return sshExec(target, `cat ${JSON.stringify(path)}`);
  } catch {
    return null;
  }
}

/**
 * Parse a compose project's files into a CatalogSystem by writing
 * fetched content to a temp directory and using DockerComposeFormatAdapter.
 */
function parseComposeProject(
  target: MachineTarget,
  project: ComposeProject,
): { catalog: CatalogSystem | null; warnings: string[]; error?: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), `dx-fleet-${project.name}-`));
  const warnings: string[] = [];

  try {
    // Fetch each compose file
    let hasFiles = false;
    for (const configFile of project.configFiles) {
      const content = fetchRemoteFile(target, configFile);
      if (!content) {
        warnings.push(`Could not fetch ${configFile}`);
        continue;
      }

      // Use the original filename so the adapter discovers it
      const filename = configFile.includes("docker-compose")
        ? configFile.split("/").pop()!
        : "docker-compose.yml";
      writeFileSync(join(tmpDir, filename), content);
      hasFiles = true;
    }

    if (!hasFiles) {
      return { catalog: null, warnings, error: "No compose files accessible" };
    }

    // Fetch .env from the compose file's directory
    const composeDir =
      project.configFiles[0].split("/").slice(0, -1).join("/");
    const envContent = fetchRemoteFile(target, `${composeDir}/.env`);
    const env: Record<string, string | undefined> = {};
    if (envContent) {
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      }
    }

    const adapter = new DockerComposeFormatAdapter();
    const result = adapter.parse(tmpDir, { env });
    warnings.push(...result.warnings);
    return { catalog: result.system, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { catalog: null, warnings, error: msg };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Async variants (for concurrent discovery) ──────────────

async function listComposeProjectsAsync(target: MachineTarget): Promise<ComposeProject[]> {
  const raw = await sshExecAsync(target, "docker compose ls --format json");
  if (!raw) return [];

  const items = JSON.parse(raw) as Array<{
    Name: string;
    Status: string;
    ConfigFiles: string;
  }>;

  return items.map((item) => ({
    name: item.Name,
    status: item.Status,
    configFiles: item.ConfigFiles.split(","),
  }));
}

async function listContainersAsync(
  target: MachineTarget,
  projectName: string,
): Promise<ContainerInfo[]> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(projectName)) {
    return [];
  }
  try {
    const raw = await sshExecAsync(
      target,
      `docker compose -p ${projectName} ps --format json`,
    );
    if (!raw) return [];

    const lines = raw.split("\n").filter((l) => l.trim());
    const containers: ContainerInfo[] = [];

    for (const line of lines) {
      try {
        const c = JSON.parse(line);
        containers.push({
          name: c.Name ?? c.Names ?? "",
          image: c.Image ?? "",
          service: c.Service ?? "",
          status: c.State ?? c.Status ?? "",
          health: c.Health ?? "",
          ports: c.Ports ?? (c.Publishers ? formatPublishers(c.Publishers) : ""),
        });
      } catch {
        // skip malformed lines
      }
    }

    return containers;
  } catch {
    return [];
  }
}

async function fetchRemoteFileAsync(target: MachineTarget, path: string): Promise<string | null> {
  try {
    return await sshExecAsync(target, `cat ${JSON.stringify(path)}`);
  } catch {
    return null;
  }
}

async function parseComposeProjectAsync(
  target: MachineTarget,
  project: ComposeProject,
): Promise<{ catalog: CatalogSystem | null; warnings: string[]; error?: string }> {
  const tmpDir = mkdtempSync(join(tmpdir(), `dx-fleet-${project.name}-`));
  const warnings: string[] = [];

  try {
    // Fetch all compose files concurrently
    const fetchResults = await Promise.all(
      project.configFiles.map(async (configFile) => ({
        path: configFile,
        content: await fetchRemoteFileAsync(target, configFile),
      })),
    );

    let hasFiles = false;
    for (const { path: configFile, content } of fetchResults) {
      if (!content) {
        warnings.push(`Could not fetch ${configFile}`);
        continue;
      }
      const filename = configFile.includes("docker-compose")
        ? configFile.split("/").pop()!
        : "docker-compose.yml";
      writeFileSync(join(tmpDir, filename), content);
      hasFiles = true;
    }

    if (!hasFiles) {
      return { catalog: null, warnings, error: "No compose files accessible" };
    }

    const composeDir = project.configFiles[0].split("/").slice(0, -1).join("/");
    const envContent = await fetchRemoteFileAsync(target, `${composeDir}/.env`);
    const env: Record<string, string | undefined> = {};
    if (envContent) {
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      }
    }

    const adapter = new DockerComposeFormatAdapter();
    const result = adapter.parse(tmpDir, { env });
    warnings.push(...result.warnings);
    return { catalog: result.system, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { catalog: null, warnings, error: msg };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Main entry points ───────────────────────────────────────

export interface DiscoverOptions {
  userOverride?: string;
}

/**
 * Discover all docker compose stacks on a single host.
 * Uses async SSH for project listing, then processes stacks concurrently.
 */
export async function discoverHost(
  slug: string,
  opts?: DiscoverOptions,
): Promise<DiscoveryResult> {
  const target = await resolveMachine(slug);
  if (opts?.userOverride) {
    target.user = opts.userOverride;
    target.dockerHost = target.port !== 22
      ? `ssh://${opts.userOverride}@${target.host}:${target.port}`
      : `ssh://${opts.userOverride}@${target.host}`;
  }

  try {
    const projects = await listComposeProjectsAsync(target);

    // Process stacks concurrently — each stack does independent SSH calls
    const stacks = await Promise.all(
      projects.map(async (project) => {
        const containers = await listContainersAsync(target, project.name);
        const { catalog, warnings, error } = await parseComposeProjectAsync(
          target,
          project,
        );

        return {
          project,
          host: slug,
          target,
          containers,
          catalog,
          parseWarnings: warnings,
          error,
        } as DiscoveredStack;
      }),
    );

    return { host: slug, target, stacks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { host: slug, target, stacks: [], error: msg };
  }
}

/**
 * Discover across multiple hosts in parallel.
 */
export async function discoverHosts(
  slugs: string[],
  concurrency = 8,
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  const queue = [...slugs];

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const slug = queue.shift()!;
        results.push(await discoverHost(slug));
      }
    },
  );

  await Promise.all(workers);
  return results;
}
